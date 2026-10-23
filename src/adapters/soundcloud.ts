// SoundCloud adapter (public API, OAuth 2.1 with PKCE + client secret).
// SoundCloud has no ISRC search, and its catalogue mixes label releases with user
// uploads, remixes and covers, so expect more "Need a look" songs than elsewhere.
// Paths follow developers.soundcloud.com (Oct 2026); verify with a real app before launch.
import { formBody, requestJson } from "../http";
import type { AdapterDeps, Page, PlatformAdapter, Playlist, Tokens, Track } from "./types";

const AUTH_URL = "https://secure.soundcloud.com/authorize";
const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const API = "https://api.soundcloud.com";
const PAGE_SIZE = 50;

export function toTrack(t: any): Track | null {
  if (!t || t.kind === "playlist" || t.id == null) return null;
  const meta = t.publisher_metadata ?? {};
  return {
    id: String(t.id),
    title: t.title ?? "",
    artist: meta.artist || t.user?.username || "",
    album: meta.album_title || undefined,
    isrc: meta.isrc || undefined,
    durationMs: Number.isFinite(t.duration) ? t.duration : undefined,
  };
}

function tokensFrom(json: any, previousRefresh?: string): Tokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** SoundCloud gives a full `next_href`; we only follow it if it points at SoundCloud's API. */
function safeNext(next: string | null | undefined): string | undefined {
  return next && next.startsWith(`${API}/`) ? next : undefined;
}

export function createSoundCloudAdapter(clientId: string, clientSecret: string, deps: AdapterDeps): PlatformAdapter {
  const call = (token: string, url: string, init: RequestInit = {}) =>
    requestJson(deps.fetch, url.startsWith("http") ? url : API + url, {
      ...init,
      headers: { Authorization: `OAuth ${token}`, Accept: "application/json; charset=utf-8", "Content-Type": "application/json", ...init.headers },
    });

  const tokenRequest = (params: Record<string, string>) =>
    requestJson(deps.fetch, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json; charset=utf-8" },
      body: formBody({ client_id: clientId, client_secret: clientSecret, ...params }),
    });

  const trackPage = async (token: string, path: string, cursor?: string): Promise<Page<Track>> => {
    const json = await call(token, cursor ?? path);
    return { items: (json.collection ?? []).map(toTrack).filter(Boolean) as Track[], next: safeNext(json.next_href) };
  };

  const paged = `linked_partitioning=true&limit=${PAGE_SIZE}`;

  return {
    id: "soundcloud",
    name: "SoundCloud",
    // ponytail: adding = read the whole list, append, save it back (PUT). Verify SoundCloud's playlist size limit.
    writeBatchSize: 100,
    saveBatchSize: 1, // one "like" per call

    getAuthUrl({ state, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });
      return `${AUTH_URL}?${q}`;
    },

    async exchangeCode(code, codeVerifier, redirectUri) {
      return tokensFrom(
        await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
      );
    },

    async refresh(refreshToken) {
      return tokensFrom(await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }), refreshToken);
    },

    async getProfile(token) {
      const me = await call(token, "/me");
      return { id: String(me.id), displayName: me.username || me.full_name || "SoundCloud user", imageUrl: me.avatar_url || undefined };
    },

    async getPlaylists(token, cursor) {
      const json = await call(token, cursor ?? `/me/playlists?show_tracks=false&${paged}`);
      const items: Playlist[] = (json.collection ?? []).map((p: any) => ({
        id: String(p.id),
        name: p.title ?? "Untitled",
        description: p.description || undefined,
        trackCount: p.track_count,
        imageUrl: p.artwork_url || undefined,
      }));
      return { items, next: safeNext(json.next_href) };
    },

    getPlaylistTracks(token, playlistId, cursor) {
      return trackPage(token, `/playlists/${encodeURIComponent(playlistId)}/tracks?${paged}`, cursor);
    },

    getSavedTracks(token, cursor) {
      return trackPage(token, `/me/likes/tracks?${paged}`, cursor);
    },

    async search(token, { title, artist }) {
      const q = encodeURIComponent(`${title} ${artist}`.trim().slice(0, 200));
      return (await trackPage(token, `/tracks?q=${q}&linked_partitioning=true&limit=10`)).items;
    },

    async createPlaylist(token, name, description) {
      const json = await call(token, "/playlists", {
        method: "POST",
        body: JSON.stringify({ playlist: { title: name, description, sharing: "private", tracks: [] } }),
      });
      return { id: String(json.id), name };
    },

    async addTracksToPlaylist(token, playlistId, trackIds) {
      const path = `/playlists/${encodeURIComponent(playlistId)}`;
      const current = await call(token, path);
      const ids: string[] = (current.tracks ?? []).map((t: any) => String(t.id));
      const have = new Set(ids);
      for (const id of trackIds) {
        if (have.has(id)) continue;
        have.add(id);
        ids.push(id);
      }
      await call(token, path, { method: "PUT", body: JSON.stringify({ playlist: { tracks: ids.map((id) => ({ id: Number(id) || id })) } }) });
    },

    async saveTracks(token, trackIds) {
      for (const id of trackIds) await call(token, `/likes/tracks/${encodeURIComponent(id)}`, { method: "POST" });
    },
  };
}
