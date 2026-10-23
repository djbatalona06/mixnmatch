// Starting transfers and reading their progress.
import { isPlatform } from "../adapters/registry";
import type { Platform, Track } from "../adapters/types";
import type { User } from "../auth/session";
import type { Env } from "../env";
import { insertTracks, type JobSpec, type Selection } from "../jobs/engine";
import { HttpError, json } from "../web";

export const MAX_SELECTIONS = 50;
export const MAX_FILE_TRACKS = 5000;
const ACTIVE = "('QUEUED','RUNNING','WAITING')";

interface CreateJobBody {
  source: string;
  dest: string;
  selections?: { kind: string; id?: string; name?: string }[];
  file?: { name?: string; playlists: { name: string; tracks: Partial<Track>[] }[] };
}

function str(value: unknown, max: number): string {
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

export async function createJob(env: Env, user: User, body: CreateJobBody): Promise<Response> {
  const { source, dest } = body;
  if (!isPlatform(dest)) throw new HttpError(400, "Pick where the music should go");
  if (source !== "file" && !isPlatform(source)) throw new HttpError(400, "Pick where the music comes from");
  if (source === dest && dest !== "mock") throw new HttpError(400, "Source and destination must be different services");
  if (!(await connected(env, user.id, dest))) throw new HttpError(400, "Connect the destination service first");
  if (source !== "file" && !(await connected(env, user.id, source))) throw new HttpError(400, "Connect the source service first");

  const active = await env.DB.prepare(`SELECT id FROM transfer_jobs WHERE user_id = ?1 AND status IN ${ACTIVE} LIMIT 1`)
    .bind(user.id)
    .first<{ id: string }>();
  // ponytail: one running transfer per user keeps free-plan usage predictable; lift for Premium.
  if (active) throw new HttpError(409, "You already have a transfer running. Please wait for it to finish.");

  let selections: Selection[];
  let fileTracks: Track[][] = [];
  if (source === "file") {
    const playlists = body.file?.playlists;
    if (!Array.isArray(playlists) || !playlists.length) throw new HttpError(400, "The file has no playlists");
    if (playlists.length > MAX_SELECTIONS) throw new HttpError(400, `At most ${MAX_SELECTIONS} playlists per transfer`);
    fileTracks = playlists.map((p) => cleanFileTracks(p.tracks));
    const total = fileTracks.reduce((n, t) => n + t.length, 0);
    if (!total) throw new HttpError(400, "No songs found in the file");
    if (total > MAX_FILE_TRACKS) throw new HttpError(400, `At most ${MAX_FILE_TRACKS} songs per file`);
    selections = playlists.map((p) => ({ kind: "playlist", name: str(p.name, 100) || "Imported playlist" }));
  } else {
    const raw = body.selections ?? [];
    if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, "Pick at least one playlist");
    if (raw.length > MAX_SELECTIONS) throw new HttpError(400, `At most ${MAX_SELECTIONS} playlists per transfer`);
    selections = raw.map((s) => {
      if (s.kind === "liked") return { kind: "liked", name: "Liked Songs" };
      if (s.kind !== "playlist" || !str(s.id, 200)) throw new HttpError(400, "Invalid playlist selection");
      return { kind: "playlist", id: str(s.id, 200), name: str(s.name, 100) || "Untitled playlist" };
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

  for (let i = 0; i < fileTracks.length; i++) await insertTracks(env.DB, jobId, i, 0, fileTracks[i]);

  const spec: JobSpec = { jobId, userId: user.id, source: source as Platform | "file", dest: dest as Platform, selections };
  const stub = env.TRANSFER_JOB.get(env.TRANSFER_JOB.idFromName(jobId)) as any;
  try {
    await stub.start(spec);
  } catch (err) {
    await env.DB.prepare("UPDATE transfer_jobs SET status = 'FAILED', message = 'Could not start', finished_at = ?2 WHERE id = ?1")
      .bind(jobId, Date.now())
      .run();
    throw err;
  }
  return json({ id: jobId }, 201);
}

export async function listJobs(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, source, dest, title, status, created_at, finished_at FROM transfer_jobs
     WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all();
  return json({ jobs: results });
}

export async function getJob(env: Env, user: User, jobId: string): Promise<Response> {
  const job = await env.DB.prepare(
    `SELECT id, source, dest, title, selections, status, message, created_at, updated_at, finished_at
     FROM transfer_jobs WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(jobId, user.id)
    .first<any>();
  if (!job) throw new HttpError(404, "Transfer not found");

  const { results } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n, SUM(written) AS written FROM transfer_items WHERE job_id = ?1 GROUP BY status`,
  )
    .bind(jobId)
    .all<{ status: string; n: number; written: number }>();
  const counts: Record<string, number> = { PENDING: 0, MATCHED: 0, LOW_CONFIDENCE: 0, FAILED: 0 };
  let written = 0;
  for (const r of results) {
    counts[r.status] = r.n;
    written += r.written ?? 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return json({ ...job, selections: JSON.parse(job.selections), counts, total, written });
}

export async function listJobItems(env: Env, user: User, jobId: string, url: URL): Promise<Response> {
  const owner = await env.DB.prepare("SELECT 1 FROM transfer_jobs WHERE id = ?1 AND user_id = ?2").bind(jobId, user.id).first();
  if (!owner) throw new HttpError(404, "Transfer not found");

  const status = url.searchParams.get("status");
  const allowed = ["PENDING", "MATCHED", "LOW_CONFIDENCE", "FAILED"];
  const offset = Math.max(0, Math.min(100_000, Number(url.searchParams.get("offset")) || 0));
  const filter = status && allowed.includes(status) ? status : null;
  const { results } = await env.DB.prepare(
    `SELECT sel_index, position, src_title, src_artist, src_album, src_isrc, dest_id, dest_title, dest_artist,
            confidence, method, status, written
     FROM transfer_items WHERE job_id = ?1 AND (?2 IS NULL OR status = ?2)
     ORDER BY sel_index, position LIMIT 100 OFFSET ?3`,
  )
    .bind(jobId, filter, offset)
    .all();
  return json({ items: results, offset, hasMore: results.length === 100 });
}
