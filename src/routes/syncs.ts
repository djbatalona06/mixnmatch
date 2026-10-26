// Auto-Sync (FR-06): "keep this playlist copied". One-way and add-only, once a day.
//
// A sync run is a normal transfer job that adds into the existing copy (so v1.1's
// "skip songs already there" applies), and only reads songs it has never seen before
// (sync_seen), so a song you removed from the copy is never put back.
import { platformName } from "../adapters/registry";
import type { User } from "../auth/session";
import type { Env } from "../env";
import { initialState, type JobSpec, type Selection } from "../jobs/engine";
import { limitsFor, upgradeHint } from "../plans";
import { HttpError, json } from "../web";
import { ACTIVE } from "./jobs";

const DAY = 86400_000;
const HOUR = 3600_000;
export const SYNCS_PER_CRON = 20;
const COUNTED = "('ACTIVE','NEEDS_USER')";

export async function createSync(env: Env, user: User, body: { jobId?: string; selIndex?: number }): Promise<Response> {
  const jobId = String(body?.jobId ?? "");
  const selIndex = Number(body?.selIndex);
  if (!/^[0-9a-f-]{36}$/.test(jobId) || !Number.isInteger(selIndex)) throw new HttpError(400, "Pick a playlist from a finished transfer");

  const row = await env.DB.prepare(
    `SELECT j.source, j.dest, j.status, s.kind, s.name, s.source_id, s.dest_playlist_id
     FROM transfer_jobs AS j JOIN transfer_selections AS s ON s.job_id = j.id
     WHERE j.id = ?1 AND j.user_id = ?2 AND s.sel_index = ?3`,
  )
    .bind(jobId, user.id, selIndex)
    .first<any>();
  if (!row) throw new HttpError(404, "Transfer not found");
  if (row.status !== "DONE") throw new HttpError(409, "Wait until the transfer is done");
  if (row.source === "file") throw new HttpError(400, "A file can't change, so there is nothing to keep in sync");
  if (row.kind !== "playlist" || !row.source_id || !row.dest_playlist_id) throw new HttpError(400, "Only playlists can be kept in sync");
  // ponytail: YouTube's 10,000 units/day are shared by everyone; lift once Google raises the quota.
  if (row.dest === "youtube") throw new HttpError(400, "Syncing into YouTube is switched off for now: its small daily allowance is shared by everyone.");

  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM syncs WHERE user_id = ?1 AND status IN ${COUNTED}`)
    .bind(user.id)
    .first<{ n: number }>();
  const limit = limitsFor(user).syncs;
  if ((count?.n ?? 0) >= limit) throw new HttpError(409, `You can keep ${limit === 1 ? "1 playlist" : `${limit} playlists`} in sync.${upgradeHint(user)}`);

  const id = crypto.randomUUID();
  const now = Date.now();
  const inserted = await env.DB.prepare(
    `INSERT INTO syncs (id, user_id, source, dest, source_id, dest_playlist_id, name, status, last_job_id, next_run_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ACTIVE', ?8, ?9, ?10)
     ON CONFLICT (user_id, source, source_id, dest) DO NOTHING RETURNING id`,
  )
    .bind(id, user.id, row.source, row.dest, row.source_id, row.dest_playlist_id, row.name, jobId, now + DAY, now)
    .first();
  if (!inserted) throw new HttpError(409, "This playlist is already being kept in sync");

  // Everything in the first transfer counts as "seen", so day one only adds truly new songs.
  // ponytail: transfers from before v1.2 have no src_key, so their first sync run re-checks every song
  // ("already there" still stops duplicates); fine unless old transfers are synced in bulk.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sync_seen (sync_id, key)
     SELECT ?1, src_key FROM transfer_items WHERE job_id = ?2 AND sel_index = ?3 AND src_key IS NOT NULL`,
  )
    .bind(id, jobId, selIndex)
    .run();
  return json({ id }, 201);
}

