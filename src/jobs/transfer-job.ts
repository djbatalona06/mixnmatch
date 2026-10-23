// One Durable Object per transfer. It wakes itself up with alarms, runs one
// small engine step each time, and pauses politely when a service says "slow down".
import { DurableObject } from "cloudflare:workers";
import { getAdapter } from "../adapters/registry";
import { withToken } from "../connections";
import type { Env } from "../env";
import { AuthError, QuotaError, RateLimitError } from "../http";
import { initialState, runStep, type JobSpec, type JobState } from "./engine";

const MAX_ERRORS = 5;
const PLATFORM_NAMES: Record<string, string> = {
  spotify: "Spotify",
  tidal: "TIDAL",
  deezer: "Deezer",
  youtube: "YouTube",
  mock: "Demo Music",
};

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5);
}

export class TransferJob extends DurableObject<Env> {
  async start(spec: JobSpec): Promise<void> {
    await this.ctx.storage.put("spec", spec);
    await this.ctx.storage.put("state", initialState(spec));
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const spec = await this.ctx.storage.get<JobSpec>("spec");
    const state = await this.ctx.storage.get<JobState>("state");
    if (!spec || !state) return;

    const env = this.env;
    const source = spec.source === "file" ? undefined : getAdapter(env, spec.source);
    const dest = getAdapter(env, spec.dest);

    try {
      await this.setStatus(spec, "RUNNING", null);
      const next = await runStep(spec, state, {
        db: env.DB,
        source,
        dest,
        withSourceToken: (fn) => withToken(env, spec.userId, source!, fn),
        withDestToken: (fn) => withToken(env, spec.userId, dest, fn),
      });
      if (!next) {
        await this.finish(spec, "DONE", null);
        return;
      }
      await this.ctx.storage.put("state", { ...next, errors: 0 });
      await this.ctx.storage.setAlarm(Date.now() + 50);
    } catch (err) {
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
      await this.setStatus(spec, "WAITING", `Today's ${PLATFORM_NAMES[err.platform] ?? err.platform} allowance is used up. Continuing automatically after midnight (UTC).`);
      await this.ctx.storage.setAlarm(nextUtcMidnight());
      return;
    }
    if (err instanceof AuthError) {
      await this.finish(spec, "FAILED", `${err.message}. Please reconnect the service and start the transfer again.`);
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

  private async setStatus(spec: JobSpec, status: string, message: string | null): Promise<void> {
    await this.env.DB.prepare("UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4 WHERE id = ?1")
      .bind(spec.jobId, status, message, Date.now())
      .run();
  }

  private async finish(spec: JobSpec, status: "DONE" | "FAILED", message: string | null): Promise<void> {
    const now = Date.now();
    await this.env.DB.prepare(
      "UPDATE transfer_jobs SET status = ?2, message = ?3, updated_at = ?4, finished_at = ?4 WHERE id = ?1",
    )
      .bind(spec.jobId, status, message, now)
      .run();
    // Nothing left to remember: the results live in D1.
    await this.ctx.storage.deleteAll();
  }
}
