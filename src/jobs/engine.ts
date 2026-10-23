// The transfer engine. A transfer is done in many small steps so that each one
// fits inside Cloudflare's free-plan limits (10 ms CPU, 50 outside calls, 50 database queries).
//
// For each selected playlist (or Liked Songs):
//   read     -> copy the song list from the source into transfer_items
//   match    -> find each song on the destination (ISRC, exact, fuzzy)
//   existing -> (only when adding to a playlist you already have) skip songs already in it
//   write    -> create the playlist / save the songs on the destination
//
// Per-playlist progress is kept in transfer_selections (D1), so Fix, Try again and
// Auto-Sync still know where songs went after the job has finished.
import type { Platform, PlatformAdapter, Track } from "../adapters/types";
import { cacheKey } from "../matcher/normalize";
import { matchTrack, type MatchResult } from "../matcher/match";

export interface Selection {
  kind: "playlist" | "liked";
  id?: string; // source playlist id (not needed for liked songs or uploaded files)
  name: string;
  targetPlaylistId?: string; // add to this existing destination playlist instead of making a new one
}

export interface JobSpec {
  jobId: string;
  userId: string;
  source: Platform | "file";
  dest: Platform;
  selections: Selection[];
  syncId?: string; // set when the job was started by an Auto-Sync
}

export interface JobState {
  sel: number; // which selection we are working on
  phase: "read" | "match" | "existing" | "write";
  cursor?: string; // source (or destination, in "existing") paging position
  position: number; // next song number inside the selection
  destPlaylistId?: string;
  errors: number;
}

export interface EngineDeps {
  db: D1Database;
  source?: PlatformAdapter; // missing when the source is an uploaded file
  dest: PlatformAdapter;
  withSourceToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
  withDestToken: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}

export const PAGES_PER_STEP = 4;
export const CACHE_DAYS = 30;

export function initialState(spec: JobSpec): JobState {
  // Uploaded files are already stored in transfer_items when the job is created.
  return {
    sel: 0,
    phase: spec.source === "file" ? "match" : "read",
    position: 0,
    destPlaylistId: spec.selections[0]?.targetPlaylistId,
    errors: 0,
  };
}

export function matchesPerStep(dest: Platform): number {
  return dest === "youtube" ? 4 : 10;
}

/** Saves one transfer_selections row per selection, with one query. */
export async function insertSelections(db: D1Database, jobId: string, selections: Selection[], readDone: boolean) {
  const rows = selections.map((s, i) => ({ i, k: s.kind, n: s.name, s: s.id ?? null, t: s.targetPlaylistId ?? null }));
  await db
    .prepare(
      `INSERT INTO transfer_selections (job_id, sel_index, kind, name, source_id, target_playlist_id, dest_playlist_id, read_done)
       SELECT ?1, j.value ->> 'i', j.value ->> 'k', j.value ->> 'n', j.value ->> 's', j.value ->> 't', j.value ->> 't', ?2
       FROM json_each(?3) AS j`,
    )
    .bind(jobId, readDone ? 1 : 0, JSON.stringify(rows))
    .run();
}

/** Where to pick up: the first selection (from `fromSel` on) that still has work to do. */
export async function selectionState(db: D1Database, spec: JobSpec, fromSel: number): Promise<JobState | null> {
  const row = await db
    .prepare(
      `SELECT sel_index, read_done, dest_playlist_id FROM transfer_selections
       WHERE job_id = ?1 AND sel_index >= ?2 AND write_done = 0 ORDER BY sel_index LIMIT 1`,
    )
    .bind(spec.jobId, fromSel)
    .first<{ sel_index: number; read_done: number; dest_playlist_id: string | null }>();
  if (!row) {
    // Jobs started before v1.1 have no selection rows: carry on the old way, one selection after another.
    if (!spec.selections[fromSel]) return null;
    const hasRows = await db.prepare("SELECT 1 FROM transfer_selections WHERE job_id = ?1 LIMIT 1").bind(spec.jobId).first();
    if (hasRows) return null;
    return {
      sel: fromSel,
      phase: spec.source === "file" ? "match" : "read",
      position: 0,
      destPlaylistId: spec.selections[fromSel].targetPlaylistId,
      errors: 0,
    };
  }
  return {
    sel: row.sel_index,
    phase: row.read_done ? "match" : "read",
    position: 0,
    destPlaylistId: row.dest_playlist_id ?? undefined,
    errors: 0,
  };
}

function cleanRow(t: Track) {
  const row = {
    t: String(t.title ?? "").slice(0, 300),
    a: String(t.artist ?? "").slice(0, 300),
    al: t.album ? String(t.album).slice(0, 300) : null,
    i: t.isrc ? String(t.isrc).slice(0, 15).toUpperCase() : null,
    d: Number.isFinite(t.durationMs) ? Math.round(t.durationMs!) : null,
  };
  return { ...row, k: cacheKey({ title: row.t, artist: row.a, isrc: row.i }) };
}

