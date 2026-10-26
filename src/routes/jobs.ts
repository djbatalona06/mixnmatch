// Starting transfers, reading their progress, stopping them and trying again.
import { isPlatform } from "../adapters/registry";
import type { Platform, Track } from "../adapters/types";
import type { User } from "../auth/session";
import type { Env } from "../env";
import { insertSelections, insertTracks, selectionState, type JobSpec, type JobState, type Selection } from "../jobs/engine";
import { cancelJobRun, startJobRun } from "../jobs/runner";
import { limitsFor, upgradeHint } from "../plans";
import { HttpError, json } from "../web";

export const MAX_SELECTIONS = 50;
export const ACTIVE = "('QUEUED','RUNNING','WAITING')";
const FINISHED = ["DONE", "FAILED", "CANCELLED"];
const ITEM_STATUSES = ["PENDING", "MATCHED", "LOW_CONFIDENCE", "FAILED", "SKIPPED"];

interface CreateJobBody {
  source: string;
  dest: string;
  selections?: { kind: string; id?: string; name?: string; targetPlaylistId?: string }[];
  file?: { name?: string; playlists: { name: string; tracks: Partial<Track>[]; targetPlaylistId?: string }[] };
}

export function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Checks an uploaded song list and keeps only the fields we use. */
export function cleanFileTracks(tracks: unknown): Track[] {
  if (!Array.isArray(tracks)) throw new HttpError(400, "Each playlist needs a list of songs");
  return tracks
    .map((t: any) => ({
      title: str(t?.title, 300),
      artist: str(t?.artist, 300),
      album: str(t?.album, 300) || undefined,
      isrc: /^[A-Za-z0-9]{12}$/.test(str(t?.isrc, 15)) ? str(t.isrc, 15).toUpperCase() : undefined,
      durationMs: Number.isFinite(t?.durationMs) && t.durationMs > 0 ? Math.round(t.durationMs) : undefined,
    }))
    .filter((t) => t.title && t.artist);
}

async function connected(env: Env, userId: string, platform: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 FROM connections WHERE user_id = ?1 AND platform = ?2")
    .bind(userId, platform)
    .first();
  return !!row;
}

