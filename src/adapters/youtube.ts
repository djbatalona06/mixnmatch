// YouTube Music adapter using the official YouTube Data API v3.
// Playlists made here show up in YouTube Music. "Liked Songs" = liked videos.
// Every call costs quota units (10,000 per day for the whole app), so we report
// each cost to `spendQuota`, which stops the job before the budget runs out.
import { formBody, requestJson } from "../http";
import { parseYouTubeTitle } from "../matcher/normalize";
import { isoDurationToMs } from "./tidal";
import type { AdapterDeps, Page, PlatformAdapter, Playlist, Tokens, Track } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";

// Official unit costs.
export const YT_COST = { list: 1, search: 100, insert: 50, rate: 50 } as const;

function videoToTrack(videoId: string, title: string, channel: string, durationIso?: string): Track {
  const parsed = parseYouTubeTitle(title ?? "", channel ?? "");
  return { id: videoId, title: parsed.title, artist: parsed.artist, durationMs: isoDurationToMs(durationIso) };
}

function tokensFrom(json: any, previousRefresh?: string): Tokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export function createYouTubeAdapter(clientId: string, clientSecret: string, deps: AdapterDeps): PlatformAdapter {
  const spend = (units: number) => deps.spendQuota?.(units) ?? Promise.resolve();

  const call = async (token: string, units: number, path: string, init: RequestInit = {}) => {
    await spend(units);
    return requestJson(deps.fetch, API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
  };

  const tokenRequest = (params: Record<string, string>) =>
    requestJson(deps.fetch, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({ client_id: clientId, client_secret: clientSecret, ...params }),
    });

  return {
    id: "youtube",
    name: "YouTube Music",
    writeBatchSize: 1, // one video per insert call
    saveBatchSize: 1,

    getAuthUrl({ state, codeChallenge, redirectUri }) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: YOUTUBE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
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
      const json = await call(token, YT_COST.list, "/channels?part=snippet&mine=true");
      const ch = json.items?.[0];
      return {
        id: ch?.id ?? "unknown",
        displayName: ch?.snippet?.title ?? "YouTube user",
        imageUrl: ch?.snippet?.thumbnails?.default?.url,
      };
    },

    async getPlaylists(token, cursor) {
      const q = new URLSearchParams({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
      if (cursor) q.set("pageToken", cursor);
      const json = await call(token, YT_COST.list, `/playlists?${q}`);
      return {
        items: (json.items ?? []).map(
          (p: any): Playlist => ({
            id: p.id,
            name: p.snippet?.title,
            description: p.snippet?.description || undefined,
            trackCount: p.contentDetails?.itemCount,
            imageUrl: p.snippet?.thumbnails?.medium?.url,
          }),
        ),
        next: json.nextPageToken,
      };
    },

    async getPlaylistTracks(token, playlistId, cursor) {
      const q = new URLSearchParams({ part: "snippet", playlistId, maxResults: "50" });
      if (cursor) q.set("pageToken", cursor);
      const json = await call(token, YT_COST.list, `/playlistItems?${q}`);
      const items: Track[] = (json.items ?? [])
        .filter((it: any) => it.snippet?.resourceId?.videoId && it.snippet?.title !== "Deleted video")
        .map((it: any) =>
          videoToTrack(it.snippet.resourceId.videoId, it.snippet.title, it.snippet.videoOwnerChannelTitle ?? ""),
        );
      return { items, next: json.nextPageToken };
    },

    async getSavedTracks(token, cursor) {
      const q = new URLSearchParams({ part: "snippet,contentDetails", myRating: "like", maxResults: "50" });
      if (cursor) q.set("pageToken", cursor);
      const json = await call(token, YT_COST.list, `/videos?${q}`);
      const items: Track[] = (json.items ?? []).map((v: any) =>
        videoToTrack(v.id, v.snippet?.title, v.snippet?.channelTitle, v.contentDetails?.duration),
      );
      return { items, next: json.nextPageToken };
    },

    // No ISRC search on YouTube.

    async search(token, { title, artist }) {
      const q = new URLSearchParams({
        part: "snippet",
        type: "video",
        videoCategoryId: "10", // Music
        maxResults: "5",
        q: `${artist} ${title}`.slice(0, 200),
      });
      const json = await call(token, YT_COST.search, `/search?${q}`);
      return (json.items ?? []).map((it: any) =>
        videoToTrack(it.id?.videoId, it.snippet?.title, it.snippet?.channelTitle ?? ""),
      );
    },

    async createPlaylist(token, name, description) {
      const json = await call(token, YT_COST.insert, "/playlists?part=snippet,status", {
        method: "POST",
        body: JSON.stringify({ snippet: { title: name, description }, status: { privacyStatus: "private" } }),
      });
      return { id: json.id, name };
    },

    async addTracksToPlaylist(token, playlistId, trackIds) {
      for (const videoId of trackIds) {
        await call(token, YT_COST.insert, "/playlistItems?part=snippet", {
          method: "POST",
          body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
        });
      }
    },

    async saveTracks(token, trackIds) {
      for (const id of trackIds) {
        await call(token, YT_COST.rate, `/videos/rate?id=${encodeURIComponent(id)}&rating=like`, { method: "POST" });
      }
    },
  };
}
