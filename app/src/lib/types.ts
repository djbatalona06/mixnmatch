// Shapes of the server's replies (see docs/05-backend-schema.md).

export interface Me {
  email: string;
  connections: { platform: string; accountName?: string }[];
  platforms: { id: string; name: string; configured: boolean }[];
  plan: "free" | "premium";
  planUntil: number | null;
  limits: { activeTransfers: number; syncs: number; fileTracks: number };
  billing: { yearly: boolean } | null;
}

export type JobStatus = "QUEUED" | "RUNNING" | "WAITING" | "DONE" | "FAILED" | "CANCELLED";
export type ItemStatus = "PENDING" | "MATCHED" | "LOW_CONFIDENCE" | "FAILED" | "SKIPPED";

export interface JobSummary {
  id: string;
  title: string;
  source: string;
  dest: string;
  status: JobStatus;
  created_at: number;
}

export interface JobPlaylist {
  sel_index: number;
  kind: "playlist" | "liked";
  name: string;
  dest_playlist_id: string | null;
}

export interface Job extends JobSummary {
  message: string | null;
  sync_id: string | null;
  total: number;
  written: number;
  alreadyThere: number;
  counts: Record<ItemStatus, number>;
  playlists: JobPlaylist[];
}

export interface Item {
  id: number;
  position: number;
  status: ItemStatus;
  method: string | null;
  confidence: number | null;
  written: 0 | 1 | 2;
  src_title: string;
  src_artist: string;
  src_album?: string | null;
  src_isrc?: string | null;
  dest_title?: string | null;
  dest_artist?: string | null;
}

export interface Sync {
  id: string;
  name: string;
  source: string;
  dest: string;
  status: "ACTIVE" | "PAUSED" | "NEEDS_USER";
  message: string | null;
  last_job_id: string | null;
  last_run_at: number | null;
  last_added: number | null;
  next_run_at: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackCount?: number;
  imageUrl?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
}

/** Status pill text and colour, shared by Home and Results. */
export const JOB_PILL: Record<string, ["ok" | "warn" | "bad" | "", string]> = {
  QUEUED: ["warn", "Starting"],
  RUNNING: ["warn", "Moving"],
  WAITING: ["warn", "Paused"],
  DONE: ["ok", "Done"],
  FAILED: ["bad", "Failed"],
  CANCELLED: ["", "Stopped"],
};
