// Fake server answers for the layout check (test/layout.mjs).
// Each screen gets realistic data, with a few extra-long names on purpose,
// because long names are what usually break a layout.
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 15, 0);
const LONG = "A really long playlist name that keeps going and going to test wrapping";

export const me = {
  email: "someone.with.a.long.email.address@example.com",
  connections: [
    { platform: "spotify", accountName: "Sam" },
    { platform: "tidal", accountName: "sam_listens" },
    { platform: "mock", accountName: "Demo" },
  ],
  platforms: [
    { id: "spotify", name: "Spotify", configured: true },
    { id: "tidal", name: "TIDAL", configured: true },
    { id: "deezer", name: "Deezer", configured: true },
    { id: "youtube", name: "YouTube Music", configured: true },
    { id: "soundcloud", name: "SoundCloud", configured: false },
    { id: "mock", name: "Demo Music", configured: true },
  ],
  plan: "free",
  planUntil: null,
  limits: { activeTransfers: 1, syncs: 1, fileTracks: 500 },
  billing: { yearly: true },
};

const jobs = [
  { id: "job-1", title: "Road Trip + Liked Songs", source: "spotify", dest: "tidal", status: "DONE", created_at: NOW - 2 * DAY },
  { id: "job-2", title: LONG, source: "tidal", dest: "youtube", status: "WAITING", created_at: NOW - DAY },
  { id: "job-3", title: "Gym", source: "mock", dest: "spotify", status: "FAILED", created_at: NOW - 3 * DAY },
  { id: "job-4", title: "Chill evenings", source: "spotify", dest: "deezer", status: "CANCELLED", created_at: NOW - 5 * DAY },
];

const job = {
  ...jobs[0],
  message: null,
  sync_id: null,
  total: 1000,
  written: 942,
  alreadyThere: 12,
  counts: { PENDING: 0, MATCHED: 954, LOW_CONFIDENCE: 21, FAILED: 19, SKIPPED: 6 },
  playlists: [
    { sel_index: 0, kind: "liked", name: "Liked Songs", dest_playlist_id: null },
    { sel_index: 1, kind: "playlist", name: "Road Trip", dest_playlist_id: "pl-9" },
    { sel_index: 2, kind: "playlist", name: LONG, dest_playlist_id: "pl-10" },
  ],
};

const SONGS = [
  ["Bohemian Rhapsody", "Queen", "MATCHED", "isrc", 1, 1],
  ["Hotel California", "Eagles", "MATCHED", "exact", 1, 1],
  ["Thinking Out Loud (Live at the Royal Albert Hall, Extended Version)", "Ed Sheeran", "LOW_CONFIDENCE", "fuzzy_jaro_winkler", 0.81, 0],
  ["Song That Does Not Exist Anywhere", "Unknown Band From A Garage", "FAILED", "none", null, 0],
  ["Clocks", "Coldplay", "MATCHED", "cache", 0.97, 2],
  ["Wonderwall", "Oasis", "SKIPPED", null, null, 0],
  ["Superstition", "Stevie Wonder", "MATCHED", "manual", 1, 1],
  ["Dancing Queen", "ABBA", "MATCHED", "isrc", 1, 1],
];
const items = SONGS.map(([title, artist, status, method, confidence, written], i) => ({
  id: i + 1,
  position: i,
  status,
  method,
  confidence,
  written,
  src_title: title,
  src_artist: artist,
  dest_title: status === "MATCHED" || status === "LOW_CONFIDENCE" ? title : null,
  dest_artist: status === "MATCHED" || status === "LOW_CONFIDENCE" ? artist : null,
}));

const syncs = [
  { id: "s1", name: "Road Trip", source: "spotify", dest: "tidal", status: "ACTIVE", message: null, last_job_id: "job-1", last_run_at: NOW - DAY / 2, last_added: 3, next_run_at: NOW + DAY / 2 },
  { id: "s2", name: LONG, source: "tidal", dest: "spotify", status: "PAUSED", message: null, last_job_id: null, last_run_at: null, last_added: null, next_run_at: NOW + DAY },
  { id: "s3", name: "Gym", source: "spotify", dest: "deezer", status: "NEEDS_USER", message: "Deezer needs you to connect again.", last_job_id: "job-3", last_run_at: NOW - DAY, last_added: 0, next_run_at: NOW + DAY },
];

const playlists = ["Road Trip", "Gym", LONG, "Chill evenings", "Focus", "Party mix", "Sunday morning", "90s", "Jazz"].map((name, i) => ({
  id: `pl-${i + 1}`,
  name,
  trackCount: [212, 48, 1300, 77, 30, 150, 64, 99, 18][i],
}));

/**
 * The answer to one /api/* request, as { status, json }.
 * signedIn: false makes /api/me answer 401, like a visitor who has not signed in.
 * failJobs: true makes the transfer list fail, which shows the toast message.
 */
export function answer(method, path, { signedIn = true, failJobs = false } = {}) {
  if (path === "/api/me") return signedIn ? { status: 200, json: me } : { status: 401, json: { error: "Please sign in" } };
  if (!signedIn) return { status: 401, json: { error: "Please sign in" } };
  if (path === "/api/jobs" && failJobs) return { status: 500, json: { error: "This is a sample message, shown at the bottom of the screen." } };
  if (path === "/api/jobs") return { status: 200, json: { jobs } };
  if (/^\/api\/jobs\/[^/]+$/.test(path)) return { status: 200, json: job };
  if (/^\/api\/jobs\/[^/]+\/items$/.test(path)) return { status: 200, json: { items, hasMore: true } };
  if (path === "/api/syncs") return { status: 200, json: { syncs, limit: 5 } };
  if (/^\/api\/library\/[^/]+\/playlists$/.test(path)) return { status: 200, json: { items: playlists } };
  if (/^\/api\/library\//.test(path)) return { status: 200, json: { items: [] } };
  return { status: 404, json: { error: `No fake answer for ${method} ${path}` } };
}
