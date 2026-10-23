// The "universal adapter" contract. Every music service implements this,
// so the rest of mix n match never needs to know which service it is talking to.
import type { FetchFn } from "../http";

export type Platform = "spotify" | "tidal" | "deezer" | "youtube" | "soundcloud" | "mock";

export interface Track {
  id?: string; // the service's own id (or URI) for this song
  title: string;
  artist: string; // all artists, comma separated
  album?: string;
  isrc?: string;
  durationMs?: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackCount?: number;
  imageUrl?: string;
}

export interface Page<T> {
  items: T[];
  next?: string; // pass back as `cursor` to get the next page; missing = last page
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // ms since epoch; missing = does not expire
}

export interface Profile {
  id: string;
  displayName: string;
  imageUrl?: string;
}

export interface AuthRequest {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface PlatformAdapter {
  id: Platform;
  name: string;
  /** Max songs per "add to playlist" call. */
  writeBatchSize: number;
  /** Max songs per "save to library" call. */
  saveBatchSize: number;

  // Authentication
  getAuthUrl(req: AuthRequest): string;
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;

  // Reading
  getProfile(accessToken: string): Promise<Profile>;
  getPlaylists(accessToken: string, cursor?: string): Promise<Page<Playlist>>;
  getPlaylistTracks(accessToken: string, playlistId: string, cursor?: string): Promise<Page<Track>>;
  getSavedTracks(accessToken: string, cursor?: string): Promise<Page<Track>>;

  // Searching (for matching)
  searchByIsrc?(accessToken: string, isrc: string): Promise<Track[]>;
  search(accessToken: string, query: { title: string; artist: string }): Promise<Track[]>;

  // Writing
  createPlaylist(accessToken: string, name: string, description: string): Promise<Playlist>;
  addTracksToPlaylist(accessToken: string, playlistId: string, trackIds: string[]): Promise<void>;
  saveTracks(accessToken: string, trackIds: string[]): Promise<void>;
}

export interface AdapterDeps {
  fetch: FetchFn;
  /** Called before each API call that costs quota units (YouTube). May throw QuotaError. */
  spendQuota?: (units: number) => Promise<void>;
}
