// Picks the right adapter for a platform and tells the website which ones are switched on.
import type { Env } from "../env";
import { QuotaError, type FetchFn } from "../http";
import { createDeezerAdapter } from "./deezer";
import { createMockAdapter } from "./mock";
import { createSoundCloudAdapter } from "./soundcloud";
import { createSpotifyAdapter } from "./spotify";
import { createTidalAdapter } from "./tidal";
import type { Platform, PlatformAdapter } from "./types";
import { createYouTubeAdapter } from "./youtube";

export const PLATFORMS: { id: Platform; name: string; isConfigured: (env: Env) => boolean }[] = [
  { id: "spotify", name: "Spotify", isConfigured: (e) => !!e.SPOTIFY_CLIENT_ID },
  { id: "tidal", name: "TIDAL", isConfigured: (e) => !!e.TIDAL_CLIENT_ID },
  { id: "deezer", name: "Deezer", isConfigured: (e) => !!(e.DEEZER_APP_ID && e.DEEZER_SECRET) },
  { id: "youtube", name: "YouTube Music", isConfigured: (e) => !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) },
  { id: "soundcloud", name: "SoundCloud", isConfigured: (e) => !!(e.SOUNDCLOUD_CLIENT_ID && e.SOUNDCLOUD_CLIENT_SECRET) },
  { id: "mock", name: "Demo Music", isConfigured: (e) => e.ENABLE_MOCK === "1" },
];

// YouTube's daily budget is 10,000 units. Keep 1,000 spare for browsing playlists.
export const YOUTUBE_DAILY_BUDGET = 9000;

export function isPlatform(value: string): value is Platform {
  return PLATFORMS.some((p) => p.id === value);
}

export function platformName(id: string): string {
  return PLATFORMS.find((p) => p.id === id)?.name ?? id;
}

export function platformList(env: Env) {
  return PLATFORMS.filter((p) => p.id !== "mock" || p.isConfigured(env)).map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.isConfigured(env),
  }));
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Records quota use in D1; throws QuotaError if today's budget would be exceeded. */
export async function spendQuota(db: D1Database, platform: string, units: number, budget: number): Promise<void> {
  const row = await db
    .prepare(
      `INSERT INTO api_quota (platform, day, units) VALUES (?1, ?2, ?3)
       ON CONFLICT (platform, day) DO UPDATE SET units = api_quota.units + excluded.units
       WHERE api_quota.units + excluded.units <= ?4
       RETURNING units`,
    )
    .bind(platform, utcDay(), units, budget)
    .first<{ units: number }>();
  if (!row) throw new QuotaError(platform);
}

export function getAdapter(env: Env, platform: Platform, fetchFn: FetchFn = (u, i) => fetch(u, i)): PlatformAdapter {
  const meta = PLATFORMS.find((p) => p.id === platform);
  if (!meta || !meta.isConfigured(env)) throw new Error(`${platform} is not set up on this server`);
  switch (platform) {
    case "spotify":
      return createSpotifyAdapter(env.SPOTIFY_CLIENT_ID!, { fetch: fetchFn });
    case "tidal":
      return createTidalAdapter(env.TIDAL_CLIENT_ID!, env.TIDAL_CLIENT_SECRET, { fetch: fetchFn });
    case "deezer":
      return createDeezerAdapter(env.DEEZER_APP_ID!, env.DEEZER_SECRET!, { fetch: fetchFn });
    case "youtube":
      return createYouTubeAdapter(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!, {
        fetch: fetchFn,
        spendQuota: (units) => spendQuota(env.DB, "youtube", units, YOUTUBE_DAILY_BUDGET),
      });
    case "soundcloud":
      return createSoundCloudAdapter(env.SOUNDCLOUD_CLIENT_ID!, env.SOUNDCLOUD_CLIENT_SECRET!, { fetch: fetchFn });
    case "mock":
      return createMockAdapter();
  }
}
