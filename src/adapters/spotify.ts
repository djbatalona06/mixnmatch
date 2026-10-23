// Spotify Web API adapter.
// Uses the February 2026 endpoints: /playlists/{id}/items, POST /me/playlists, PUT /me/library.
// Login uses OAuth "Authorization Code + PKCE", so no client secret is needed.
import { formBody, requestJson } from "../http";
import type { AdapterDeps, Page, PlatformAdapter, Playlist, Tokens, Track } from "./types";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-library-modify",
].join(" ");

function toTrack(t: any): Track | null {
  // Local files and podcast episodes have no usable id.
  if (!t || t.type === "episode" || t.is_local || !t.id) return null;
  return {
    id: t.uri ?? `spotify:track:${t.id}`,
    title: t.name,
    artist: (t.artists ?? []).map((a: any) => a.name).join(", "),
    album: t.album?.name,
    isrc: t.external_ids?.isrc,
    durationMs: t.duration_ms,
  };
}

function tokensFrom(json: any, previousRefresh?: string): Tokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** Spotify gives a full "next" URL; we only pass it back if it points at Spotify. */
function safeNext(next: string | null | undefined): string | undefined {
  return next && next.startsWith(API) ? next : undefined;
}

export function createSpotifyAdapter(clientId: string, deps: AdapterDeps): PlatformAdapter {
  const call = (token: string, url: string, init: RequestInit = {}) =>
    requestJson(deps.fetch, url.startsWith("http") ? url : API + url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });

  const pageOfTracks = (json: any): Page<Track> => ({
    items: (json.items ?? [])
      .map((row: any) => toTrack(row.item ?? row.track))
      .filter(Boolean) as Track[],
    next: safeNext(json.next),
  });

  return {
    id: "spotify",
    name: "Spotify",
    writeBatchSize: 100,
    saveBatchSize: 40,

    getAuthUrl({ state, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SPOTIFY_SCOPES,
        state,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
      });
      return `${AUTH_URL}?${q}`;
    },

    async exchangeCode(code, codeVerifier, redirectUri) {
      const json = await requestJson(deps.fetch, TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        }),
      });
      return tokensFrom(json);
    },

    async refresh(refreshToken) {
      const json = await requestJson(deps.fetch, TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
      });
      return tokensFrom(json, refreshToken);
    },

    async getProfile(token) {
      const me = await call(token, "/me");
      return { id: me.id, displayName: me.display_name ?? me.id, imageUrl: me.images?.[0]?.url };
    },

    async getPlaylists(token, cursor) {
      const json = await call(token, cursor ?? "/me/playlists?limit=50");
      return {
        items: (json.items ?? []).filter(Boolean).map(
          (p: any): Playlist => ({
            id: p.id,
            name: p.name,
            description: p.description || undefined,
            trackCount: p.items?.total ?? p.tracks?.total,
            imageUrl: p.images?.[0]?.url,
          }),
        ),
        next: safeNext(json.next),
      };
    },

    async getPlaylistTracks(token, playlistId, cursor) {
      return pageOfTracks(await call(token, cursor ?? `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`));
    },

    async getSavedTracks(token, cursor) {
      return pageOfTracks(await call(token, cursor ?? "/me/tracks?limit=50"));
    },

    async searchByIsrc(token, isrc) {
      const q = new URLSearchParams({ q: `isrc:${isrc}`, type: "track", limit: "5" });
      const json = await call(token, `/search?${q}`);
      return (json.tracks?.items ?? []).map(toTrack).filter(Boolean) as Track[];
    },

    async search(token, { title, artist }) {
      const q = new URLSearchParams({ q: `${title} ${artist}`.slice(0, 200), type: "track", limit: "10" });
      const json = await call(token, `/search?${q}`);
      return (json.tracks?.items ?? []).map(toTrack).filter(Boolean) as Track[];
    },

    async createPlaylist(token, name, description) {
      const p = await call(token, "/me/playlists", {
        method: "POST",
        body: JSON.stringify({ name, description, public: false }),
      });
      return { id: p.id, name: p.name };
    },

    async addTracksToPlaylist(token, playlistId, trackIds) {
      await call(token, `/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: trackIds }),
      });
    },

    async saveTracks(token, trackIds) {
      const q = new URLSearchParams({ uris: trackIds.join(",") });
      await call(token, `/me/library?${q}`, { method: "PUT" });
    },
  };
}