/** Refuses a new run when the user already has as many transfers running as their plan allows. */
export async function requireFreeSlot(env: Env, user: User): Promise<void> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM transfer_jobs WHERE user_id = ?1 AND status IN ${ACTIVE}`)
    .bind(user.id)
    .first<{ n: number }>();
  const limit = limitsFor(user).activeTransfers;
  if ((row?.n ?? 0) >= limit) {
    const what = limit === 1 ? "a transfer running" : `${limit} transfers running`;
    throw new HttpError(409, `You already have ${what}. Please wait for it to finish.${upgradeHint(user)}`);
  }
}

/** Hands a job to the runner; marks it FAILED if that does not work. */
export async function startJob(env: Env, spec: JobSpec, state?: JobState): Promise<void> {
  try {
    await startJobRun(env, spec, state);
  } catch (err) {
    await env.DB.prepare("UPDATE transfer_jobs SET status = 'FAILED', message = 'Could not start', finished_at = ?2 WHERE id = ?1")
      .bind(spec.jobId, Date.now())
      .run();
    throw err;
  }
}

export async function createJob(env: Env, user: User, body: CreateJobBody): Promise<Response> {
  const { source, dest } = body;
  if (!isPlatform(dest)) throw new HttpError(400, "Pick where the music should go");
  if (source !== "file" && !isPlatform(source)) throw new HttpError(400, "Pick where the music comes from");
  if (source === dest && dest !== "mock") throw new HttpError(400, "Source and destination must be different services");
  if (!(await connected(env, user.id, dest))) throw new HttpError(400, "Connect the destination service first");
  if (source !== "file" && !(await connected(env, user.id, source))) throw new HttpError(400, "Connect the source service first");
  await requireFreeSlot(env, user);

  const target = (value: unknown) => str(value, 200) || undefined;
  let selections: Selection[];
  let fileTracks: Track[][] = [];
  if (source === "file") {
    const playlists = body.file?.playlists;
    if (!Array.isArray(playlists) || !playlists.length) throw new HttpError(400, "The file has no playlists");
    if (playlists.length > MAX_SELECTIONS) throw new HttpError(400, `At most ${MAX_SELECTIONS} playlists per transfer`);
    fileTracks = playlists.map((p) => cleanFileTracks(p.tracks));
    const total = fileTracks.reduce((n, t) => n + t.length, 0);
    const maxTracks = limitsFor(user).fileTracks;
    if (!total) throw new HttpError(400, "No songs found in the file");
    if (total > maxTracks) throw new HttpError(400, `At most ${maxTracks.toLocaleString("en-US")} songs per file.${upgradeHint(user)}`);
    selections = playlists.map((p) => ({
      kind: "playlist",
      name: str(p.name, 100) || "Imported playlist",
      targetPlaylistId: target(p.targetPlaylistId),
    }));
  } else {
    const raw = body.selections ?? [];
    if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, "Pick at least one playlist");
    if (raw.length > MAX_SELECTIONS) throw new HttpError(400, `At most ${MAX_SELECTIONS} playlists per transfer`);
    selections = raw.map((s) => {
      if (s.kind === "liked") return { kind: "liked", name: "Liked Songs" };
      if (s.kind !== "playlist" || !str(s.id, 200)) throw new HttpError(400, "Invalid playlist selection");
      return { kind: "playlist", id: str(s.id, 200), name: str(s.name, 100) || "Untitled playlist", targetPlaylistId: target(s.targetPlaylistId) };
    });
  }

  const jobId = crypto.randomUUID();
  const now = Date.now();
  const what = selections.length === 1 ? selections[0].name : `${selections.length} playlists`;
  await env.DB.prepare(
    `INSERT INTO transfer_jobs (id, user_id, source, dest, title, selections, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'QUEUED', ?7, ?7)`,
  )
    .bind(jobId, user.id, source, dest, what, JSON.stringify(selections), now)
    .run();
  await insertSelections(env.DB, jobId, selections, source === "file");
  for (let i = 0; i < fileTracks.length; i++) await insertTracks(env.DB, jobId, i, 0, fileTracks[i]);

  await startJob(env, { jobId, userId: user.id, source: source as Platform | "file", dest: dest as Platform, selections });
  return json({ id: jobId }, 201);
}

export async function listJobs(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, source, dest, title, status, sync_id, created_at, finished_at FROM transfer_jobs
     WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all();
  return json({ jobs: results });
}

async function ownedJob(env: Env, user: User, jobId: string) {
  const job = await env.DB.prepare(
    `SELECT id, source, dest, title, selections, status, message, sync_id, created_at, updated_at, finished_at
     FROM transfer_jobs WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(jobId, user.id)
    .first<any>();
  if (!job) throw new HttpError(404, "Transfer not found");
  return job;
}

