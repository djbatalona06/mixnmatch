-- mix n match v1.2: Auto-Sync, SoundCloud, Premium.

-- One row per "keep this playlist copied" (one-way, add-only, once a day).
CREATE TABLE syncs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source           TEXT NOT NULL,
  dest             TEXT NOT NULL,
  source_id        TEXT NOT NULL,          -- source playlist id
  dest_playlist_id TEXT NOT NULL,          -- the copy on the destination
  name             TEXT NOT NULL,
  status           TEXT NOT NULL,          -- ACTIVE, PAUSED, NEEDS_USER
  message          TEXT,
  last_job_id      TEXT,
  last_run_at      INTEGER,
  last_added       INTEGER,
  next_run_at      INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE (user_id, source, source_id, dest)
);
CREATE INDEX syncs_due ON syncs (status, next_run_at);

-- Songs a sync has already handled, so they are never matched or added again
-- (and a song the user removed from the copy is never put back).
CREATE TABLE sync_seen (
  sync_id TEXT NOT NULL REFERENCES syncs (id) ON DELETE CASCADE,
  key     TEXT NOT NULL,                   -- same key as match_cache: isrc:… or txt:title|artist
  PRIMARY KEY (sync_id, key)
);

ALTER TABLE transfer_jobs ADD COLUMN sync_id TEXT;   -- set on jobs started by a sync
ALTER TABLE transfer_items ADD COLUMN src_key TEXT;  -- match_cache-style key of the source song

-- Premium plan. Card details never touch mix n match: Stripe hosts the payment pages.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';   -- free, premium
ALTER TABLE users ADD COLUMN plan_until INTEGER;                   -- end of the paid period (ms)
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;

-- Stripe can send the same event twice; we remember which ones we handled.
CREATE TABLE billing_events (
  id          TEXT PRIMARY KEY,   -- Stripe event id
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
