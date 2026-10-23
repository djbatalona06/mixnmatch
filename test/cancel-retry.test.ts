// v1.1 Feature 3: Stop a transfer, then Try again without making a mess.
import { describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../src/adapters/mock";
import { AuthError } from "../src/http";
import { initialState, type JobSpec } from "../src/jobs/engine";
import { cancelJob, retryJob } from "../src/routes/jobs";
import { addJob, all, mockDeps, one, runJob, testEnv, USER } from "./helpers";

const shared = vi.hoisted(() => ({ adapters: {} as Record<string, any> }));
vi.mock("../src/adapters/registry", async (original) => {
  const real: any = await original();
  return { ...real, getAdapter: (env: any, p: string, f?: any) => shared.adapters[p] ?? real.getAdapter(env, p, f) };
});

const { TransferJob } = await import("../src/jobs/transfer-job");

/** A Durable Object with in-memory storage; `alarmAt` is when it asked to wake up next. */
function makeJobObject(env: any) {
  const store = new Map<string, unknown>();
  const ctx = {
    alarmAt: null as number | null,
    storage: {
      get: async (k: string) => structuredClone(store.get(k)),
      put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
      deleteAll: async () => void store.clear(),
      setAlarm: async (t: number) => void (ctx.alarmAt = t),
      deleteAlarm: async () => void (ctx.alarmAt = null),
    },
  };
  return { job: new TransferJob(ctx as any, env), ctx, store };
}

describe("Stop", () => {
  it("stops further writes, even when Stop arrives in the middle of a step", async () => {
    const { env, db } = await testEnv();
    const dest = createMockAdapter();
    shared.adapters.mock = dest;
    const spec = await addJob(db, { selections: [{ kind: "playlist", id: "road-trip", name: "Road Trip" }] });
    const { job, ctx } = makeJobObject(env);
    await job.start(spec);

    // Run until it is writing, then press Stop while a write is in flight.
    let writes = 0;
    dest.addTracksToPlaylist = async () => {
      writes++;
      if (writes === 2) await job.cancel();
    };
    for (let i = 0; i < 500 && ctx.alarmAt !== null; i++) await job.alarm();

    expect(writes).toBe(2);
    expect(ctx.alarmAt).toBeNull(); // nothing scheduled any more
    const row = one(db, "SELECT status, message FROM transfer_jobs WHERE id = ?", spec.jobId);
    expect(row.status).toBe("CANCELLED");
    expect(row.message).toMatch(/Stopped/);

    // A stray alarm afterwards does nothing.
    await job.alarm();
    expect(writes).toBe(2);
  });

  it("only the owner can stop, and only while running", async () => {
    const { env, db, cancelled } = await testEnv();
    const spec = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] }, "RUNNING");
    await expect(cancelJob(env, { ...USER, id: "someone-else" }, spec.jobId)).rejects.toMatchObject({ status: 404 });
    await cancelJob(env, USER, spec.jobId);
    expect(cancelled).toEqual([spec.jobId]);
    expect(one(db, "SELECT status FROM transfer_jobs").status).toBe("CANCELLED");
    await expect(cancelJob(env, USER, spec.jobId)).rejects.toMatchObject({ status: 409 });
  });
});

describe("Try again", () => {
  it("never re-reads songs and never makes a second playlist", async () => {
    const { env, db, started } = await testEnv();
    const spec = await addJob(db, { selections: [{ kind: "playlist", id: "gym", name: "Gym" }] });
    const source = createMockAdapter();
    const dest = createMockAdapter();
    const create = vi.spyOn(dest, "createPlaylist");
    await runJob(spec, mockDeps(db, dest, source));
    db.raw.prepare("UPDATE transfer_jobs SET status = 'DONE'").run();
    const failedBefore = one(db, "SELECT COUNT(*) AS n FROM transfer_items WHERE status = 'FAILED'").n;
    expect(failedBefore).toBeGreaterThan(0);
    const playlistId = one(db, "SELECT dest_playlist_id FROM transfer_selections").dest_playlist_id;

    await retryJob(env, USER, spec.jobId, { includeUnsure: true });
    expect(one(db, "SELECT status FROM transfer_jobs").status).toBe("QUEUED");
    const { spec: again, state } = started.at(-1)!;
    expect(state).toMatchObject({ sel: 0, phase: "match", destPlaylistId: playlistId });

    const reads = vi.spyOn(source, "getPlaylistTracks");
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    await runJob(again, mockDeps(db, dest, source), state);
    expect(reads).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce(); // only the first run made a playlist
    expect(add.mock.calls.every((c) => c[1] === playlistId)).toBe(true);
    expect(one(db, "SELECT COUNT(*) AS n FROM transfer_items").n).toBe(75); // nothing read twice
  });

  it("resumes where it stopped after the user had to reconnect a service", async () => {
    const { env, db, started } = await testEnv();
    const spec = await addJob(db, {
      selections: [
        { kind: "playlist", id: "chill", name: "Chill" },
        { kind: "playlist", id: "gym", name: "Gym" },
      ],
    });
    const source = createMockAdapter();
    const dest = createMockAdapter();
    const create = vi.spyOn(dest, "createPlaylist");
    const add = vi.spyOn(dest, "addTracksToPlaylist");

    // First run: finishes "Chill", then the access key stops working while writing "Gym".
    const deps = mockDeps(db, dest, source);
    let { state } = await runJob(spec, deps, initialState(spec), (s) => s.sel === 1 && s.phase === "write" && !!s.destPlaylistId);
    dest.addTracksToPlaylist = async () => {
      throw new AuthError("Demo Music needs to be reconnected");
    };
    await expect(runJob(spec, deps, state)).rejects.toBeInstanceOf(AuthError);
    db.raw.prepare("UPDATE transfer_jobs SET status = 'FAILED'").run();

    // Reconnected: Try again picks up at "Gym", reusing the playlist it already made.
    dest.addTracksToPlaylist = add as any;
    await retryJob(env, USER, spec.jobId, {});
    const resumed = started.at(-1)!;
    expect(resumed.state).toMatchObject({ sel: 1, phase: "match" });
    expect(resumed.state!.destPlaylistId).toBeTruthy();
    const reads = vi.spyOn(source, "getPlaylistTracks");
    await runJob(resumed.spec as JobSpec, deps, resumed.state);

    expect(reads).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2); // one per playlist, never a third
    const added = add.mock.calls.flatMap((c) => c[2]);
    expect(new Set(added).size).toBe(added.length); // no song added twice
    const unwritten = one(db, "SELECT COUNT(*) AS n FROM transfer_items WHERE status = 'MATCHED' AND written = 0").n;
    expect(unwritten).toBe(0);
    expect(all(db, "SELECT write_done FROM transfer_selections").map((r) => r.write_done)).toEqual([1, 1]);
  });

  it("is refused while another transfer is running", async () => {
    const { env, db } = await testEnv();
    const done = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] }, "DONE");
    await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] }, "RUNNING");
    await expect(retryJob(env, USER, done.jobId, {})).rejects.toMatchObject({ status: 409 });
  });
});