export async function getJob(env: Env, user: User, jobId: string): Promise<Response> {
  const job = await ownedJob(env, user, jobId);
  const { results } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n, SUM(written = 1) AS written, SUM(written = 2) AS already
     FROM transfer_items WHERE job_id = ?1 GROUP BY status`,
  )
    .bind(jobId)
    .all<{ status: string; n: number; written: number; already: number }>();
  const counts: Record<string, number> = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0]));
  let written = 0;
  let alreadyThere = 0;
  for (const r of results) {
    counts[r.status] = r.n;
    written += r.written ?? 0;
    alreadyThere += r.already ?? 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const { results: playlists } = await env.DB.prepare(
    `SELECT sel_index, kind, name, target_playlist_id, dest_playlist_id, read_done, write_done
     FROM transfer_selections WHERE job_id = ?1 ORDER BY sel_index`,
  )
    .bind(jobId)
    .all();
  return json({ ...job, selections: JSON.parse(job.selections), playlists, counts, total, written, alreadyThere });
}

export async function listJobItems(env: Env, user: User, jobId: string, url: URL): Promise<Response> {
  await ownedJob(env, user, jobId);
  const status = url.searchParams.get("status");
  const already = url.searchParams.get("filter") === "already" ? 1 : 0;
  const offset = Math.max(0, Math.min(100_000, Number(url.searchParams.get("offset")) || 0));
  const filter = status && ITEM_STATUSES.includes(status) ? status : null;
  const { results } = await env.DB.prepare(
    `SELECT id, sel_index, position, src_title, src_artist, src_album, src_isrc, dest_id, dest_title, dest_artist,
            confidence, method, status, written
     FROM transfer_items WHERE job_id = ?1 AND (?2 IS NULL OR status = ?2) AND (?4 = 0 OR written = 2)
     ORDER BY sel_index, position LIMIT 100 OFFSET ?3`,
  )
    .bind(jobId, filter, offset, already)
    .all();
  return json({ items: results, offset, hasMore: results.length === 100 });
}

export async function cancelJob(env: Env, user: User, jobId: string): Promise<Response> {
  const job = await ownedJob(env, user, jobId);
  if (!["QUEUED", "RUNNING", "WAITING"].includes(job.status)) throw new HttpError(409, "This transfer is not running");
  await cancelJobRun(env, jobId);
  await env.DB.prepare(
    `UPDATE transfer_jobs SET status = 'CANCELLED', message = 'Stopped by you.', updated_at = ?2, finished_at = ?2
     WHERE id = ?1 AND status IN ${ACTIVE}`,
  )
    .bind(jobId, Date.now())
    .run();
  return json({ ok: true });
}

export async function retryJob(env: Env, user: User, jobId: string, body: { includeUnsure?: boolean }): Promise<Response> {
  const job = await ownedJob(env, user, jobId);
  if (!FINISHED.includes(job.status)) throw new HttpError(409, "This transfer is still running");
  await requireFreeSlot(env, user);

  const statuses = body?.includeUnsure === true ? ["FAILED", "LOW_CONFIDENCE"] : ["FAILED"];
  await env.DB.batch([
    // Songs only partly read when the job stopped are read again from the start.
    env.DB.prepare(
      `DELETE FROM transfer_items WHERE job_id = ?1
         AND sel_index IN (SELECT sel_index FROM transfer_selections WHERE job_id = ?1 AND read_done = 0)`,
    ).bind(jobId),
    env.DB.prepare(
      `UPDATE transfer_items SET status = 'PENDING', dest_id = NULL, dest_title = NULL, dest_artist = NULL,
         confidence = NULL, method = NULL
       WHERE job_id = ?1 AND written = 0 AND status IN (SELECT value FROM json_each(?2))`,
    ).bind(jobId, JSON.stringify(statuses)),
    env.DB.prepare(
      `UPDATE transfer_selections SET write_done = 0 WHERE job_id = ?1 AND sel_index IN (
         SELECT DISTINCT sel_index FROM transfer_items
         WHERE job_id = ?1 AND (status = 'PENDING' OR (status = 'MATCHED' AND written = 0)))`,
    ).bind(jobId),
  ]);

  const spec: JobSpec = {
    jobId,
    userId: user.id,
    source: job.source,
    dest: job.dest,
    selections: JSON.parse(job.selections),
    syncId: job.sync_id ?? undefined,
  };
  const state = await selectionState(env.DB, spec, 0);
  if (!state) throw new HttpError(409, "There is nothing left to try again.");

  await env.DB.prepare(
    "UPDATE transfer_jobs SET status = 'QUEUED', message = NULL, finished_at = NULL, updated_at = ?2 WHERE id = ?1",
  )
    .bind(jobId, Date.now())
    .run();
  await startJob(env, spec, state);
  return json({ ok: true });
}
