-- mix n match database (Cloudflare D1 / SQLite)

-- People who use mix n match. We only keep their email.
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One-time sign-in links. We store a hash, never the link itself.
CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  ip         TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX magic_links_email ON magic_links (email, created_at);

-- Logged-in browsers. The cookie holds a random id; we store its hash.
CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Short-lived values used while connecting a music service (OAuth + PKCE).
CREATE TABLE oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Connected music accounts. Tokens are encrypted (AES-256-GCM).
CREATE TABLE connections (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,
  account_id   TEXT,
  account_name TEXT,
  image_url    TEXT,
  enc_tokens   TEXT NOT NULL,
  iv           TEXT NOT NULL,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, platform)
);

-- One row per transfer.
CREATE TABLE transfer_jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  dest        TEXT NOT NULL,
  title       TEXT NOT NULL,
  selections  TEXT NOT NULL,          -- JSON list of the playlists picked
  status      TEXT NOT NULL,          -- QUEUED, RUNNING, WAITING, DONE, FAILED
  message     TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX transfer_jobs_user ON transfer_jobs (user_id, created_at);

-- One row per song inside a transfer, with how well it matched.
CREATE TABLE transfer_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          TEXT NOT NULL REFERENCES transfer_jobs (id) ON DELETE CASCADE,
  sel_index       INTEGER NOT NULL,   -- which playlist (or Liked Songs) in the job
  position        INTEGER NOT NULL,
  src_title       TEXT NOT NULL,
  src_artist      TEXT NOT NULL,
  src_album       TEXT,
  src_isrc        TEXT,
  src_duration_ms INTEGER,
  dest_id         TEXT,
  dest_title      TEXT,
  dest_artist     TEXT,
  confidence      REAL,
  method          TEXT,               -- isrc, exact, fuzzy_jaro_winkler, cache, none
  status          TEXT NOT NULL,      -- PENDING, MATCHED, LOW_CONFIDENCE, FAILED
  written         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX transfer_items_job ON transfer_items (job_id, sel_index, status, position);

-- Shared memory of good matches, so the same song is not searched twice.
CREATE TABLE match_cache (
  key          TEXT NOT NULL,
  dest         TEXT NOT NULL,
  dest_id      TEXT NOT NULL,
  dest_title   TEXT,
  dest_artist  TEXT,
  confidence   REAL NOT NULL,
  method       TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (key, dest)
);

-- Daily API budget tracking (YouTube gives 10,000 units per day).
CREATE TABLE api_quota (
  platform TEXT NOT NULL,
  day      TEXT NOT NULL,
  units    INTEGER NOT NULL,
  PRIMARY KEY (platform, day)
);

-- Security log: sign-ins, connections, transfers, deletions.
CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action  TEXT NOT NULL,
  detail  TEXT,
  ip      TEXT,
  at      INTEGER NOT NULL
);
CREATE INDEX audit_log_at ON audit_log (at);
