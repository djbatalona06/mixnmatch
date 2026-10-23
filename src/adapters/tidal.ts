// TIDAL adapter (official developer platform, JSON:API format).
// Paths follow the 2026 layout: /userCollectionTracks/me/..., /userCollectionPlaylists/me/...
import { formBody, requestJson } from "../http";
import type { AdapterDeps, Page, PlatformAdapter, Playlist, Tokens, Track } from "./types";

const AUTH_URL = "https://login.tidal.com/authorize";
const TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";
const API = "https://openapi.tidal.com/v2";
// ponytail: one fixed catalog country; read it from /users/me when non-US users report missing songs.
const COUNTRY = "US";

export const TIDAL_SCOPES = "user.read collection.read collection.write playlists.read playlists.write search.read";

/** "PT3M25S" -> 205000 */
export function isoDurationToMs(value?: string): number | undefined {
  const m = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return undefined;
  return Math.round(((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000);
}

type Resource = { id: string; type: string; attributes?: any; relationships?: any };

/** Joins JSON:API `data` references with the full objects in `included`. */
export function tracksFromDocument(doc: any): Track[] {
  const included: Resource[] = doc.included ?? [];
  const byKey = new Map(included.map((r) => [`${r.type}:${r.id}`, r]));
  const refs: Resource[] = Array.isArray(doc.data) ? doc.data : [];
  const tracks: Track[] = [];
  for (const ref of refs) {
    if (ref.type !== "tracks") continue;
    const full = byKey.get(`tracks:${ref.id}`) ?? ref;
    if (!full.attributes) continue;
    const artistRefs: Resource[] = full.relationships?.artists?.data ?? [];
    const artist = artistRefs
      .map((a) => byKey.get(`artists:${a.id}`)?.attributes?.name)
      .filter(Boolean)
      .join(", ");
    tracks.push({
      id: full.id,
      title: full.attributes.version ? `${full.attributes.title} (${full.attributes.version})` : full.attributes.title,
      artist,
      isrc: full.attributes.isrc,
      durationMs: isoDurationToMs(full.attributes.duration),
    });
  }
  return tracks;
}

function tokensFrom(json: any, previousRefresh?: string): Tokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

function nextCursor(doc: any): string | undefined {
  const next: string | undefined = doc.links?.next;
  return next && next.startsWith("/") ? next : undefined;
}

export function createTidalAdapter(clientId: string, clientSecret: string | undefined, deps: AdapterDeps): PlatformAdapter {
  const call = (token: string, path: string, init: RequestInit = {}) =>
    requestJson(deps.fetch, API + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        ...init.headers,
      },
    });

  const tokenRequest = (params: Record<string, string>) =>
    requestJson(deps.fetch, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), ...params }),
    });

  const trackPage = async (token: string, path: string): Promise<Page<Track>> => {
    const doc = await call(token, path);
    return { items: tracksFromDocument(doc), next: nextCursor(doc) };
  };

  const toRefs = (ids: string[]) => JSON.stringify({ data: ids.map((id) => ({ id, type: "tracks" })) });

  return {
    id: "tidal",
    name: "TIDAL",
    writeBatchSize: 20,
    saveBatchSize: 20,

    getAuthUrl({ state, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: TIDAL_SCOPES,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
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
      const doc = await call(token, "/users/me");
      const a = doc.data?.attributes ?? {};
      return { id: doc.data?.id, displayName: a.username || a.firstName || a.email || "TIDAL user" };
    },

    async getPlaylists(token, cursor) {
      const doc = await call(token, cursor ?? `/userCollectionPlaylists/me/relationships/items?countryCode=${COUNTRY}&include=items`);
      const items: Playlist[] = (doc.included ?? [])
        .filter((r: Resource) => r.type === "playlists")
        .map((r: Resource) => ({
          id: r.id,
          name: r.attributes?.name ?? "Untitled",
          description: r.attributes?.description || undefined,
          trackCount: r.attributes?.numberOfItems,
        }));
      return { items, next: nextCursor(doc) };
    },

    getPlaylistTracks(token, playlistId, cursor) {
      return trackPage(
        token,
        cursor ?? `/playlists/${encodeURIComponent(playlistId)}/relationships/items?countryCode=${COUNTRY}&include=items,items.artists`,
      );
    },

    getSavedTracks(token, cursor) {
      return trackPage(token, cursor ?? `/userCollectionTracks/me/relationships/items?countryCode=${COUNTRY}&include=items,items.artists`);
    },

    async searchByIsrc(token, isrc) {
      return (await trackPage(token, `/tracks?countryCode=${COUNTRY}&filter[isrc]=${encodeURIComponent(isrc)}&include=artists`)).items;
    },

    async search(token, { title, artist }) {
      const query = encodeURIComponent(`${title} ${artist}`.slice(0, 200));
      const doc = await call(token, `/searchResults/${query}/relationships/tracks?countryCode=${COUNTRY}&include=tracks,tracks.artists`);
      return tracksFromDocument(doc).slice(0, 10);
    },

    async createPlaylist(token, name, description) {
      const doc = await call(token, `/playlists?countryCode=${COUNTRY}`, {
        method: "POST",
        body: JSON.stringify({ data: { type: "playlists", attributes: { name, description, accessType: "UNLISTED" } } }),
      });
      return { id: doc.data.id, name };
    },

    async addTracksToPlaylist(token, playlistId, trackIds) {
      await call(token, `/playlists/${encodeURIComponent(playlistId)}/relationships/items?countryCode=${COUNTRY}`, {
        method: "POST",
        body: toRefs(trackIds),
      });
    },

    async saveTracks(token, trackIds) {
      await call(token, `/userCollectionTracks/me/relationships/items?countryCode=${COUNTRY}`, {
        method: "POST",
        body: toRefs(trackIds),
      });
    },
  };
}
