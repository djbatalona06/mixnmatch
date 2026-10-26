// The cron that runs the transfers and Auto-Syncs. Vercel calls it once a minute.
import { describe, expect, it } from "vitest";
import { handle } from "../src/index";
import { addJob, all, one, runFor, testEnv } from "./helpers";
import { startJobRun } from "../src/jobs/runner";

const SECRET = "test-cron-secret";
const cronRequest = (auth?: string) =>
  new Request("https://example.test/api/cron/tick", { method: "GET", headers: auth ? { Authorization: auth } : {} });

describe("cron endpoint", () => {
  it("refuses anyone who does not have the cron secret", async () => {
    const { env, db } = await testEnv();
    env.CRON_SECRET = SECRET;
    const spec = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] });
    await startJobRun(env, spec);

    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`]) {
      const res = await handle(cronRequest(auth), env);
      expect(res.status, String(auth)).toBe(401);
    }
    // Nothing ran: the job is still where it was.
    expect(one(db, "SELECT status FROM transfer_jobs WHERE id = ?", spec.jobId).status).toBe("QUEUED");
  });

  it("refuses everything when no secret is configured", async () => {
    const { env } = await testEnv();
    delete env.CRON_SECRET;
    const res = await handle(cronRequest("Bearer "), env);
    expect(res.status).toBe(401);
  });

  it("with the right secret, runs due transfer steps", async () => {
    const { env, db } = await testEnv();
    env.CRON_SECRET = SECRET;
    const spec = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] });
    await startJobRun(env, spec);

    const res = await handle(cronRequest(`Bearer ${SECRET}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; steps: number };
    expect(body.ok).toBe(true);
    expect(body.steps).toBeGreaterThan(0);
    expect(one(db, "SELECT status FROM transfer_jobs WHERE id = ?", spec.jobId).status).not.toBe("QUEUED");
  });

  it("does not run a step twice when two cron calls overlap", async () => {
    const { env, db } = await testEnv();
    env.CRON_SECRET = SECRET;
    const spec = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] });
    await startJobRun(env, spec);

    // Claim the run as if one cron call had just taken it. A second call must not see it as due.
    db.raw.prepare("UPDATE job_runs SET run_at = ? WHERE job_id = ?").run(Date.now() + 60_000, spec.jobId);
    const res = await handle(cronRequest(`Bearer ${SECRET}`), env);
    expect(((await res.json()) as { steps: number }).steps).toBe(0);
    expect(runFor(db, spec.jobId)).not.toBeNull();
    expect(all(db, "SELECT COUNT(*) AS n FROM job_runs")[0].n).toBe(1);
  });
});
