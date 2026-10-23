// The transfer engine. A transfer is done in many small steps so that each one
// fits inside Cloudflare's free-plan limits (10 ms CPU, 50 outside calls, 50 database queries).
//
// For each selected playlist (or Liked Songs):
//   read  -> copy the song list from the source into transfer_items
//   match -> find each song on the destination (ISRC, exact, fuzzy)
//   write -> create the playlist / save the songs on the destination
import type { Platform, PlatformAdapter, Track } from "../adapters/types";
import { cacheKey } from "../matcher/normalize";
import { matchTrack, type MatchResult } from "../matcher/match";

export interface Selection {
  kind: "playlist" | "liked";
  id?: string; // source playlist id (not needed for liked songs or uploaded files)
  name: string;
}

export interface JobSpec {
  jobId: string;
  userId: string;
  source: Platform | "file";
  dest: Platform;
  selections: Selection[];
}

export interface JobState {
  sel: number; // which selection we are working on
  phase: "read" | "match" | "write";
  cursor?: string; // source paging position
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
  return { sel: 0, phase: spec.source === "file" ? "match" : "read", position: 0, errors: 0 };
}

export function matchesPerStep(dest: Platform): number {
  return dest === "youtube" ? 4 : 10;
}

/** Inserts many songs with one query (keeps us far below the per-step query limit). */
export async function insertTracks(db: D1Database, jobId: string, sel: number, startPosition: number, tracks: Track[]) {
  for (let i = 0; i < tracks.length; i += 200) {
    const rows = tracks.slice(i, i + 200).map((t, j) => ({
      p: startPosition + i + j,
      t: String(t.title ?? "").slice(0, 300),
      a: String(t.artist ?? "").slice(0, 300),
      al: t.album ? String(t.album).slice(0, 300) : null,
      i: t.isrc ? String(t.isrc).slice(0, 15).toUpperCase() : null,
      d: Number.isFinite(t.durationMs) ? Math.round(t.durationMs!) : null,
    }));
    await db
      .prepare(
        `INSERT INTO transfer_items (job_id, sel_index, position, src_title, src_artist, src_album, src_isrc, src_duration_ms, status)
         SELECT ?1, ?2, j.value ->> 'p', j.value ->> 't', j.value ->> 'a', j.value ->> 'al', j.value ->> 'i', j.value ->> 'd', 'PENDING'
         FROM json_each(?3) AS j`,
      )
      .bind(jobId, sel, JSON.stringify(rows))
      .run();
  }
}

/** Runs one small step. Returns the new state, or null when the whole job is finished. */
export async function runStep(spec: JobSpec, state: JobState, deps: EngineDeps): Promise<JobState | null> {
  const selection = spec.selections[state.sel];
  if (!selection) return null;
  const next = { ...state };

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
      await insertTracks(deps.db, spec.jobId, state.sel, position, page.items);
      position += page.items.length;
      cursor = page.next;
      if (!cursor) break;
    }
    next.position = position;
    next.cursor = cursor;
    if (!cursor) Object.assign(next, { phase: "match", cursor: undefined, position: 0 });
    return next;
  }

  if (state.phase === "match") {
    const { results: pending } = await deps.db
      .prepare(
        `SELECT id, src_title, src_artist, src_album, src_isrc, src_duration_ms FROM transfer_items
         WHERE job_id = ?1 AND sel_index = ?2 AND status = 'PENDING' ORDER BY position LIMIT ?3`,
      )
      .bind(spec.jobId, state.sel, matchesPerStep(spec.dest))
      .all<any>();
    if (!pending.length) {
      next.phase = "write";
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
    const { results: cached } = await deps.db
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

    await deps.db
      .prepare(
        `UPDATE transfer_items SET dest_id = j.value ->> 'di', dest_title = j.value ->> 'dt', dest_artist = j.value ->> 'da',
           confidence = j.value ->> 'c', method = j.value ->> 'm', status = j.value ->> 's'
         FROM json_each(?1) AS j WHERE transfer_items.id = j.value ->> 'id'`,
      )
      .bind(JSON.stringify(updates))
      .run();
    if (newCache.length) {
      await deps.db
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

  // phase === "write"
  const dest = deps.dest;
  const isPlaylist = selection.kind === "playlist";
  const batchSize = isPlaylist ? dest.writeBatchSize : dest.saveBatchSize;
  const batchesPerStep = Math.max(1, Math.min(5, Math.floor(10 / batchSize)));

  if (isPlaylist && !next.destPlaylistId) {
    const created = await deps.withDestToken((token) =>
      dest.createPlaylist(token, selection.name.slice(0, 100), "Moved with mix n match"),
    );
    next.destPlaylistId = created.id;
    return next;
  }

  // Liked songs are saved oldest-first so the newest ends up on top, like the original.
  const { results: toWrite } = await deps.db
    .prepare(
      `SELECT id, dest_id FROM transfer_items
       WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0 AND dest_id IS NOT NULL
       ORDER BY position ${isPlaylist ? "ASC" : "DESC"} LIMIT ?3`,
    )
    .bind(spec.jobId, state.sel, batchSize * batchesPerStep)
    .all<{ id: number; dest_id: string }>();

  if (!toWrite.length) {
    return { sel: state.sel + 1, phase: spec.source === "file" ? "match" : "read", position: 0, errors: 0 };
  }

  for (let i = 0; i < toWrite.length; i += batchSize) {
    const chunk = toWrite.slice(i, i + batchSize);
    const ids = chunk.map((r) => r.dest_id);
    await deps.withDestToken((token) =>
      isPlaylist ? dest.addTracksToPlaylist(token, next.destPlaylistId!, ids) : dest.saveTracks(token, ids),
    );
    // Mark each batch as soon as it is written, so a pause never adds songs twice.
    await deps.db
      .prepare("UPDATE transfer_items SET written = 1 WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(chunk.map((r) => r.id)))
      .run();
  }
  return next;
}