/** Inserts many songs with one query (keeps us far below the per-step query limit). */
export async function insertTracks(db: D1Database, jobId: string, sel: number, startPosition: number, tracks: Track[]) {
  for (let i = 0; i < tracks.length; i += 200) {
    const rows = tracks.slice(i, i + 200).map((t, j) => ({ p: startPosition + i + j, ...cleanRow(t) }));
    await db
      .prepare(
        `INSERT INTO transfer_items (job_id, sel_index, position, src_title, src_artist, src_album, src_isrc, src_duration_ms, src_key, status)
         SELECT ?1, ?2, j.value ->> 'p', j.value ->> 't', j.value ->> 'a', j.value ->> 'al', j.value ->> 'i', j.value ->> 'd', j.value ->> 'k', 'PENDING'
         FROM json_each(?3) AS j`,
      )
      .bind(jobId, sel, JSON.stringify(rows))
      .run();
  }
}

/** For Auto-Sync: drops songs this sync has already handled before. */
async function unseenOnly(db: D1Database, syncId: string, tracks: Track[]): Promise<Track[]> {
  if (!tracks.length) return tracks;
  const keys = tracks.map((t) => cleanRow(t).k);
  const { results } = await db
    .prepare("SELECT key FROM sync_seen WHERE sync_id = ?1 AND key IN (SELECT value FROM json_each(?2))")
    .bind(syncId, JSON.stringify(keys))
    .all<{ key: string }>();
  const seen = new Set(results.map((r) => r.key));
  return tracks.filter((_, i) => !seen.has(keys[i]));
}

