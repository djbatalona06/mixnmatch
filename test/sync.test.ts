// v1.2 Feature 4: Auto-Sync — one-way, add-only, once a day.
import { describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../src/adapters/mock";
import type { Track } from "../src/adapters/types";
import { createSync, finishSyncRun, reactivateSyncs, runDueSyncs, SYNCS_PER_CRON } from "../src/routes/syncs";
import { addJob, all, latestRun, mockDeps, one, runJob, testEnv, USER } from "./helpers";

const DAY = 86400_000;

/** A source playlist we can add songs to between runs, and a destination that remembers what was added. */
async function liveAdapters(startSongs: number) {
  const base = createMockAdapter();
  const catalog = (await base.getPlaylistTracks("", "road-trip")).items; // real Demo songs 0..49
  const songs: Track[] = catalog.slice(0, startSongs);
  const source = { ...base, getPlaylistTracks: async () => ({ items: songs }) };
  const copy: string[] = [];
  const dest = {
    ...base,
    getPlaylistTracks: async () => ({ items: copy.map((id) => ({ id, title: "", artist: "" })) }),
    addTracksToPlaylist: vi.fn(async (_t: string, _p: string, ids: string[]) => void copy.push(...ids)),
    createPlaylist: vi.fn(async () => ({ id: "copy-1", name: "Copy" })),
  };
  return { source, dest, songs, copy, catalog };
}

async function syncedPlaylist(startSongs = 10) {
  const t = await testEnv();
  const live = await liveAdapters(startSongs);
  // The first, normal transfer.
  const first = await addJob(t.db, { selections: [{ kind: "playlist", id: "road-trip", name: "Road Trip" }] });
  await runJob(first, mockDeps(t.db, live.dest, live.source));
  t.db.raw.prepare("UPDATE transfer_jobs SET status = 'DONE'").run();
  const { id } = (await (await createSync(t.env, USER, { jobId: first.jobId, selIndex: 0 })).json()) as any;
  return { ...t, ...live, syncId: id as string, firstJob: first };
}

/** Pretend a day passed and the hourly cron fired, then run the started job to the end. */
async function runOneDay(t: Awaited<ReturnType<typeof syncedPlaylist>>) {
  const now = Date.now() + DAY + 1000;
  const started = await runDueSyncs(t.env, now);
  if (!started) return null;
  const { spec, state } = latestRun(t.db)!;
  await runJob(spec, mockDeps(t.db, t.dest, t.source), state);
  t.db.raw.prepare("UPDATE transfer_jobs SET status = 'DONE' WHERE id = ?").run(spec.jobId);
  await finishSyncRun(t.env, spec, "DONE", undefined, now);
  return spec;
}

describe("Auto-Sync", () => {
  it("adds only the new songs, and never searches old ones again", async () => {
    const t = await syncedPlaylist(10);
    expect(t.copy).toHaveLength(10);
    t.songs.push(...t.catalog.slice(10, 13)); // the user adds 3 songs to the original
    const isrc = vi.spyOn(t.dest, "searchByIsrc");

    const spec = await runOneDay(t);
    expect(spec?.syncId).toBe(t.syncId);
    expect(spec?.selections[0].targetPlaylistId).toBe("copy-1");
    expect(t.copy).toHaveLength(13);
    expect(isrc).toHaveBeenCalledTimes(3); // only the 3 new songs were looked up
    expect(t.dest.createPlaylist).toHaveBeenCalledOnce(); // only the first transfer made a playlist
    const sync = one(t.db, "SELECT last_added, next_run_at, status FROM syncs");
    expect(sync.last_added).toBe(3);
    expect(sync.status).toBe("ACTIVE");
  });

  it("never puts back a song the user removed from the copy", async () => {
    const t = await syncedPlaylist(10);
    t.copy.splice(t.copy.indexOf("mock:dest:3"), 1); // the user removes a song from the copy
    await runOneDay(t);
    expect(t.copy).not.toContain("mock:dest:3");
    expect(t.copy).toHaveLength(9);
    // A day with nothing new leaves no empty run behind on the dashboard.
    expect(one(t.db, "SELECT COUNT(*) AS n FROM transfer_jobs WHERE sync_id IS NOT NULL").n).toBe(0);
  });

  it("waits while the user has another transfer running", async () => {
    const t = await syncedPlaylist(5);
    await addJob(t.db, { selections: [{ kind: "liked", name: "Liked Songs" }] }, "RUNNING");
    expect(await runDueSyncs(t.env, Date.now() + DAY + 1000)).toBe(0);
    expect(all(t.db, "SELECT job_id FROM job_runs")).toHaveLength(0);
  });

  it("asks the user to reconnect after an access problem, and starts again once they do", async () => {
    const t = await syncedPlaylist(5);
    const spec = { jobId: crypto.randomUUID(), userId: "u1", source: "mock" as const, dest: "mock" as const, selections: [], syncId: t.syncId };
    await finishSyncRun(t.env, spec, "FAILED", "auth");
    expect(one(t.db, "SELECT status, message FROM syncs")).toMatchObject({ status: "NEEDS_USER", message: expect.stringMatching(/Reconnect/) });
    expect(await runDueSyncs(t.env, Date.now() + 2 * DAY)).toBe(0); // not run while it needs the user
    await reactivateSyncs(t.env, "u1", "mock");
    expect(one(t.db, "SELECT status FROM syncs").status).toBe("ACTIVE");
  });

  it("refuses files, YouTube, unfinished transfers and the free-plan limit", async () => {
    const t = await syncedPlaylist(5);
    // Free plan: 1 sync. A second one is refused with an upgrade hint.
    const other = await addJob(t.db, { selections: [{ kind: "playlist", id: "gym", name: "Gym" }] }, "DONE");
    t.db.raw.prepare("UPDATE transfer_selections SET dest_playlist_id = 'p2' WHERE job_id = ?").run(other.jobId);
    await expect(createSync(t.env, USER, { jobId: other.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Premium/) });
    // Premium allows it.
    const premium = { ...USER, plan: "premium", plan_until: Date.now() + DAY };
    expect((await createSync(t.env, premium, { jobId: other.jobId, selIndex: 0 })).status).toBe(201);
    // The same playlist twice is refused.
    await expect(createSync(t.env, premium, { jobId: other.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 409 });

    const yt = await addJob(t.db, { dest: "youtube", selections: [{ kind: "playlist", id: "chill", name: "Chill" }] }, "DONE");
    t.db.raw.prepare("UPDATE transfer_selections SET dest_playlist_id = 'p3' WHERE job_id = ?").run(yt.jobId);
    await expect(createSync(t.env, premium, { jobId: yt.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 400 });

    const file = await addJob(t.db, { source: "file", selections: [{ kind: "playlist", name: "F" }] }, "DONE");
    await expect(createSync(t.env, premium, { jobId: file.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 400 });

    const running = await addJob(t.db, { selections: [{ kind: "playlist", id: "chill", name: "Chill" }] }, "RUNNING");
    await expect(createSync(t.env, premium, { jobId: running.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(createSync(t.env, { ...USER, id: "u2" }, { jobId: t.firstJob.jobId, selIndex: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it("the hourly cron stays small: 20 due syncs in a handful of queries, one per user", async () => {
    const t = await testEnv();
    for (let i = 0; i < 25; i++) {
      t.db.raw.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, 0)").run(`user${i}`, `u${i}@x.test`);
      t.db.raw
        .prepare(
          "INSERT INTO syncs (id, user_id, source, dest, source_id, dest_playlist_id, name, status, next_run_at, created_at) VALUES (?, ?, 'mock', 'mock', ?, 'p', 'n', 'ACTIVE', 0, 0)",
        )
        .run(crypto.randomUUID(), `user${i}`, `src${i}`);
    }
    // A second due sync for user0 must wait for the next hour.
    t.db.raw
      .prepare("INSERT INTO syncs (id, user_id, source, dest, source_id, dest_playlist_id, name, status, next_run_at, created_at) VALUES ('extra', 'user0', 'mock', 'mock', 'other', 'p', 'n', 'ACTIVE', 0, 0)")
      .run();
    const before = t.db.counter.queries;
    const startedCount = await runDueSyncs(t.env, Date.now());
    expect(t.db.counter.queries - before).toBeLessThan(15);
    expect(startedCount).toBeLessThanOrEqual(SYNCS_PER_CRON);
    const runUsers = all(t.db, "SELECT spec FROM job_runs").map((r) => JSON.parse(r.spec).userId);
    expect(new Set(runUsers).size).toBe(startedCount);
    expect(all(t.db, "SELECT COUNT(*) AS n FROM transfer_jobs WHERE sync_id IS NOT NULL")[0].n).toBe(startedCount);
    expect(all(t.db, "SELECT COUNT(*) AS n FROM transfer_selections")[0].n).toBe(startedCount);
  });
});
