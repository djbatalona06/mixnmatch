-- mix n match v1.1: fix songs by hand, add to an existing playlist, stop + try again.
--
-- New allowed values (no schema change needed):
--   transfer_items.written  2 = already there (a duplicate we skipped on purpose)
--   transfer_items.status   SKIPPED (the user chose "Skip")
--   transfer_items.method   manual  (the user picked the song by hand)
--   transfer_jobs.status    CANCELLED (the user pressed "Stop")

-- One row per playlist (or Liked Songs) picked in a transfer.
-- Lives in the database (not only inside the running job) so Fix and Try again
-- still know where songs went after the job has finished.
CREATE TABLE transfer_selections (
  job_id             TEXT NOT NULL REFERENCES transfer_jobs (id) ON DELETE CASCADE,
  sel_index          INTEGER NOT NULL,
  kind               TEXT NOT NULL,      -- playlist, liked
  name               TEXT NOT NULL,
  source_id          TEXT,               -- source playlist id (null for liked / file)
  target_playlist_id TEXT,               -- chosen by the user: "add to this existing playlist"
  dest_playlist_id   TEXT,               -- where songs were actually written (new or existing)
  read_done          INTEGER NOT NULL DEFAULT 0,
  write_done         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, sel_index)
);

-- Fast "is this song already in the list?" checks.
CREATE INDEX transfer_items_dest ON transfer_items (job_id, sel_index, dest_id);
