import { describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../src/adapters/mock";
import type { PlatformAdapter } from "../src/adapters/types";
import { initialState, insertTracks, runStep, type JobSpec, type JobState } from "../src/jobs/engine";
import { RateLimitError } from "../src/http";
import { cleanFileTracks } from "../src/routes/jobs";
import { createTestDb } from "./d1-shim";

function setup(spec: Partial<JobSpec> = {}) {
  const db = createTestDb();
  db.raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'x@example.com', 0)").run();
  const full: JobSpec = {
    jobId: "11111111-1111-1111-1111-111111111111",
    userId: "u1",
    source: "mock",
    dest: "mock",
    selections: [{ kind: "playlist", id: "road-trip", name: "Road Trip" }],
    ...spec,
  };
  db.raw
    .prepare(
      "INSERT INTO transfer_jobs (id, user_id, source, dest, title, selections, status, created_at, updated_at) VALUES (?, 'u1', ?, ?, 't', '[]', 'QUEUED', 0, 0)",
    )
    .run(full.jobId, full.source, full.dest);
  return { db, spec: full };
}

async function runToEnd(spec: JobSpec, deps: any, maxSteps = 1000) {
  let state: JobState | null = initialState(spec);
  let steps = 0;
  let maxQueriesInStep = 0;
  while (state && steps < maxSteps) {
    const before = deps.db.counter.queries;
    state = await runStep(spec, state, deps);
    maxQueriesInStep = Math.max(maxQueriesInStep, deps.db.counter.queries - before);
    steps++;
  }
  return { steps, finished: state === null, maxQueriesInStep };
}

const direct = <T>(fn: (t: string) => Promise<T>) => fn("token");

