// A pretend music service for local testing and demos (only when ENABLE_MOCK=1).
// It behaves like a real one: login redirect, pages of results, searches that
// sometimes find a slightly different title, and a few songs that are missing.
import type { Page, PlatformAdapter, Playlist, Track } from "./types";

const CLASSICS: [string, string, number][] = [
  ["Bohemian Rhapsody", "Queen", 354],
  ["Billie Jean", "Michael Jackson", 294],
  ["Hotel California", "Eagles", 391],
  ["Dreams", "Fleetwood Mac", 257],
  ["Get Lucky (feat. Pharrell Williams & Nile Rodgers)", "Daft Punk", 369],
  ["Blinding Lights", "The Weeknd", 200],
  ["Rolling in the Deep", "Adele", 228],
  ["Mr. Brightside", "The Killers", 222],
  ["Smells Like Teen Spirit", "Nirvana", 301],
  ["Superstition", "Stevie Wonder", 245],
  ["Purple Rain", "Prince", 520],
  ["Lose Yourself", "Eminem", 326],
  ["Africa", "TOTO", 295],
  ["Take On Me", "a-ha", 225],
  ["Levitating", "Dua Lipa", 203],
  ["Bad Guy", "Billie Eilish", 194],
  ["Wonderwall", "Oasis", 258],
  ["Hey Ya!", "OutKast", 235],
  ["Respect", "Aretha Franklin", 147],
  ["Halo", "Beyoncé", 261],
  ["Clocks", "Coldplay", 307],
  ["September", "Earth, Wind & Fire", 215],
  ["Crazy in Love (feat. Jay-Z)", "Beyoncé", 236],
  ["Juicy", "The Notorious B.I.G.", 302],
  ["Shake It Off", "Taylor Swift", 219],
  ["Dancing Queen", "ABBA", 231],
  ["Uptown Funk (feat. Bruno Mars)", "Mark Ronson", 270],
  ["Redbone", "Childish Gambino", 327],
  ["Feel Good Inc.", "Gorillaz", 222],
  ["Nights", "Frank Ocean", 307],
];

function makeTrack(n: number): Track {
  const base = CLASSICS[n % CLASSICS.length];
  const round = Math.floor(n / CLASSICS.length);
  return {
    id: `mock:${n}`,
    title: round === 0 ? base[0] : `${base[0]} (Take ${round + 1})`,
    artist: base[1],
    album: "Mock Album",
    isrc: `QZMCK${String(n).padStart(7, "0")}`,
    durationMs: base[2] * 1000,
  };
}

const PLAYLISTS = [
  { id: "road-trip", name: "Road Trip", start: 0, size: 1000 },
  { id: "chill", name: "Chill Evenings", start: 0, size: 30 },
  { id: "gym", name: "Gym Mix", start: 200, size: 75 },
];
const LIKED = { start: 500, size: 60 };
const PAGE = 50;

function page(start: number, size: number, cursor?: string): Page<Track> {
  const offset = Number(cursor ?? 0);
  const end = Math.min(size, offset + PAGE);
  const items: Track[] = [];
  for (let i = offset; i < end; i++) items.push(makeTrack(start + i));
  return { items, next: end < size ? String(end) : undefined };
}

function numberFrom(track: { isrc?: string; title: string }): number {
  if (track.isrc?.startsWith("QZMCK")) return Number(track.isrc.slice(5));
  return -1;
}

/** How the pretend catalog answers a search, based on the song number. */
function catalogResult(n: number, source: Track): Track[] {
  if (n < 0) return [];
  if (n % 31 === 30) return []; // not available on this service
  const t = makeTrack(n);
  if (n % 20 === 19) {
    // only a different-looking version exists -> low confidence
    return [{ ...t, id: `mock:dest:${n}`, title: `${t.title} (Karaoke Version)`, artist: "Sing King", isrc: undefined }];
  }
  return [{ ...t, id: `mock:dest:${n}`, title: `${source.title} - Remastered 2011`, isrc: undefined }];
}

export function createMockAdapter(): PlatformAdapter {
  return {
    id: "mock",
    name: "Demo Music",
    writeBatchSize: 100,
    saveBatchSize: 50,

    getAuthUrl({ state, redirectUri }) {
      return `${redirectUri}?code=mock-code&state=${encodeURIComponent(state)}`;
    },
    async exchangeCode() {
      return { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600_000 };
    },
    async refresh() {
      return { accessToken: "mock-access", refreshToken: "mock-refresh", expiresAt: Date.now() + 3600_000 };
    },
    async getProfile() {
      return { id: "demo-user", displayName: "Demo Listener" };
    },
    async getPlaylists(_token, cursor) {
      if (cursor) return { items: [] };
      return {
        items: PLAYLISTS.map((p): Playlist => ({ id: p.id, name: p.name, trackCount: p.size })),
      };
    },
    async getPlaylistTracks(_token, playlistId, cursor) {
      const p = PLAYLISTS.find((x) => x.id === playlistId);
      if (!p) return { items: [] };
      return page(p.start, p.size, cursor);
    },
    async getSavedTracks(_token, cursor) {
      return page(LIKED.start, LIKED.size, cursor);
    },
    async searchByIsrc(_token, isrc) {
      const n = numberFrom({ isrc, title: "" });
      // Every 7th song has no ISRC on the destination, forcing text matching.
      if (n < 0 || n % 7 === 6 || n % 31 === 30 || n % 20 === 19) return [];
      return [{ ...makeTrack(n), id: `mock:dest:${n}` }];
    },
    async search(_token, query) {
      const take = Number(query.title.match(/\(Take (\d+)\)$/)?.[1] ?? 1);
      const base = CLASSICS.findIndex(([title]) => query.title.startsWith(title));
      const n = base >= 0 ? (take - 1) * CLASSICS.length + base : -1;
      return catalogResult(n, { ...query, isrc: undefined });
    },
    async createPlaylist(_token, name) {
      return { id: `mock-new-${Date.now()}`, name };
    },
    async addTracksToPlaylist() {},
    async saveTracks() {},
  };
}