export async function listSyncs(env: Env, user: User): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, source, dest, name, status, message, last_job_id, last_run_at, last_added, next_run_at, created_at
     FROM syncs WHERE user_id = ?1 ORDER BY created_at`,
  )
    .bind(user.id)
    .all();
  return json({ syncs: results, limit: limitsFor(user).syncs });
}

export async function updateSync(env: Env, user: User, syncId: string, body: { status?: string }): Promise<Response> {
  const status = body?.status;
  if (status !== "ACTIVE" && status !== "PAUSED") throw new HttpError(400, "Status must be ACTIVE or PAUSED");
  const sync = await env.DB.prepare("SELECT status FROM syncs WHERE id = ?1 AND user_id = ?2").bind(syncId, user.id).first<{ status: string }>();
  if (!sync) throw new HttpError(404, "Sync not found");
  if (status === "ACTIVE" && sync.status === "PAUSED") {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM syncs WHERE user_id = ?1 AND status IN ${COUNTED}`)
      .bind(user.id)
      .first<{ n: number }>();
    const limit = limitsFor(user).syncs;
    if ((count?.n ?? 0) >= limit) throw new HttpError(409, `You can keep ${limit === 1 ? "1 playlist" : `${limit} playlists`} in sync.${upgradeHint(user)}`);
  }
  await env.DB.prepare("UPDATE syncs SET status = ?3, message = NULL WHERE id = ?1 AND user_id = ?2")
    .bind(syncId, user.id, status)
    .run();
  return json({ ok: true });
}

export async function deleteSync(env: Env, user: User, syncId: string): Promise<Response> {
  const row = await env.DB.prepare("DELETE FROM syncs WHERE id = ?1 AND user_id = ?2 RETURNING id").bind(syncId, user.id).first();
  if (!row) throw new HttpError(404, "Sync not found");
  await env.DB.prepare("DELETE FROM sync_seen WHERE sync_id = ?1").bind(syncId).run();
  return json({ ok: true });
}

/**
 * Hourly cron: starts due syncs. Only cheap database work happens here (a handful of
 * queries for up to 20 syncs); the actual copying runs in the job runner (src/jobs/runner.ts).
 * One sync per user per hour, and never while that user has a transfer running.
 */
