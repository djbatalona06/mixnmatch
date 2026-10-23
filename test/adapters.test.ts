// Checks that each adapter calls the right URLs and understands the replies.
// Real services are never contacted: `fetch` is replaced with a fake.
import { describe, expect, it, vi } from "vitest";
import { createDeezerAdapter } from "../src/adapters/deezer";
import { createSpotifyAdapter } from "../src/adapters/spotify";
import { createTidalAdapter, isoDurationToMs, tracksFromDocument } from "../src/adapters/tidal";
import { createYouTubeAdapter, YT_COST } from "../src/adapters/youtube";
import { AuthError, QuotaError, RateLimitError } from "../src/http";

function fakeFetch(...bodies: unknown[]) {
  const fn = vi.fn(async () => Response.json(bodies.length > 1 ? bodies.shift() : bodies[0]));
  return fn;
}
const urlOf = (fn: any, call = 0) => new URL(fn.mock.calls[call][0]);

describe("Spotify", () => {
  it("builds a PKCE login URL", () => {
    const a = createSpotifyAdapter("cid", { fetch: fakeFetch({}) });
    const url = new URL(a.getAuthUrl({ state: "s", codeChallenge: "c", redirectUri: "https://mm.test/cb" }));
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("user-library-modify");
  });

  it("reads playlist items in the 2026 format (item instead of track) and skips local files", async () => {
    const fetch = fakeFetch({
      items: [
        { item: { id: "1", uri: "spotify:track:1", name: "Song", artists: [{ name: "A" }, { name: "B" }], external_ids: { isrc: "X1" }, duration_ms: 1000 } },
        { track: { id: "2", name: "Old shape", artists: [{ name: "C" }] } },
        { item: { id: null, is_local: true, name: "Local file" } },
      ],
      next: "https://api.spotify.com/v1/playlists/p/items?offset=50",
    });
    const page = await createSpotifyAdapter("cid", { fetch }).getPlaylistTracks("tok", "p");
    expect(urlOf(fetch).pathname).toBe("/v1/playlists/p/items");
    expect(page.items).toEqual([
      { id: "spotify:track:1", title: "Song", artist: "A, B", album: undefined, isrc: "X1", durationMs: 1000 },
      { id: "spotify:track:2", title: "Old shape", artist: "C", album: undefined, isrc: undefined, durationMs: undefined },
    ]);
    expect(page.next).toContain("offset=50");
  });

  it("ignores 'next' links that point somewhere else", async () => {
    const fetch = fakeFetch({ items: [], next: "https://evil.test/steal" });
    expect((await createSpotifyAdapter("cid", { fetch }).getSavedTracks("tok")).next).toBeUndefined();
  });

  it("searches by ISRC and writes with the new endpoints", async () => {
    const fetch = fakeFetch({ tracks: { items: [] }, id: "new" });
    const a = createSpotifyAdapter("cid", { fetch });
    await a.searchByIsrc!("tok", "GBUM71029604");
    expect(urlOf(fetch, 0).searchParams.get("q")).toBe("isrc:GBUM71029604");
    await a.createPlaylist("tok", "Mix", "d");
    expect(urlOf(fetch, 1).pathname).toBe("/v1/me/playlists");
    await a.addTracksToPlaylist("tok", "pl", ["spotify:track:1"]);
    expect(urlOf(fetch, 2).pathname).toBe("/v1/playlists/pl/items");
    await a.saveTracks("tok", ["spotify:track:1", "spotify:track:2"]);
    expect(urlOf(fetch, 3).pathname).toBe("/v1/me/library");
    expect(fetch.mock.calls[3][1]).toMatchObject({ method: "PUT" });
  });
});

describe("TIDAL", () => {
  it("joins JSON:API data with included tracks and artists", () => {
    const tracks = tracksFromDocument({
      data: [{ id: "t1", type: "tracks" }],
      included: [
        { id: "t1", type: "tracks", attributes: { title: "Song", version: "Live", isrc: "I1", duration: "PT3M25S" }, relationships: { artists: { data: [{ id: "a1", type: "artists" }] } } },
        { id: "a1", type: "artists", attributes: { name: "Band" } },
      ],
    });
    expect(tracks).toEqual([{ id: "t1", title: "Song (Live)", artist: "Band", isrc: "I1", durationMs: 205000 }]);
    expect(isoDurationToMs("PT1H2M3S")).toBe(3723000);
  });

  it("uses the /userCollectionTracks/me path for liked songs", async () => {
    const fetch = fakeFetch({ data: [], links: {} });
    await createTidalAdapter("cid", undefined, { fetch }).getSavedTracks("tok");
    expect(urlOf(fetch).pathname).toBe("/v2/userCollectionTracks/me/relationships/items");
  });
});

describe("Deezer", () => {
  it("turns Deezer's 200-with-error replies into proper errors", async () => {
    const a = createDeezerAdapter("app", "secret", { fetch: fakeFetch({ error: { code: 4, message: "Quota" } }) });
    await expect(a.getProfile("tok")).rejects.toBeInstanceOf(RateLimitError);
    const b = createDeezerAdapter("app", "secret", { fetch: fakeFetch({ error: { type: "OAuthException", code: 300 } }) });
    await expect(b.getProfile("tok")).rejects.toBeInstanceOf(AuthError);
  });

  it("does not leak the token in 'next' cursors", async () => {
    const fetch = fakeFetch({ data: [], next: "https://api.deezer.com/user/me/tracks?index=100&access_token=SECRET" });
    const page = await createDeezerAdapter("app", "secret", { fetch }).getSavedTracks("SECRET");
    expect(page.next).not.toContain("SECRET");
  });
});

describe("YouTube", () => {
  it("reports quota cost for every call and stops when the budget is gone", async () => {
    const spent: number[] = [];
    let left = 120;
    const a = createYouTubeAdapter("cid", "sec", {
      fetch: fakeFetch({ items: [] }),
      spendQuota: async (u) => {
        if (u > left) throw new QuotaError("youtube");
        left -= u;
        spent.push(u);
      },
    });
    await a.search("tok", { title: "Song", artist: "Band" });
    await a.getPlaylists("tok");
    expect(spent).toEqual([YT_COST.search, YT_COST.list]);
    await expect(a.search("tok", { title: "x", artist: "y" })).rejects.toBeInstanceOf(QuotaError);
  });

  it("has no ISRC search and parses video titles", async () => {
    const fetch = fakeFetch({
      items: [{ id: { videoId: "v1" }, snippet: { title: "Queen - Bohemian Rhapsody (Official Video)", channelTitle: "Queen Official" } }],
    });
    const a = createYouTubeAdapter("cid", "sec", { fetch });
    expect(a.searchByIsrc).toBeUndefined();
    expect(await a.search("tok", { title: "Bohemian Rhapsody", artist: "Queen" })).toEqual([
      { id: "v1", title: "Bohemian Rhapsody", artist: "Queen", durationMs: undefined },
    ]);
    expect(urlOf(fetch).searchParams.get("videoCategoryId")).toBe("10");
  });
});
