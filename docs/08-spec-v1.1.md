# 08 — Spec: v1.1 "Better results"

> **In plain words**
> Sometimes mix n match can't find a song, or it isn't sure it picked the right one.
> In v1.1 you can **fix those songs yourself**: tap *Fix*, look at a short list, pick the right song.
> You can also **add songs to a playlist you already have**, and mix n match will not add a song that is already there.
> And if a move is taking too long, you can **stop it**, and later **try again** without making a mess.

**Status:** spec only — no code yet. Builds on v1 (merged to `main`).
**Covers:** FR-07 (fix songs by hand), plus two new items: *add to an existing playlist* and *cancel + retry*.
**Next:** [09-spec-v1.2.md](09-spec-v1.2.md) (Auto-Sync, SoundCloud, Premium).

---

## Research notes (Oct 2026)

Checked while writing this spec. "v1" means it was already found during v1 research ([01-prd.md](01-prd.md)).

| Fact | Why it matters here | Source |
|---|---|---|
| YouTube Data API: a search costs **100** units, adding a song **50**, and the whole app gets **10,000/day** | Each *Fix* search on YouTube eats 1% of the day. Needs a warning and a hard stop. | v1 |
| Saving a song that is already liked does nothing on Spotify, TIDAL, Deezer and YouTube | Liked Songs don't need the duplicate check — only playlists do | Service API docs — verify with real accounts (plan step 2.6) |
| Adding a song that is already in a playlist is **not** safe: Spotify and YouTube add a second copy; others may add it or return an error | Why "add to existing" needs its own "already there?" phase before writing | Service API docs — verify with real accounts |
| Cloudflare Workers Free: **10 ms CPU** per run, **50** outside calls, **50** D1 queries per run | The new phase must fit the same small-step budget as the others | v1, re-checked on developers.cloudflare.com |
| Durable Object storage is deleted in `finish()` when a job ends | Per-playlist progress must move into D1 so Fix-it and Retry still work after a job is done | Code: `src/jobs/transfer-job.ts` |

---

## Shared groundwork (do first)

All three features need to know, **after a job has finished**, which playlist each selection was written to and how far it got. Today that lives only in the Durable Object (`JobState.destPlaylistId`), and `finish()` calls `deleteAll()`.

### New migration `migrations/0002_v1_1.sql`

```sql
-- One row per playlist (or Liked Songs) picked in a transfer.
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
```

### Value changes (no schema change, just new allowed values)

| Column | Old values | New value | Meaning |
|---|---|---|---|
| `transfer_items.written` | `0` not yet, `1` added | **`2`** | Already there — a duplicate we skipped on purpose |
| `transfer_items.status` | `PENDING`, `MATCHED`, `LOW_CONFIDENCE`, `FAILED` | **`SKIPPED`** | The user chose *Skip* in the Fix dialog |
| `transfer_items.method` | `isrc`, `exact`, `fuzzy_jaro_winkler`, `cache`, `none` | **`manual`** | The user picked the song by hand |
| `transfer_jobs.status` | `QUEUED`, `RUNNING`, `WAITING`, `DONE`, `FAILED` | **`CANCELLED`** | The user pressed *Stop* |

Add these values to [05-backend-schema.md](05-backend-schema.md) when this ships.

### Code changes

| File | Change |
|---|---|
| `src/routes/jobs.ts` → `createJob` | After inserting `transfer_jobs`, insert one `transfer_selections` row per selection in **one** `json_each` INSERT. For file uploads set `read_done = 1` (songs are already stored). |
| `src/jobs/engine.ts` → `runStep` | On "read finished" set `read_done = 1`; after `createPlaylist` save `dest_playlist_id`; when a selection has nothing left to write set `write_done = 1`. Keep `JobState.destPlaylistId` as a fast copy, but D1 is now the truth. |
| `src/jobs/engine.ts` → new `stateFromSelections(db, spec)` | Rebuilds a `JobState` from D1: first selection with `write_done = 0`, phase `read` if `read_done = 0` else `match`, `destPlaylistId` from the row. Used by Retry. |
| `src/routes/jobs.ts` → `getJob` | Add `SKIPPED` to `counts`; return `alreadyThere` (= rows with `written = 2`). |
| `src/routes/jobs.ts` → `listJobItems` | Also return the item `id` (needed by Fix/Skip) and allow `status=SKIPPED` and a new `filter=already`. |
| `src/index.ts` → `cleanup` | No change: `transfer_selections` rows go with their job via `ON DELETE CASCADE`. |

Query budget: the extra writes are one small UPDATE per phase change, so steps stay well under the 15-query test limit.

---

## Feature 1 — Fix-it screen (FR-07)

**Who:** a user on `/results` looking at songs marked *Need a look* (`LOW_CONFIDENCE`) or *Not found* (`FAILED`).

