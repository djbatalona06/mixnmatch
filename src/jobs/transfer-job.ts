// One Durable Object per transfer. It wakes itself up with alarms, runs one
// small engine step each time, and pauses politely when a service says "slow down".
import { DurableObject } from "cloudflare:workers";
import { getAdapter, platformName } from "../adapters/registry";
import { withToken } from "../connections";
import type { Env } from "../env";
import { ApiError, AuthError, QuotaError, RateLimitError } from "../http";
import { finishSyncRun } from "../routes/syncs";
import { initialState, runStep, type JobSpec, type JobState } from "./engine";

const MAX_ERRORS = 5;

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5);
}

export class TransferJob extends DurableObject<Env> {
  // Set by cancel(). An alarm that was already running checks it before scheduling more work.
  private cancelled = false;

  /** Starts (or, for Try again, resumes from `state`) a transfer. */
  async start(spec: JobSpec, state?: JobState): Promise<void> {
    this.cancelled = false;
    await this.ctx.storage.put("spec", spec);
    await this.ctx.storage.put("state", state ?? initialState(spec));
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** The user pressed Stop. Songs already added stay where they are. */
  async cancel(): Promise<void> {
    this.cancelled = true;
    const spec = await this.ctx.storage.get<JobSpec>("spec");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (spec) {
      await this.env.DB.prepare(
        `UPDATE transfer_jobs SET status = 'CANCELLED', message = 'Stopped by you.', updated_at = ?2, finished_at = ?2
         WHERE id = ?1 AND status IN ('QUEUED','RUNNING','WAITING')`,
      )
        .bind(spec.jobId, Date.now())
        .run();
    }
  }

  async alarm(): Promise<void> {
    const spec = await this.ctx.storage.get<JobSpec>("spec");
    const state = await this.ctx.storage.get<JobState>("state");
    if (!spec || !state || this.cancelled) return;

    const env = this.env;
    const source = spec.source === "file" ? undefined : getAdapter(env, spec.source);
    const dest = getAdapter(env, spec.dest);

    try {
      // No row changed = the job was stopped (or deleted) in the meantime.
      if (!(await this.setStatus(spec, "RUNNING", null))) return this.stop();
      const next = await runStep(spec, state, {
        db: env.DB,
        source,
        dest,
        withSourceToken: (fn) => withToken(env, spec.userId, source!, fn),
        withDestToken: (fn) => withToken(env, spec.userId, dest, fn),
      });
      if (this.cancelled) return;
      if (!next) {
        await this.finish(spec, "DONE", null);
        return;
      }
      await this.ctx.storage.put("state", { ...next, errors: 0 });
      await this.ctx.storage.setAlarm(Date.now() + 50);
    } catch (err) {
      if (this.cancelled) return;
      await this.handleError(spec, state, err);
    }
  }

  private async handleError(spec: JobSpec, state: JobState, err: unknown): Promise<void> {
    if (err instanceof RateLimitError) {
      await this.setStatus(spec, "WAITING", `A music service asked us to slow down. Resuming in ${err.retryAfterSec} seconds.`);
      await this.ctx.storage.setAlarm(Date.now() + err.retryAfterSec * 1000);
      return;
    }
    if (err instanceof QuotaError) {
      await this.setStatus(spec, "WAITING", `Today's ${platformName(err.platform)} allowance is used up. Continuing automatically after midnight (UTC).`);
      await this.ctx.storage.setAlarm(nextUtcMidnight());
      return;
    }
    if (err instanceof AuthError) {
      await this.finish(spec, "FAILED", `${err.message}. Please reconnect the service, then press Try again.`, "auth");
      return;
    }
    if (spec.syncId && err instanceof ApiError && err.status === 404) {
      await this.finish(spec, "FAILED", "A playlist in this sync was removed.", "gone");
      return;
    }
    const errors = state.errors + 1;
    console.error(`job ${spec.jobId} step failed (${errors}/${MAX_ERRORS})`, err);
    if (errors >= MAX_ERRORS) {
      await this.finish(spec, "FAILED", "Something kept going wrong while moving your music. Please try again later.");
      return;
    }
    await this.ctx.storage.put("state", { ...state, errors });
    await this.setStatus(spec, "WAITING", "Hit a hiccup, retrying shortly.");
    await this.ctx.storage.setAlarm(Date.now() + 2 ** errors * 1000);
  }

  /** Returns false when the job is no longer running (stopped by the user, or deleted). */
  private async setStatus(spec: JobSpec, status: string, message: string | null): Promise<boolean> {
    const result = await this.env.DB.prepare(
      `UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4
       WHERE id = ?1 AND status IN ('QUEUED','RUNNING','WAITING')`,
    )
      .bind(spec.jobId, status, message, Date.now())
      .run();
    return (result.meta?.changes ?? 1) > 0;
  }

  private async stop(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private async finish(spec: JobSpec, status: "DONE" | "FAILED", message: string | null, reason?: "auth" | "gone"): Promise<void> {
    const now = Date.now();
    await this.env.DB.prepare(
      `UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4, finished_at = ?4
       WHERE id = ?1 AND status IN ('QUEUED','RUNNING','WAITING')`,
    )
      .bind(spec.jobId, status, message, now)
      .run();
    if (spec.syncId) await finishSyncRun(this.env, spec, status, reason, now);
    // Nothing left to remember: the results live in D1.
    await this.ctx.storage.deleteAll();
  }
}
