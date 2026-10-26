// The job runner. Every running transfer has one row in job_runs: its settings, its
// progress, and when its next step is due. Vercel's cron calls runDueJobs() once a
// minute. Each call takes due steps one after another until its time budget runs out,
// so a transfer moves quickly while it has work, and pauses politely when a service
// says "slow down".
import { getAdapter, platformName } from "../adapters/registry";
import { withToken } from "../connections";
import type { Env } from "../env";
import { ApiError, AuthError, QuotaError, RateLimitError } from "../http";
import { finishSyncRun } from "../routes/syncs";
import { initialState, runStep, type JobSpec, type JobState } from "./engine";

const MAX_ERRORS = 5;
// A step that never reports back (the function was stopped) is tried again after this.
const LEASE_MS = 10 * 60_000;

interface RunRow {
  job_id: string;
  spec: string;
  state: string;
  run_at: number;
}

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5);
}

/** Starts (or, for Try again, resumes from `state`) a transfer. Its first step is due now. */
export async function startJobRun(env: Env, spec: JobSpec, state?: JobState): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO job_runs (job_id, spec, state, run_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (job_id) DO UPDATE SET spec = excluded.spec, state = excluded.state, run_at = excluded.run_at`,
  )
    .bind(spec.jobId, JSON.stringify(spec), JSON.stringify(state ?? initialState(spec)), Date.now())
    .run();
}

/** The user pressed Stop. Forgetting the run means no step will save anything more. */
export async function cancelJobRun(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM job_runs WHERE job_id = ?1").bind(jobId).run();
}

/** Runs due steps until `budgetMs` is used up. Returns how many steps ran. */
export async function runDueJobs(env: Env, budgetMs: number): Promise<number> {
  const started = Date.now();
  let steps = 0;
  while (Date.now() - started < budgetMs) {
    const row = await claimDueRun(env);
    if (!row) break;
    await stepRun(env, row);
    steps++;
  }
  return steps;
}

/** Runs exactly one step of one transfer. Used by tests and by runDueJobs. */
export async function stepJob(env: Env, jobId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT job_id, spec, state, run_at FROM job_runs WHERE job_id = ?1").bind(jobId).first<RunRow>();
  if (!row) return false;
  await stepRun(env, row);
  return true;
}

/**
 * Picks the oldest due run and pushes its time forward, so two overlapping cron calls
 * never step the same transfer. The update only works if nobody claimed it first.
 */
async function claimDueRun(env: Env): Promise<RunRow | null> {
  for (;;) {
    const row = await env.DB.prepare("SELECT job_id, spec, state, run_at FROM job_runs WHERE run_at <= ?1 ORDER BY run_at LIMIT 1")
      .bind(Date.now())
      .first<RunRow>();
    if (!row) return null;
    const claimed = await env.DB.prepare("UPDATE job_runs SET run_at = ?3 WHERE job_id = ?1 AND run_at = ?2")
      .bind(row.job_id, row.run_at, Date.now() + LEASE_MS)
      .run();
    if (claimed.meta.changes > 0) return row;
  }
}

async function stillRunning(env: Env, jobId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM job_runs WHERE job_id = ?1").bind(jobId).first());
}

/** Saves progress and when to run next. Returns false when the run was stopped meanwhile. */
async function scheduleRun(env: Env, jobId: string, state: JobState, runAt: number): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE job_runs SET state = ?2, run_at = ?3 WHERE job_id = ?1")
    .bind(jobId, JSON.stringify(state), runAt)
    .run();
  return result.meta.changes > 0;
}

async function stepRun(env: Env, row: RunRow): Promise<void> {
  const spec: JobSpec = JSON.parse(row.spec);
  const state: JobState = JSON.parse(row.state);
  const source = spec.source === "file" ? undefined : getAdapter(env, spec.source);
  const dest = getAdapter(env, spec.dest);

  try {
    // No row changed = the job was stopped (or deleted) in the meantime.
    if (!(await setStatus(env, spec, "RUNNING", null))) return void (await cancelJobRun(env, spec.jobId));
    const next = await runStep(spec, state, {
      db: env.DB,
      source,
      dest,
      withSourceToken: (fn) => withToken(env, spec.userId, source!, fn),
      withDestToken: (fn) => withToken(env, spec.userId, dest, fn),
    });
    if (!(await stillRunning(env, spec.jobId))) return;
    if (!next) return void (await finish(env, spec, "DONE", null));
    await scheduleRun(env, spec.jobId, { ...next, errors: 0 }, Date.now());
  } catch (err) {
    if (!(await stillRunning(env, spec.jobId))) return;
    await handleError(env, spec, state, err);
  }
}

async function handleError(env: Env, spec: JobSpec, state: JobState, err: unknown): Promise<void> {
  if (err instanceof RateLimitError) {
    await setStatus(env, spec, "WAITING", `A music service asked us to slow down. Resuming in ${err.retryAfterSec} seconds.`);
    await scheduleRun(env, spec.jobId, state, Date.now() + err.retryAfterSec * 1000);
    return;
  }
  if (err instanceof QuotaError) {
    await setStatus(env, spec, "WAITING", `Today's ${platformName(err.platform)} allowance is used up. Continuing automatically after midnight (UTC).`);
    await scheduleRun(env, spec.jobId, state, nextUtcMidnight());
    return;
  }
  if (err instanceof AuthError) {
    await finish(env, spec, "FAILED", `${err.message}. Please reconnect the service, then press Try again.`, "auth");
    return;
  }
  if (spec.syncId && err instanceof ApiError && err.status === 404) {
    await finish(env, spec, "FAILED", "A playlist in this sync was removed.", "gone");
    return;
  }
  const errors = state.errors + 1;
  console.error(`job ${spec.jobId} step failed (${errors}/${MAX_ERRORS})`, err);
  if (errors >= MAX_ERRORS) {
    await finish(env, spec, "FAILED", "Something kept going wrong while moving your music. Please try again later.");
    return;
  }
  await setStatus(env, spec, "WAITING", "Hit a hiccup, retrying shortly.");
  await scheduleRun(env, spec.jobId, { ...state, errors }, Date.now() + 2 ** errors * 1000);
}

/** Returns false when the job is no longer running (stopped by the user, or deleted). */
async function setStatus(env: Env, spec: JobSpec, status: string, message: string | null): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4
     WHERE id = ?1 AND status IN ('QUEUED','RUNNING','WAITING')`,
  )
    .bind(spec.jobId, status, message, Date.now())
    .run();
  return (result.meta?.changes ?? 1) > 0;
}

async function finish(env: Env, spec: JobSpec, status: "DONE" | "FAILED", message: string | null, reason?: "auth" | "gone"): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4, finished_at = ?4
     WHERE id = ?1 AND status IN ('QUEUED','RUNNING','WAITING')`,
  )
    .bind(spec.jobId, status, message, now)
    .run();
  if (spec.syncId) await finishSyncRun(env, spec, status, reason, now);
  // Nothing left to remember: the results live in the database.
  await cancelJobRun(env, spec.jobId);
}