### Flow
1. Tap **Fix** on a row. A dialog opens with a search box already filled in with the song's title and artist.
2. Results come from the **destination** app (up to 10, showing title, artist, album).
3. **Use this** adds the song now. **Skip** marks it as skipped. Either way the row updates in place and the dialog closes.

### API

| Method & path | Does |
|---|---|
| `GET /api/jobs/:id/items/:itemId/search?q=` | Searches the destination app. Uses `withToken` + `adapter.search` (same code path as matching: `src/connections.ts` and the adapters). `q` is trimmed to 200 chars; empty `q` falls back to `"<title> <artist>"`. |
| `POST /api/jobs/:id/items/:itemId/fix` body `{ destId, destTitle, destArtist }` | Sets `status = 'MATCHED'`, `method = 'manual'`, `confidence = 1`, `dest_*` fields. Then: |
| | • **Job finished** (`DONE` / `FAILED` / `CANCELLED`): writes right away with **one** `addTracksToPlaylist` (playlist) or `saveTracks` (liked) call, using `dest_playlist_id` from `transfer_selections`, then sets `written = 1`. |
| | • **Job still running:** does nothing else — the normal write phase picks the row up because it is now `MATCHED` and `written = 0`. |
| `POST /api/jobs/:id/items/:itemId/skip` | Sets `status = 'SKIPPED'`. |