describe("transfer engine", () => {
  it("moves a 1,000-song playlist in small steps", async () => {
    const { db, spec } = setup();
    const dest = createMockAdapter();
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const create = vi.spyOn(dest, "createPlaylist");

    const { finished, maxQueriesInStep } = await runToEnd(spec, {
      db,
      source: createMockAdapter(),
      dest,
      withSourceToken: direct,
      withDestToken: direct,
    });
    expect(finished).toBe(true);
    // Stays far below Cloudflare's free-plan limit of 50 queries per run.
    expect(maxQueriesInStep).toBeLessThan(15);

    const counts = Object.fromEntries(
      (db.raw.prepare("SELECT status, COUNT(*) AS n FROM transfer_items GROUP BY status").all() as any[]).map((r) => [r.status, r.n]),
    );
    expect(counts.PENDING).toBeUndefined();
    expect(counts.MATCHED + counts.LOW_CONFIDENCE + counts.FAILED).toBe(1000);
    expect(counts.MATCHED / 1000).toBeGreaterThan(0.9);
    expect(counts.LOW_CONFIDENCE).toBeGreaterThan(0);
    expect(counts.FAILED).toBeGreaterThan(0);

    expect(create).toHaveBeenCalledOnce();
    const added = add.mock.calls.flatMap((c) => c[2]);
    expect(added).toHaveLength(counts.MATCHED);
    // Songs keep their original order.
    expect(added.slice(0, 3)).toEqual(["mock:dest:0", "mock:dest:1", "mock:dest:2"]);
    const written = db.raw.prepare("SELECT COUNT(*) AS n FROM transfer_items WHERE written = 1").get() as any;
    expect(written.n).toBe(counts.MATCHED);
  });

  it("uses all three matching tiers and the cache", async () => {
    const { db, spec } = setup({ selections: [{ kind: "playlist", id: "chill", name: "Chill" }] });
    const deps = { db, source: createMockAdapter(), dest: createMockAdapter(), withSourceToken: direct, withDestToken: direct };
    await runToEnd(spec, deps);
    const methods = (db.raw.prepare("SELECT DISTINCT method FROM transfer_items").all() as any[]).map((r) => r.method);
    expect(methods).toEqual(expect.arrayContaining(["isrc", "exact", "fuzzy_jaro_winkler"]));

    // Good matches are remembered...
    expect((db.raw.prepare("SELECT COUNT(*) AS n FROM match_cache").get() as any).n).toBeGreaterThan(20);

    // ...so a second transfer of the same songs needs no searches at all.
    const jobId = "22222222-2222-2222-2222-222222222222";
    db.raw
      .prepare("INSERT INTO transfer_jobs (id, user_id, source, dest, title, selections, status, created_at, updated_at) VALUES (?, 'u1', 'mock', 'mock', 't', '[]', 'QUEUED', 0, 0)")
      .run(jobId);
    const dest = createMockAdapter();
    const search = vi.spyOn(dest, "search");
    const isrc = vi.spyOn(dest, "searchByIsrc");
    await runToEnd({ ...spec, jobId }, { ...deps, dest });
    const cachedCount = (db.raw.prepare("SELECT COUNT(*) AS n FROM transfer_items WHERE job_id = ? AND method = 'cache'").get(jobId) as any).n;
    expect(cachedCount).toBeGreaterThan(20);
    expect(search.mock.calls.length + isrc.mock.calls.length).toBeLessThan(15);
  });

  it("saves Liked Songs oldest-first so the order is kept", async () => {
    const { db, spec } = setup({ selections: [{ kind: "liked", name: "Liked Songs" }] });
    const dest = createMockAdapter();
    const save = vi.spyOn(dest, "saveTracks");
    await runToEnd(spec, { db, source: createMockAdapter(), dest, withSourceToken: direct, withDestToken: direct });
    const saved = save.mock.calls.flatMap((c) => c[1]).map((id) => Number(id.split(":").pop()));
    // The last song of the list is saved first (559 is a "needs review" song, so 558).
    expect(saved[0]).toBe(558);
    expect(saved.at(-1)).toBe(500);
    expect([...saved].sort((a, b) => b - a)).toEqual(saved);
  });

  it("can pause on a rate limit and resume without losing or repeating songs", async () => {
    const { db, spec } = setup({ selections: [{ kind: "playlist", id: "gym", name: "Gym" }] });
    const dest = createMockAdapter();
    let calls = 0;
    const realSearch = dest.search.bind(dest);
    dest.search = async (t, q) => {
      if (++calls === 5) throw new RateLimitError(30);
      return realSearch(t, q);
    };
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const deps = { db, source: createMockAdapter(), dest, withSourceToken: direct, withDestToken: direct };

    let state: JobState | null = initialState(spec);
    let pauses = 0;
    while (state) {
      try {
        state = await runStep(spec, state, deps);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        pauses++; // the Durable Object would wait Retry-After seconds, then call runStep again with the same state
      }
    }
    expect(pauses).toBe(1);
    const total = (db.raw.prepare("SELECT COUNT(*) AS n FROM transfer_items").get() as any).n;
    expect(total).toBe(75);
    const added = add.mock.calls.flatMap((c) => c[2]);
    expect(new Set(added).size).toBe(added.length);
  });

  it("handles uploaded files (already stored, starts at matching)", async () => {
    const { db, spec } = setup({ source: "file", selections: [{ kind: "playlist", name: "From file" }] });
    await insertTracks(db, spec.jobId, 0, 0, [
      { title: "Bohemian Rhapsody", artist: "Queen" },
      { title: "Unknown Song", artist: "Nobody" },
    ]);
    expect(initialState(spec).phase).toBe("match");
    await runToEnd(spec, { db, dest: createMockAdapter(), withSourceToken: direct, withDestToken: direct });
    const rows = db.raw.prepare("SELECT src_title, status FROM transfer_items ORDER BY position").all() as any[];
    expect(rows.map((r) => r.status)).toEqual(["MATCHED", "FAILED"]);
  });

  it("YouTube-sized batches still respect the per-step limits", async () => {
    const { db, spec } = setup({ selections: [{ kind: "playlist", id: "chill", name: "Chill" }], dest: "youtube" });
    const dest: PlatformAdapter = { ...createMockAdapter(), id: "youtube", writeBatchSize: 1, saveBatchSize: 1, searchByIsrc: undefined };
    const search = vi.spyOn(dest, "search");
    let state: JobState | null = initialState(spec);
    let maxSearchesPerStep = 0;
    while (state) {
      const before = search.mock.calls.length;
      state = await runStep(spec, state, { db, source: createMockAdapter(), dest, withSourceToken: direct, withDestToken: direct });
      maxSearchesPerStep = Math.max(maxSearchesPerStep, search.mock.calls.length - before);
    }
    expect(maxSearchesPerStep).toBeLessThanOrEqual(4);
  });
});

describe("file upload validation", () => {
  it("keeps only clean fields and drops incomplete songs", () => {
    expect(
      cleanFileTracks([
        { title: " Song ", artist: "Band", isrc: "usrc17607839", durationMs: 1000, extra: "x" },
        { title: "", artist: "No title" },
        { title: "Bad isrc", artist: "A", isrc: "<script>" },
      ]),
    ).toEqual([
      { title: "Song", artist: "Band", album: undefined, isrc: "USRC17607839", durationMs: 1000 },
      { title: "Bad isrc", artist: "A", album: undefined, isrc: undefined, durationMs: undefined },
    ]);
    expect(() => cleanFileTracks("nope")).toThrow();
  });
});
