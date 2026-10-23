// v1.1 Feature 1: fix unsure songs by hand.
import { describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../src/adapters/mock";
import { QuotaError } from "../src/http";
import { fixItem, SEARCHES_PER_MINUTE, searchForItem, skipItem } from "../src/routes/fix";
import { addJob, mockDeps, one, runJob, testEnv, USER } from "./helpers";

const shared = vi.hoisted(() => ({ adapters: {} as Record<string, any> }));
vi.mock("../src/adapters/registry", async (original) => {
  const real: any = await original();
  return { ...real, getAdapter: (env: any, p: string, f?: any) => shared.adapters[p] ?? real.getAdapter(env, p, f) };
});

async function finishedJob(status = "DONE") {
  const t = await testEnv();
  const dest = createMockAdapter();
  shared.adapters.mock = dest;
  const spec = await addJob(t.db, { selections: [{ kind: "playlist", id: "chill", name: "Chill" }] });
  await runJob(spec, mockDeps(t.db, dest));
  t.db.raw.prepare("UPDATE transfer_jobs SET status = ?").run(status);
  // Demo song 19 only exists as a karaoke version -> "Need a look".
  const unsure = one(t.db, "SELECT id FROM transfer_items WHERE status = 'LOW_CONFIDENCE'");
  const playlistId = one(t.db, "SELECT dest_playlist_id FROM transfer_selections").dest_playlist_id;
  return { ...t, dest, spec, itemId: unsure.id as number, playlistId };
}

const search = (env: any, jobId: string, itemId: number, q = "") =>
  searchForItem(env, USER, jobId, itemId, new URL(`https://mm.test/x?q=${encodeURIComponent(q)}`)).then((r) => r.json() as any);

describe("Fix-it", () => {
  it("searches the destination, pre-filled with the song's title and artist", async () => {
    const { env, spec, itemId, dest } = await finishedJob();
    const spy = vi.spyOn(dest, "search");
    const { results } = await search(env, spec.jobId, itemId);
    expect(spy.mock.calls[0][1]).toEqual({ title: "Halo", artist: "Beyoncé" }); // Demo song 19
    await search(env, spec.jobId, itemId, "halo live");
    expect(spy.mock.calls[1][1]).toEqual({ title: "halo live", artist: "" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("id");
  });

  it("a fix on a finished job adds the song exactly once", async () => {
    const { env, db, spec, itemId, dest, playlistId } = await finishedJob();
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const res = await (await fixItem(env, USER, spec.jobId, itemId, { destId: "mock:dest:19", destTitle: "Halo", destArtist: "Beyoncé" })).json();
    expect(res).toMatchObject({ status: "MATCHED", written: 1 });
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0].slice(1)).toEqual([playlistId, ["mock:dest:19"]]);
    expect(one(db, "SELECT status, method, confidence, written FROM transfer_items WHERE id = ?", itemId)).toEqual({
      status: "MATCHED",
      method: "manual",
      confidence: 1,
      written: 1,
    });
    // A second click is refused, so it can't be added twice.
    await expect(fixItem(env, USER, spec.jobId, itemId, { destId: "mock:dest:19" })).rejects.toMatchObject({ status: 409 });
    expect(add).toHaveBeenCalledOnce();
  });

  it("a fix while the job is still running is left to the job's own write step", async () => {
    const t = await testEnv();
    const dest = createMockAdapter();
    shared.adapters.mock = dest;
    const spec = await addJob(t.db, { selections: [{ kind: "playlist", id: "chill", name: "Chill" }] }, "RUNNING");
    const deps = mockDeps(t.db, dest);
    const { state } = await runJob(spec, deps, undefined, (s) => s.phase === "write");
    const itemId = one(t.db, "SELECT id FROM transfer_items WHERE status = 'LOW_CONFIDENCE'").id;
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const res = await (await fixItem(t.env, USER, spec.jobId, itemId, { destId: "mock:dest:19" })).json();
    expect(res).toMatchObject({ written: 0 });
    expect(add).not.toHaveBeenCalled();
    await runJob(spec, deps, state);
    expect(add.mock.calls.flatMap((c) => c[2])).toContain("mock:dest:19");
  });

  it("skip marks the song as skipped and it is never added", async () => {
    const { env, db, spec, itemId } = await finishedJob();
    await skipItem(env, USER, spec.jobId, itemId);
    expect(one(db, "SELECT status, written FROM transfer_items WHERE id = ?", itemId)).toEqual({ status: "SKIPPED", written: 0 });
  });

  it("another user's song is 'not found'", async () => {
    const { env, spec, itemId } = await finishedJob();
    const stranger = { ...USER, id: "u2" };
    await expect(searchForItem(env, stranger, spec.jobId, itemId, new URL("https://x/"))).rejects.toMatchObject({ status: 404 });
    await expect(fixItem(env, stranger, spec.jobId, itemId, { destId: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(skipItem(env, stranger, spec.jobId, itemId)).rejects.toMatchObject({ status: 404 });
    // Right user, wrong job id: also not found.
    await expect(skipItem(env, USER, "00000000-0000-0000-0000-000000000000", itemId)).rejects.toMatchObject({ status: 404 });
  });

  it("manual picks never go into the shared match cache", async () => {
    const { env, db, spec, itemId } = await finishedJob();
    const before = one(db, "SELECT COUNT(*) AS n FROM match_cache").n;
    await fixItem(env, USER, spec.jobId, itemId, { destId: "mock:dest:19" });
    expect(one(db, "SELECT COUNT(*) AS n FROM match_cache").n).toBe(before);
    expect(one(db, "SELECT COUNT(*) AS n FROM match_cache WHERE method = 'manual' OR dest_id = 'mock:dest:19'").n).toBe(0);
  });

  it("a song already in the playlist is not added again", async () => {
    const { env, db, spec, itemId, dest } = await finishedJob();
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const res = await (await fixItem(env, USER, spec.jobId, itemId, { destId: "mock:dest:0" })).json();
    expect(res).toMatchObject({ written: 2 });
    expect(add).not.toHaveBeenCalled();
    expect(one(db, "SELECT written FROM transfer_items WHERE id = ?", itemId).written).toBe(2);
  });

  it("refuses with 429 when YouTube's daily allowance is used up, and when searching too fast", async () => {
    const { env, spec, itemId, dest } = await finishedJob();
    dest.search = async () => {
      throw new QuotaError("youtube");
    };
    await expect(search(env, spec.jobId, itemId)).rejects.toMatchObject({ status: 429 });
    dest.search = async () => [];
    for (let i = 1; i < SEARCHES_PER_MINUTE; i++) await search(env, spec.jobId, itemId);
    await expect(search(env, spec.jobId, itemId)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/wait a minute/) });
  });
});