export async function runDueSyncs(env: Env, now = Date.now()): Promise<number> {
  const { results: due } = await env.DB.prepare(
    `SELECT s.* FROM syncs AS s
     WHERE s.status = 'ACTIVE' AND s.next_run_at <= ?1
       AND NOT EXISTS (SELECT 1 FROM transfer_jobs AS j WHERE j.user_id = s.user_id AND j.status IN ${ACTIVE})
     ORDER BY s.next_run_at LIMIT ?2`,
  )
    .bind(now, SYNCS_PER_CRON)
    .all<any>();
  const seenUsers = new Set<string>();
  const picked = due.filter((s) => !seenUsers.has(s.user_id) && seenUsers.add(s.user_id));
  if (!picked.length) return 0;

  const jobs = picked.map((s) => {
    const selection: Selection = { kind: "playlist", id: s.source_id, name: s.name, targetPlaylistId: s.dest_playlist_id };
    const spec: JobSpec = { jobId: crypto.randomUUID(), userId: s.user_id, source: s.source, dest: s.dest, selections: [selection], syncId: s.id };
    return { sync: s, spec, selection };
  });
  const rows = jobs.map((j) => ({
    id: j.spec.jobId,
    run: JSON.stringify(j.spec),
    first: JSON.stringify(initialState(j.spec)),
    u: j.sync.user_id,
    s: j.sync.source,
    d: j.sync.dest,
    t: `Sync: ${j.sync.name}`.slice(0, 120),
    sel: JSON.stringify([j.selection]),
    sy: j.sync.id,
    n: j.selection.name,
    si: j.sync.source_id,
    dp: j.sync.dest_playlist_id,
  }));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO transfer_jobs (id, user_id, source, dest, title, selections, status, sync_id, created_at, updated_at)
       SELECT j.value ->> 'id', j.value ->> 'u', j.value ->> 's', j.value ->> 'd', j.value ->> 't', j.value ->> 'sel',
              'QUEUED', j.value ->> 'sy', ?2, ?2
       FROM json_each(?1) AS j`,
    ).bind(JSON.stringify(rows), now),
    env.DB.prepare(
      `INSERT INTO transfer_selections (job_id, sel_index, kind, name, source_id, target_playlist_id, dest_playlist_id)
       SELECT j.value ->> 'id', 0, 'playlist', j.value ->> 'n', j.value ->> 'si', j.value ->> 'dp', j.value ->> 'dp'
       FROM json_each(?1) AS j`,
    ).bind(JSON.stringify(rows)),
    // The job runner picks these up on its next cron call.
    env.DB.prepare(
      `INSERT INTO job_runs (job_id, spec, state, run_at)
       SELECT j.value ->> 'id', j.value ->> 'run', j.value ->> 'first', ?2
       FROM json_each(?1) AS j`,
    ).bind(JSON.stringify(rows), now),
    // Guard: if a run never reports back, try again in an hour instead of every cron.
    env.DB.prepare(
      `UPDATE syncs SET next_run_at = ?2, last_job_id = (SELECT j.value ->> 'id' FROM json_each(?1) AS j WHERE j.value ->> 'sy' = syncs.id)
       WHERE id IN (SELECT j.value ->> 'sy' FROM json_each(?1) AS j)`,
    ).bind(JSON.stringify(rows), now + HOUR),
  ]);

  return jobs.length;
}

/** Called by the job runner when a sync run ends. */
export async function finishSyncRun(env: Env, spec: JobSpec, status: "DONE" | "FAILED", reason: "auth" | "gone" | undefined, now = Date.now()) {
  const syncId = spec.syncId!;
  if (status === "FAILED") {
    const apps = `${platformName(spec.source)} or ${platformName(spec.dest)}`;
    const message =
      reason === "auth"
        ? `Reconnect ${apps} to keep syncing.`
        : reason === "gone"
          ? `The playlist was removed on ${apps}.`
          : "The last run didn't finish. We'll try again tomorrow.";
    await env.DB.prepare(
      `UPDATE syncs SET status = CASE WHEN ?3 = 1 THEN 'NEEDS_USER' ELSE status END, message = ?2,
         last_run_at = ?4, next_run_at = ?5 WHERE id = ?1`,
    )
      .bind(syncId, message, reason ? 1 : 0, now, now + DAY)
      .run();
    return;
  }

  const counts = await env.DB.prepare("SELECT COUNT(*) AS total, SUM(written = 1) AS added FROM transfer_items WHERE job_id = ?1")
    .bind(spec.jobId)
    .first<{ total: number; added: number | null }>();
  const total = counts?.total ?? 0;
  const added = counts?.added ?? 0;
  // A song is tried once: matched, not found or skipped alike. Unsure ones can be fixed on the results page.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO sync_seen (sync_id, key) SELECT ?1, src_key FROM transfer_items WHERE job_id = ?2 AND src_key IS NOT NULL",
    ).bind(syncId, spec.jobId),
    env.DB.prepare(
      `UPDATE syncs SET last_run_at = ?2, last_added = ?3, last_job_id = ?4, next_run_at = ?5, message = NULL WHERE id = ?1`,
    ).bind(syncId, now, added, total ? spec.jobId : null, now + DAY),
  ]);
  // Nothing new today: don't fill the dashboard with empty runs.
  if (!total) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM transfer_selections WHERE job_id = ?1").bind(spec.jobId),
      env.DB.prepare("DELETE FROM transfer_jobs WHERE id = ?1").bind(spec.jobId),
    ]);
  }
}

/** After reconnecting an app, syncs that were waiting on it start again. */
export async function reactivateSyncs(env: Env, userId: string, platform: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE syncs SET status = 'ACTIVE', message = NULL, next_run_at = MIN(next_run_at, ?3)
     WHERE user_id = ?1 AND status = 'NEEDS_USER' AND (source = ?2 OR dest = ?2)`,
  )
    .bind(userId, platform, Date.now() + HOUR)
    .run();
}

/** When Premium ends: keep the oldest sync running, pause the rest (never delete). */
export async function pauseExtraSyncs(env: Env, userId: string, keep: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE syncs SET status = 'PAUSED', message = 'Paused because Premium ended.'
     WHERE user_id = ?1 AND status IN ${COUNTED}
       AND id NOT IN (SELECT id FROM syncs WHERE user_id = ?1 AND status IN ${COUNTED} ORDER BY created_at LIMIT ?2)`,
  )
    .bind(userId, keep)
    .run();
}
