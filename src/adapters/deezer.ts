// Deezer adapter (api.deezer.com).
// Deezer uses classic OAuth (no PKCE). With the "offline_access" permission the
// token does not expire, so there is no refresh step.
import { ApiError, AuthError, RateLimitError, requestJson } from "../http";
import type { AdapterDeps, Page, PlatformAdapter, Playlist, Track } from "./types";

const AUTH_URL = "https://connect.deezer.com/oauth/auth.php";
const TOKEN_URL = "https://connect.deezer.com/oauth/access_token.php";
const API = "https://api.deezer.com";

export const DEEZER_PERMS = "basic_access,offline_access,manage_library";

function toTrack(t: any): Track | null {
  if (!t || !t.id || t.type && t.type !== "track") return null;
  return {
    id: String(t.id),
    title: t.title,
    artist: t.contributors?.map((c: any) => c.name).join(", ") || t.artist?.name || "",
    album: t.album?.title,
    isrc: t.isrc,
    durationMs: t.duration ? t.duration * 1000 : undefined,
  };
}

/** Deezer reports most errors with HTTP 200 and an `error` object. */
export function checkDeezerError(json: any): void {
  const err = json?.error;
  if (!err) return;
  if (err.code === 4) throw new RateLimitError(5); // "Quota limit exceeded" (50 calls / 5 s)
  if (err.code === 300 || err.type === "OAuthException") throw new AuthError(err.message ?? "Deezer auth error");
  if (err.code === 800) return; // "no data" -> treat as empty
  throw new ApiError(`Deezer: ${err.message ?? err.type}`, 400);
}

export function createDeezerAdapter(appId: string, secret: string, deps: AdapterDeps): PlatformAdapter {
  const call = async (token: string, path: string, init: RequestInit = {}) => {
    const url = new URL(path.startsWith("http") ? path : API + path);
    url.searchParams.set("access_token", token);
    const json = await requestJson(deps.fetch, url.toString(), init);
    checkDeezerError(json);
    return json;
  };

  const next = (json: any): string | undefined =>
    typeof json?.next === "string" && json.next.startsWith(API) ? stripToken(json.next) : undefined;

  const trackPage = async (token: string, path: string): Promise<Page<Track>> => {
    const json = await call(token, path);
    return { items: (json.data ?? []).map(toTrack).filter(Boolean) as Track[], next: next(json) };
  };

  return {
    id: "deezer",
    name: "Deezer",
    writeBatchSize: 50,
    saveBatchSize: 1,

    getAuthUrl({ state, redirectUri }) {
      const q = new URLSearchParams({ app_id: appId, redirect_uri: redirectUri, perms: DEEZER_PERMS, state });
      return `${AUTH_URL}?${q}`;
    },

    async exchangeCode(code) {
      const q = new URLSearchParams({ app_id: appId, secret, code, output: "json" });
      const json = await requestJson(deps.fetch, `${TOKEN_URL}?${q}`);
      if (!json?.access_token) throw new AuthError("Deezer did not return a token");
      const expires = Number(json.expires);
      return { accessToken: json.access_token, expiresAt: expires > 0 ? Date.now() + expires * 1000 : undefined };
    },

    async refresh() {
      throw new AuthError("Deezer tokens cannot be refreshed; please reconnect Deezer");
    },

    async getProfile(token) {
      const me = await call(token, "/user/me");
      return { id: String(me.id), displayName: me.name, imageUrl: me.picture_medium };
    },

    async getPlaylists(token, cursor) {
      const json = await call(token, cursor ?? "/user/me/playlists?limit=50");
      return {
        items: (json.data ?? []).map(
          (p: any): Playlist => ({ id: String(p.id), name: p.title, trackCount: p.nb_tracks, imageUrl: p.picture_medium }),
        ),
        next: next(json),
      };
    },

    getPlaylistTracks(token, playlistId, cursor) {
      return trackPage(token, cursor ?? `/playlist/${encodeURIComponent(playlistId)}/tracks?limit=100`);
    },

    getSavedTracks(token, cursor) {
      return trackPage(token, cursor ?? "/user/me/tracks?limit=100");
    },

    async searchByIsrc(token, isrc) {
      try {
        const t = await call(token, `/track/isrc:${encodeURIComponent(isrc)}`);
        const track = toTrack(t);
        return track ? [track] : [];
      } catch (err) {
        if (err instanceof ApiError) return []; // "not found" for this ISRC
        throw err;
      }
    },

    async search(token, { title, artist }) {
      const q = `artist:"${artist.split(",")[0].replace(/"/g, "")}" track:"${title.replace(/"/g, "")}"`;
      const json = await call(token, `/search/track?limit=10&q=${encodeURIComponent(q)}`);
      let items = (json.data ?? []).map(toTrack).filter(Boolean) as Track[];
      if (!items.length) {
        const loose = await call(token, `/search/track?limit=10&q=${encodeURIComponent(`${title} ${artist}`)}`);
        items = (loose.data ?? []).map(toTrack).filter(Boolean) as Track[];
      }
      return items;
    },

    async createPlaylist(token, name) {
      const json = await call(token, `/user/me/playlists?title=${encodeURIComponent(name)}`, { method: "POST" });
      return { id: String(json.id), name };
    },

    async addTracksToPlaylist(token, playlistId, trackIds) {
      await call(token, `/playlist/${encodeURIComponent(playlistId)}/tracks?songs=${trackIds.join(",")}`, { method: "POST" });
    },

    async saveTracks(token, trackIds) {
      for (const id of trackIds) {
        await call(token, `/user/me/tracks?track_id=${encodeURIComponent(id)}`, { method: "POST" });
      }
    },
  };
}

function stripToken(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("access_token");
  return u.toString();
}