/** Runs one small step. Returns the new state, or null when the whole job is finished. */
export async function runStep(spec: JobSpec, state: JobState, deps: EngineDeps): Promise<JobState | null> {
  const selection = spec.selections[state.sel];
  if (!selection) return null;
  const next = { ...state };
  const db = deps.db;

  if (state.phase === "read") {
    const source = deps.source!;
    let cursor = state.cursor;
    let position = state.position;
    for (let i = 0; i < PAGES_PER_STEP; i++) {
      const page = await deps.withSourceToken((token) =>
        selection.kind === "liked"
          ? source.getSavedTracks(token, cursor)
          : source.getPlaylistTracks(token, selection.id!, cursor),
      );
      const tracks = spec.syncId ? await unseenOnly(db, spec.syncId, page.items) : page.items;
      await insertTracks(db, spec.jobId, state.sel, position, tracks);
      position += tracks.length;
      cursor = page.next;
      if (!cursor) break;
    }
    next.position = position;
    next.cursor = cursor;
    if (!cursor) {
      await db
        .prepare("UPDATE transfer_selections SET read_done = 1 WHERE job_id = ?1 AND sel_index = ?2")
        .bind(spec.jobId, state.sel)
        .run();
      Object.assign(next, { phase: "match", cursor: undefined, position: 0 });
    }
    return next;
  }

  if (state.phase === "match") {
    const { results: pending } = await db
      .prepare(
        `SELECT id, src_title, src_artist, src_album, src_isrc, src_duration_ms FROM transfer_items
         WHERE job_id = ?1 AND sel_index = ?2 AND status = 'PENDING' ORDER BY position LIMIT ?3`,
      )
      .bind(spec.jobId, state.sel, matchesPerStep(spec.dest))
      .all<any>();
    if (!pending.length) {
      if (selection.kind === "playlist") {
        // The same song twice in one list (or already added earlier): add it only once.
        await db
          .prepare(
            `UPDATE transfer_items SET written = 2
             WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0 AND dest_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM transfer_items AS o
                           WHERE o.job_id = ?1 AND o.sel_index = ?2 AND o.dest_id = transfer_items.dest_id
                             AND o.status = 'MATCHED' AND o.id != transfer_items.id
                             AND (o.written != 0 OR o.id < transfer_items.id))`,
          )
          .bind(spec.jobId, state.sel)
          .run();
      }
      next.phase = selection.kind === "playlist" && selection.targetPlaylistId ? "existing" : "write";
      next.cursor = undefined;
      return next;
    }

    const items = pending.map((row) => ({
      id: row.id as number,
      track: {
        title: row.src_title,
        artist: row.src_artist,
        album: row.src_album ?? undefined,
        isrc: row.src_isrc ?? undefined,
        durationMs: row.src_duration_ms ?? undefined,
      } as Track,
    }));

    // 1. Shared cache of earlier good matches.
    const keys = items.map((it) => cacheKey(it.track));
    const { results: cached } = await db
      .prepare(
        `SELECT key, dest_id, dest_title, dest_artist, confidence FROM match_cache
         WHERE dest = ?1 AND updated_at > ?2 AND key IN (SELECT value FROM json_each(?3))`,
      )
      .bind(spec.dest, Date.now() - CACHE_DAYS * 86400_000, JSON.stringify(keys))
      .all<any>();
    const cacheByKey = new Map(cached.map((c) => [c.key, c]));

    // 2. Search the destination for everything else.
    const updates: any[] = [];
    const newCache: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const { id, track } = items[i];
      const hit = cacheByKey.get(keys[i]);
      if (hit) {
        updates.push({ id, di: hit.dest_id, dt: hit.dest_title, da: hit.dest_artist, c: hit.confidence, m: "cache", s: "MATCHED" });
        continue;
      }
      const dest = deps.dest;
      const result: MatchResult = await deps.withDestToken((token) =>
        matchTrack(track, {
          byIsrc: dest.searchByIsrc ? (isrc) => dest.searchByIsrc!(token, isrc) : undefined,
          byText: (q) => dest.search(token, q),
        }),
      );
      updates.push({
        id,
        di: result.dest?.id ?? null,
        dt: result.dest?.title ?? null,
        da: result.dest?.artist ?? null,
        c: result.confidence,
        m: result.method,
        s: result.status,
      });
      if (result.status === "MATCHED" && result.dest?.id) {
        newCache.push({ k: keys[i], di: result.dest.id, dt: result.dest.title, da: result.dest.artist, c: result.confidence, m: result.method });
      }
    }

    await db
      .prepare(
        `UPDATE transfer_items SET dest_id = j.value ->> 'di', dest_title = j.value ->> 'dt', dest_artist = j.value ->> 'da',
           confidence = j.value ->> 'c', method = j.value ->> 'm', status = j.value ->> 's'
         FROM json_each(?1) AS j WHERE transfer_items.id = j.value ->> 'id'`,
      )
      .bind(JSON.stringify(updates))
      .run();
    if (newCache.length) {
      await db
        .prepare(
          `INSERT OR REPLACE INTO match_cache (key, dest, dest_id, dest_title, dest_artist, confidence, method, updated_at)
           SELECT j.value ->> 'k', ?1, j.value ->> 'di', j.value ->> 'dt', j.value ->> 'da', j.value ->> 'c', j.value ->> 'm', ?2
           FROM json_each(?3) AS j`,
        )
        .bind(spec.dest, Date.now(), JSON.stringify(newCache))
        .run();
    }
    return next;
  }

  if (state.phase === "existing") {
    // Page through the playlist we are adding to and mark songs that are already in it.
    let cursor = state.cursor;
    for (let i = 0; i < PAGES_PER_STEP; i++) {
      const page = await deps.withDestToken((token) => deps.dest.getPlaylistTracks(token, selection.targetPlaylistId!, cursor));
      const ids = page.items.map((t) => t.id).filter(Boolean);
      if (ids.length) {
        await db
          .prepare(
            `UPDATE transfer_items SET written = 2
             WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0
               AND dest_id IN (SELECT value FROM json_each(?3))`,
          )
          .bind(spec.jobId, state.sel, JSON.stringify(ids))
          .run();
      }
      cursor = page.next;
      if (!cursor) break;
    }
    next.cursor = cursor;
    if (!cursor) next.phase = "write";
    return next;
  }

  // phase === "write"
  const dest = deps.dest;
  const isPlaylist = selection.kind === "playlist";
  const batchSize = isPlaylist ? dest.writeBatchSize : dest.saveBatchSize;
  const batchesPerStep = Math.max(1, Math.min(5, Math.floor(10 / batchSize)));
  if (isPlaylist && !next.destPlaylistId) next.destPlaylistId = selection.targetPlaylistId;

  if (isPlaylist && !next.destPlaylistId) {
    const created = await deps.withDestToken((token) =>
      dest.createPlaylist(token, selection.name.slice(0, 100), "Moved with mix n match"),
    );
    next.destPlaylistId = created.id;
    await db
      .prepare("UPDATE transfer_selections SET dest_playlist_id = ?3 WHERE job_id = ?1 AND sel_index = ?2")
      .bind(spec.jobId, state.sel, created.id)
      .run();
    return next;
  }

  // Liked songs are saved oldest-first so the newest ends up on top, like the original.
  const { results: toWrite } = await db
    .prepare(
      `SELECT id, dest_id FROM transfer_items
       WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0 AND dest_id IS NOT NULL
       ORDER BY position ${isPlaylist ? "ASC" : "DESC"} LIMIT ?3`,
    )
    .bind(spec.jobId, state.sel, batchSize * batchesPerStep)
    .all<{ id: number; dest_id: string }>();

  if (!toWrite.length) {
    await db
      .prepare("UPDATE transfer_selections SET write_done = 1 WHERE job_id = ?1 AND sel_index = ?2")
      .bind(spec.jobId, state.sel)
      .run();
    return selectionState(db, spec, state.sel + 1);
  }

  for (let i = 0; i < toWrite.length; i += batchSize) {
    const chunk = toWrite.slice(i, i + batchSize);
    const ids = chunk.map((r) => r.dest_id);
    await deps.withDestToken((token) =>
      isPlaylist ? dest.addTracksToPlaylist(token, next.destPlaylistId!, ids) : dest.saveTracks(token, ids),
    );
    // Mark each batch as soon as it is written, so a pause never adds songs twice.
    await db
      .prepare("UPDATE transfer_items SET written = 1 WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(chunk.map((r) => r.id)))
      .run();
  }
  return next;
}
