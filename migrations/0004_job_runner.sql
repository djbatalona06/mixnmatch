-- The job runner (replaces the Cloudflare Durable Object that used to run each transfer).
-- One row per transfer that is still running. Deleted when it finishes or is stopped.

CREATE TABLE job_runs (
  job_id TEXT PRIMARY KEY REFERENCES transfer_jobs (id) ON DELETE CASCADE,
  spec   TEXT NOT NULL,      -- JSON: who, from where, to where, which playlists
  state  TEXT NOT NULL,      -- JSON: how far the transfer has got
  run_at INTEGER NOT NULL    -- when the next step is due (ms since 1970)
);
CREATE INDEX job_runs_due ON job_runs (run_at);
