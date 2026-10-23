// Shared set-up for route and job tests: a test database, a signed-in user with the
// Demo service connected, and a fake Durable Object namespace that records what was started.
import { vi } from "vitest";
import { toBase64 } from "../src/crypto";
import { saveConnection } from "../src/connections";
import { createMockAdapter } from "../src/adapters/mock";
import { insertSelections, initialState, runStep, type JobSpec, type JobState, type Selection } from "../src/jobs/engine";
import { createTestDb } from "./d1-shim";

export const KEY = toBase64(new Uint8Array(32).fill(7));
export const USER = { id: "u1", email: "x@example.com", plan: "free", plan_until: null };
export const direct = <T>(fn: (t: string) => Promise<T>) => fn("token");

export async function testEnv() {
  const DB = createTestDb();
  DB.raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'x@example.com', 0)").run();
  const started: { spec: JobSpec; state?: JobState }[] = [];
  const cancelled: string[] = [];
  const env: any = {
    DB,
    TOKEN_KEY: KEY,
    ENABLE_MOCK: "1",
    TRANSFER_JOB: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        start: vi.fn(async (spec: JobSpec, state?: JobState) => void started.push({ spec, state })),
        cancel: vi.fn(async () => void cancelled.push(id)),
      }),
    },
  };
  await saveConnection(env, "u1", "mock", { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000 });
  return { env, db: DB, started, cancelled };
}

/** Inserts a job + its selections the way createJob does. */
export async function addJob(db: any, spec: Partial<JobSpec> & { selections: Selection[] }, status = "QUEUED") {
  const full: JobSpec = { jobId: crypto.randomUUID(), userId: "u1", source: "mock", dest: "mock", ...spec };
  db.raw
    .prepare(
      "INSERT INTO transfer_jobs (id, user_id, source, dest, title, selections, status, sync_id, created_at, updated_at) VALUES (?, 'u1', ?, ?, 't', ?, ?, ?, 0, 0)",
    )
    .run(full.jobId, full.source, full.dest, JSON.stringify(full.selections), status, full.syncId ?? null);
  await insertSelections(db, full.jobId, full.selections, full.source === "file");
  return full;
}

/** Runs a job to the end (or until `stopAt` says stop), like the Durable Object would. */
export async function runJob(spec: JobSpec, deps: any, state: JobState | null = initialState(spec), stopAt?: (s: JobState) => boolean) {
  let steps = 0;
  let maxQueries = 0;
  while (state && steps < 2000) {
    if (stopAt?.(state)) return { state, steps, maxQueries };
    const before = deps.db.counter.queries;
    state = await runStep(spec, state, deps);
    maxQueries = Math.max(maxQueries, deps.db.counter.queries - before);
    steps++;
  }
  return { state, steps, maxQueries };
}

export function mockDeps(db: any, dest = createMockAdapter(), source = createMockAdapter()) {
  return { db, source, dest, withSourceToken: direct, withDestToken: direct };
}

export const one = (db: any, sql: string, ...params: unknown[]) => db.raw.prepare(sql).get(...params) as any;
export const all = (db: any, sql: string, ...params: unknown[]) => db.raw.prepare(sql).all(...params) as any[];
