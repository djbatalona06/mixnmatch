// v1.1 Feature 2: add to a playlist you already have, and never add a song twice.
import { describe, expect, it, vi } from "vitest";
import { createMockAdapter } from "../src/adapters/mock";
import type { Track } from "../src/adapters/types";
import { insertTracks } from "../src/jobs/engine";
import { createTestDb } from "./d1-shim";
import { addJob, all, mockDeps, one, runJob } from "./helpers";

function freshDb() {
  const db = createTestDb();
  db.raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'x@example.com', 0)").run();
  return db;
}

describe("add to an existing playlist", () => {
  it("skips the songs that are already there and never makes a new playlist", async () => {
    const db = freshDb();
    // "Chill Evenings" = Demo songs 0..29. Song 19 only has a karaoke version, so 29 match.
    const spec = await addJob(db, { selections: [{ kind: "playlist", id: "chill", name: "Chill", targetPlaylistId: "my-list" }] });

    // The playlist we add to already has 50 songs: 20 of ours (0..20 except 19) + 30 others.
    const overlap = Array.from({ length: 21 }, (_, n) => n).filter((n) => n !== 19);
    const existing: Track[] = [
      ...overlap.map((n) => ({ id: `mock:dest:${n}`, title: "x", artist: "y" })),
      ...Array.from({ length: 30 }, (_, n) => ({ id: `other:${n}`, title: "x", artist: "y" })),
    ];
    const dest = createMockAdapter();
    dest.getPlaylistTracks = async (_t, id, cursor) => {
      expect(id).toBe("my-list");
      const offset = Number(cursor ?? 0); // two pages, to prove paging works
      return { items: existing.slice(offset, offset + 25), next: offset + 25 < existing.length ? String(offset + 25) : undefined };
    };
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    const create = vi.spyOn(dest, "createPlaylist");

    const { state, maxQueries } = await runJob(spec, mockDeps(db, dest));
    expect(state).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(maxQueries).toBeLessThan(15);

    const added = add.mock.calls.flatMap((c) => c[2]);
    expect(add.mock.calls.every((c) => c[1] === "my-list")).toBe(true);
    expect(one(db, "SELECT COUNT(*) AS n FROM transfer_items WHERE written = 2").n).toBe(20);
    expect(added).toHaveLength(29 - 20);
    expect(added.some((id) => overlap.includes(Number(id.split(":").pop())))).toBe(false);
    expect(one(db, "SELECT dest_playlist_id, write_done FROM transfer_selections").dest_playlist_id).toBe("my-list");
  });

  it("adds a song that appears twice in the source list only once", async () => {
    const db = freshDb();
    const spec = await addJob(db, { source: "file", selections: [{ kind: "playlist", name: "Dupes" }] });
    await insertTracks(db, spec.jobId, 0, 0, [
      { title: "Bohemian Rhapsody", artist: "Queen" },
      { title: "Billie Jean", artist: "Michael Jackson" },
      { title: "Bohemian Rhapsody", artist: "Queen" },
    ]);
    const dest = createMockAdapter();
    const add = vi.spyOn(dest, "addTracksToPlaylist");
    await runJob(spec, mockDeps(db, dest));
    const added = add.mock.calls.flatMap((c) => c[2]);
    expect(added).toHaveLength(2);
    expect(new Set(added).size).toBe(2);
    expect(all(db, "SELECT written FROM transfer_items ORDER BY position").map((r) => r.written)).toEqual([1, 1, 2]);
  });

  it("does not run the 'already there' check for Liked Songs", async () => {
    const db = freshDb();
    const spec = await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] });
    const dest = createMockAdapter();
    const pages = vi.spyOn(dest, "getPlaylistTracks");
    await runJob(spec, mockDeps(db, dest));
    expect(pages).not.toHaveBeenCalled();
  });
});