Rules for all three:
- **Owner check:** every query joins `transfer_items.job_id` → `transfer_jobs.user_id = <signed-in user>`. A wrong user or a wrong item gets **404**, never 403 (don't reveal that it exists).
- **Only fixable rows:** item must be `LOW_CONFIDENCE`, `FAILED` or `SKIPPED` and `written = 0`. Otherwise **409**.
- **Rate limit:** search is limited to **30 per minute per user** (same counting style as the magic-link limit in `src/auth/magic-link.ts`, using `audit_log` or a tiny counter table).
- **CSRF:** `fix` and `skip` are changing calls → existing `X-Requested-With` + same-`Origin` guard.
- `destId` is validated like a playlist id (string, ≤ 200 chars, no control characters). `destTitle` / `destArtist` ≤ 300 chars.
- If the destination playlist was deleted by the user since the job ended, the write fails → return **409** "That playlist no longer exists on <app>" and leave the row unwritten.

### Safety
- **Manual picks are never written to the shared `match_cache`.** One user must not be able to "teach" a wrong match to everyone else. (Automatic `MATCHED` results still go in the cache, as today.)
- **YouTube:** each search costs 100 quota units. The dialog shows *"Each search on YouTube uses part of a small daily allowance."* If `spendQuota` throws `QuotaError`, return **429** with "YouTube's daily allowance is used up. Try again after midnight (UTC)."

### UI
- `public/results.html`: a **Fix** button in the last column of `LOW_CONFIDENCE` / `FAILED` rows, and **one** `<dialog id="fix">`. Reuse the existing dialog styles (`dialog`, `.dialog-head`, `.dialog-body` in `public/css/styles.css` — the same ones the "peek" dialog in the wizard uses).
- `public/js/results.js`: open/close, search (debounced 400 ms, plus an explicit **Search** button), *Use this* / *Skip*, update the row and the number tiles.
- **Accessible:** the search box gets focus when the dialog opens; results are a list of real `<button>`s; `Esc` closes; focus returns to the row's Fix button; results area has `aria-live="polite"` ("5 results").
- All text inserted with `el()` (no `innerHTML`), as in the rest of the site.

### Tests (`test/fix.test.ts`)
- A fix on a **finished** job calls `addTracksToPlaylist` **exactly once** with the right playlist id, and sets `written = 1`.
- A fix on a **running** job makes no write call; the next write step adds it.
- Skip sets `SKIPPED`; skipped rows are never written.
- Another user's job or item → **404**.
- Manual picks **never** appear in `match_cache`.
- YouTube `QuotaError` on search → **429**.

---

## Feature 2 — Add to an existing playlist + skip duplicates

### Flow
In wizard step 4 (**Review**), each playlist row gets a small choice:
- **New playlist** (default — same as v1)
- **Add to:** `[dropdown of your playlists on the destination app]`

The dropdown is filled from the existing `GET /api/library/:dest/playlists` (first page, with a *Load more* option if `next` is set). Liked Songs rows don't get the choice.

### API
- `POST /api/jobs`: `selections[].targetPlaylistId` (optional). Validated exactly like `id` in `routes/jobs.ts` (`str(s.targetPlaylistId, 200)`). Ignored for `kind = "liked"`. Saved into `transfer_selections.target_playlist_id`, and copied into `dest_playlist_id` up front so the write phase never calls `createPlaylist` for it.

### Engine — new phase `existing`
Order per selection becomes: `read → match → existing → write`. The `existing` phase runs **only** when `target_playlist_id` is set.

1. Page through the destination playlist with `getPlaylistTracks`, at most `PAGES_PER_STEP` pages per step (cursor kept in `JobState.cursor`, same as `read`).
2. For each page, mark matched items whose `dest_id` is already in the playlist as `written = 2` — **one** `json_each` UPDATE per page:
   ```sql
   UPDATE transfer_items SET written = 2
   WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0
     AND dest_id IN (SELECT value FROM json_each(?3))
   ```
3. When the last page is done, also skip **duplicates inside the source list** (same song twice in one playlist): keep the lowest `position`, set the rest to `written = 2`:
   ```sql
   UPDATE transfer_items SET written = 2
   WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' AND written = 0
     AND id NOT IN (SELECT MIN(id) FROM transfer_items
                    WHERE job_id = ?1 AND sel_index = ?2 AND status = 'MATCHED' GROUP BY dest_id)
   ```
   This source-duplicate step also runs for **new** playlists (cheap, and v1 would add the song twice).
4. Move to `write`.

**Liked Songs skip this phase:** saving an already-liked song does nothing on all four apps.

**Manual fixes after the job:** the Fix endpoint checks `written = 2` rows with the same `dest_id` in the same selection before writing, so a hand-picked duplicate is also skipped.

### Results UI
- New number tile **Already there** (count of `written = 2`).
- New filter tab **Already there** (uses `filter=already`).
- Summary line: "Added 30 songs to *Road Trip*. 20 were already there."

### Tests (`test/existing.test.ts`)
- A 50-song target playlist with 20 overlaps → exactly **30** songs added, 20 marked `written = 2`.
- A song that appears twice in the source is added **once**.
- `createPlaylist` is **never** called when `targetPlaylistId` is set.
- Queries per step stay **under 15** (same check as `engine.test.ts`).

---

## Feature 3 — Cancel + Retry

### Cancel
`POST /api/jobs/:id/cancel` — owner only, only while the job is `QUEUED`, `RUNNING` or `WAITING` (otherwise **409**).

1. Calls a new Durable Object method **`cancel()`**: `deleteAlarm()` → `deleteAll()` → set `transfer_jobs.status = 'CANCELLED'`, `message = 'Stopped by you.'`, `finished_at = now`.
2. If an `alarm()` is already running when cancel arrives, it must not undo the cancel: at the start of `alarm()` and before `setStatus`, re-read the job status from D1 and return early if it is `CANCELLED`. (`setStatus` also gets `AND status != 'CANCELLED'` in its WHERE.)
3. **Songs already added stay** on the destination. The UI says so plainly: *"Stopped. The 120 songs already added will stay in your playlist."*

### Retry
`POST /api/jobs/:id/retry` body `{ includeUnsure?: boolean }` — allowed when the job is `DONE`, `FAILED` or `CANCELLED` **and** the user has no other active transfer (same check as `createJob`, else **409**).

1. Set `FAILED` items back to `PENDING` (and clear their `dest_*`, `confidence`, `method`). With **"Also try Need a look songs again"** checked, also reset `LOW_CONFIDENCE`. `SKIPPED` and `MATCHED` rows are never touched.
2. Reset `write_done = 0` for selections that now have `PENDING` rows or unwritten `MATCHED` rows.
3. Set the job back to `QUEUED`, clear `finished_at`, and call `stub.start(spec, stateFromSelections(...))`:
   - selections with `read_done = 1` **skip the read phase** (songs are never read twice);
   - the stored `dest_playlist_id` is **reused**, so no second playlist is created.
4. A job that `FAILED` halfway (for example, the user had to reconnect a service) **resumes where it stopped**.

`TransferJob.start(spec, state?)` gets an optional second argument; without it, it uses `initialState(spec)` as today.

### UI
- `/results`: **Stop** button (with a `confirm()`: "Stop moving songs? Songs already added will stay.") while active; **Try again** button when finished, plus the *"Also try Need a look songs again"* checkbox.
- Dashboard: `CANCELLED` shows as a grey pill labelled **Stopped** (`STATUS_PILL.CANCELLED = ["", "Stopped"]` in `public/js/dashboard.js`).

### Tests (`test/cancel-retry.test.ts`)
- After cancel, no more write calls happen, even if an alarm was mid-flight.
- Retry never calls `getPlaylistTracks` / `getSavedTracks` for selections with `read_done = 1`, and never calls `createPlaylist` a second time.
- Retry after an `AuthError` failure resumes at the selection and phase where it stopped.
- Retry while another transfer is active → **409**.

---

## Build order

1. Groundwork (migration + `transfer_selections` writes + `stateFromSelections`) — with tests.
2. Cancel + Retry (smallest UI, proves the groundwork).
3. Add to existing + skip duplicates.
4. Fix-it screen.
5. Update [05-backend-schema.md](05-backend-schema.md) and [03-app-flow.md](03-app-flow.md); run the browser smoke test with the Demo adapter.

## v1.1 acceptance (plain words)
- I can fix any unsure song by hand in **under 3 taps**.
- Moving into a playlist I already have **never adds a song twice**.
- I can **stop** a transfer, and I can **try again** without making a mess.
- Everything still runs on Cloudflare's **free** plan.
