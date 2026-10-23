# 09 — Spec: v1.2 "Keep it going"

> **In plain words**
> In v1.2 mix n match can **keep a playlist copied for you**. If you add new songs to a playlist on one app, mix n match adds them to the copy on your other app once a day. It only ever **adds** songs — it never deletes anything.
> You can also move music **to and from SoundCloud**.
> And there will be a **Premium** plan you can pay for, which lets you keep more playlists copied and run more moves at once. The free plan stays free.

**Status:** spec only — no code yet. Needs v1.1 ([08-spec-v1.1.md](08-spec-v1.1.md)) first: Auto-Sync reuses *add to an existing playlist + skip duplicates* and `transfer_selections`.
**Covers:** FR-06 (recurring sync), SoundCloud, and the Premium plan from the PRD.

---

## Research notes (Oct 2026)

"v1" means it was already found during v1 research ([01-prd.md](01-prd.md)). "Verify" means it must be checked with a real account before building.

| Fact | Why it matters here | Source |
|---|---|---|
| Cloudflare Workers Free allows **5 Cron Triggers per account**, 10 ms CPU per cron run, 15 min wall time | One extra hourly cron for syncs fits; each cron run must stay tiny and hand work to Durable Objects | developers.cloudflare.com → Workers → Limits |
| Durable Object alarms: 15 min wall time per alarm; SQLite-backed DOs are on the Free plan | Each sync run can reuse the `TransferJob` DO exactly like a normal transfer | developers.cloudflare.com → Durable Objects → Limits |
| YouTube: 10,000 units/day for the whole app; search 100, add 50 | A daily sync **into** YouTube could use up the allowance for everyone | v1 |
| Spotify Development Mode: 5 users max, owner needs Premium | Auto-Sync and Premium only matter for real users once Spotify grants extended quota | v1 |
| SoundCloud auth is **OAuth 2.1 with PKCE (required)**, and the token exchange also sends `client_secret` | Fits our existing PKCE flow; needs a server-side secret like TIDAL/Google | developers.soundcloud.com → API Guide |
| SoundCloud playlists: `POST /playlists` creates one with a `tracks` list; changing tracks is a `PUT /playlists/:id` with the **full** list | "Add songs" is read → append → replace, not a simple add call | developers.soundcloud.com → API Guide |
| SoundCloud has no public ISRC search; its catalogue mixes label releases with user uploads, remixes and covers | Text matching only; expect a lower match rate and more *Need a look* | Verify |
| Whether SoundCloud accepts **new** API apps right now (it has paused sign-ups in the past) | If not, SoundCloud ships as file import/export only, like the Deezer fallback | Verify |
| Stripe Checkout + Customer Portal are hosted by Stripe; webhooks are signed with HMAC-SHA256 (`Stripe-Signature` header) | No card data ever touches mix n match; signature can be checked with Web Crypto in a Worker, no SDK needed | Stripe docs — verify at build |

---

## Feature 4 — Auto-Sync (FR-06): one-way, add-only

**What:** "Keep this playlist copied." New songs added to playlist **A** on app **X** also get added to playlist **B** on app **Y**, **once a day**.

**Never deletes**, for safety. If you remove a song from A, it stays in B. If you remove a song from B, sync won't put it back (see `sync_seen` below). Two-way sync and removals are listed under **Later**.

### Setup
- A **Keep in sync** button on a finished transfer's results page — only for `kind = "playlist"` selections that have a `dest_playlist_id`, and not for file uploads (a file can't change).
- A **Syncs** section on the dashboard: list (source → destination, playlist names), **Pause / Resume**, **Delete**, **Last run** ("Today 04:12 — added 3 songs" or "Needs you: reconnect Spotify").

### Data — migration `migrations/0003_v1_2.sql`

```sql
-- One row per "keep this playlist copied".
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

-- Songs a sync has already handled, so they are never matched or added again.
CREATE TABLE sync_seen (
  sync_id TEXT NOT NULL REFERENCES syncs (id) ON DELETE CASCADE,
  key     TEXT NOT NULL,                   -- same key as match_cache: isrc:… or txt:title|artist
  PRIMARY KEY (sync_id, key)
);

ALTER TABLE transfer_jobs ADD COLUMN sync_id TEXT;   -- set on jobs started by a sync
```

When a sync is created, `sync_seen` is filled with the keys of every song in the original transfer (one `json_each` INSERT … SELECT from `transfer_items`), so day one only adds songs that are truly new.

### How a sync runs
1. **New cron** `"7 * * * *"` (hourly) in `wrangler.jsonc` — account total becomes 2 of the 5 free crons. The `scheduled` handler checks `event.cron` to tell it apart from the 03:17 clean-up.
2. The cron picks up to **20** due syncs: `status = 'ACTIVE' AND next_run_at <= now`, ordered by `next_run_at`. For each one it only does cheap D1 work and calls a `TransferJob` stub — the heavy work happens in the DO, so the cron stays inside 10 ms CPU.
3. If the user already has an active transfer, skip it this hour (`next_run_at = now + 1h`). One running transfer per user stays the rule on the free plan.
4. Otherwise create a normal `transfer_jobs` row (`sync_id` set, title "Sync: <name>") and one `transfer_selections` row with `target_playlist_id = dest_playlist_id`, then start the DO.
5. The engine runs `read → match → existing → write` as in v1.1, with one addition: in the `read` phase of a sync job, before `insertTracks`, it looks up the page's keys (`cacheKey()`) in `sync_seen` with one `json_each` SELECT and leaves those songs out. Only new songs are stored and matched, which keeps searches — and YouTube quota — tiny.
6. On finish, insert the new keys into `sync_seen` (matched, not found and skipped alike — a song is tried **once**; the user can fix it on the results page), set `last_run_at`, `last_added`, `last_job_id`, `next_run_at = now + 24h`.
7. If a run adds 0 songs, delete its `transfer_jobs` row so the dashboard isn't filled with empty runs.

### Errors
- `AuthError` → sync becomes `NEEDS_USER` with "Reconnect <app> to keep syncing". Reconnecting the app sets that user's `NEEDS_USER` syncs back to `ACTIVE`.
- Source or destination playlist deleted (404 from the adapter) → `NEEDS_USER`, "The playlist was removed on <app>."
- `RateLimitError` / `QuotaError` → handled by the DO as today (pause and resume).
- **YouTube as a sync destination is off** until Google raises the quota. The *Keep in sync* button explains why.

### Limits
| | Free | Premium |
|---|---|---|
| Active syncs | **1** | **20** |
| How often | once a day | once a day |

### API
| Method & path | Does |
|---|---|
| `POST /api/syncs` `{ jobId, selIndex }` | Creates a sync from a finished transfer selection (owner check, limit check, YouTube check) |
| `GET /api/syncs` | Lists the user's syncs |
| `PATCH /api/syncs/:id` `{ status: "ACTIVE" \| "PAUSED" }` | Pause / resume |
| `DELETE /api/syncs/:id` | Deletes the sync (the copied playlist stays) |

All scoped to `user_id`; changing calls use the existing CSRF guard. "Delete my account" also deletes syncs (cascade + explicit delete in `DELETE /api/me`).

### Tests (`test/sync.test.ts`)
- A source with 3 new songs since setup → exactly 3 added; old songs never searched again.
- A song removed from the destination by the user is **not** re-added.
- A sync for a user with an active transfer is postponed, not started.
- `AuthError` → `NEEDS_USER`; reconnect → `ACTIVE`.
- The cron's own work stays under 15 queries for 20 due syncs.

### Later (not in v1.2)
Two-way sync, mirroring removals, syncing Liked Songs, choosing the time of day, more than once a day.

---

## Feature 5 — SoundCloud

**What:** SoundCloud becomes a fifth service, usable as **source** and **destination**.

### Adapter `src/adapters/soundcloud.ts`
| Contract method | SoundCloud call |
|---|---|
| `getAuthUrl` / `exchangeCode` / `refresh` | `secure.soundcloud.com/authorize` and `/oauth/token`, PKCE **plus** `client_secret` |
| `getProfile` | `GET /me` |
| `getPlaylists` | `GET /me/playlists` (paged with `linked_partitioning=true` → `next_href`) |
| `getPlaylistTracks` | `GET /playlists/:id/tracks` (paged) |
| `getSavedTracks` | `GET /me/likes/tracks` (paged) — SoundCloud "Likes" = Liked Songs |
| `search` | `GET /tracks?q=<title artist>` — no `searchByIsrc` |
| `createPlaylist` | `POST /playlists` with `sharing: "private"` |
| `addTracksToPlaylist` | Read current track ids → append (skipping ones already there) → `PUT /playlists/:id` with the full list |
| `saveTracks` | `POST /likes/tracks/:id`, one per song (`saveBatchSize = 1`) |

Notes:
- Cursors: only follow `next_href` values that start with `https://api.soundcloud.com/` (same rule as the other adapters).
- `artist` = `publisher_metadata.artist` when present, else `user.username`. Remixes, covers and "(Live)" uploads are common, so matching keeps the normal threshold — more songs will land in *Need a look*, which v1.1's Fix screen handles.
- Because `addTracksToPlaylist` replaces the whole list, keep `writeBatchSize` large (e.g. 100) but never run two writes on the same playlist at once (already true: one DO per job).
- Playlist size limit and rate limits: **verify** with a real account and set `writeBatchSize` / backoff to match.

### Wiring
- `Platform` union in `src/adapters/types.ts`, `src/adapters/registry.ts`, `PLATFORM_NAMES` in `src/jobs/transfer-job.ts`, the platform list in the wizard and dashboard.
- Secrets: `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`. Like the others, SoundCloud only appears as "connectable" once both exist.
- CSP: `img-src` already allows `https:`, so artwork works with no change.
- If SoundCloud is not accepting new apps: ship it as a **file** source only (users export from SoundCloud with a third-party tool → JSPF/CSV import already works), and say so on the connect screen.

### Tests
Same fake-reply style as `test/adapters.test.ts`: paging, `next_href` host check, PUT-with-full-list keeps old songs and doesn't duplicate, error mapping (401 → `AuthError`, 429 → `RateLimitError`).

---

## Feature 6 — Premium payments

**What:** an optional paid plan. The free plan keeps everything v1 + v1.1 offers.

### What Premium unlocks
| | Free | Premium |
|---|---|---|
| Transfers, Fix-it, add to existing, cancel/retry | ✅ | ✅ |
| Active Auto-Syncs | 1 | 20 |
| Transfers running at the same time | 1 | 3 |
| Songs per uploaded file | 5,000 | 20,000 |

**Price:** to be decided by the owner (placeholder: monthly and yearly, with the yearly price about 2 months cheaper). Cancel any time from the Billing page; Premium lasts until the end of the paid period.

### How payment works (Stripe, hosted)
- **Upgrade:** `POST /api/billing/checkout` creates a Stripe **Checkout Session** (`mode: subscription`, `client_reference_id = user.id`, success/cancel URLs back to `/dashboard`) and returns its URL. The browser goes to Stripe; **card details never touch mix n match**.
- **Manage / cancel:** `POST /api/billing/portal` creates a Stripe **Customer Portal** session and returns its URL.
- **Webhook:** `POST /api/billing/webhook` (no session cookie, no CSRF header — Stripe calls it). It:
  1. Checks the `Stripe-Signature` header: HMAC-SHA256 of `"<timestamp>.<raw body>"` with `STRIPE_WEBHOOK_SECRET`, using Web Crypto and a constant-time compare; rejects if the timestamp is older than 5 minutes.
  2. Ignores event ids it has already handled (`billing_events` table) — Stripe can send the same event twice.
  3. Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
- Stripe is called with plain `fetch` to `https://api.stripe.com/v1/…` (form-encoded, `Authorization: Bearer STRIPE_SECRET_KEY`), same style as the adapters — no SDK, no build step.

### Data (same migration `0003_v1_2.sql`)
```sql
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';   -- free, premium
ALTER TABLE users ADD COLUMN plan_until INTEGER;                   -- end of paid period
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;

CREATE TABLE billing_events (
  id          TEXT PRIMARY KEY,   -- Stripe event id
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
```
A user counts as Premium when `plan = 'premium' AND plan_until > now`. One helper `isPremium(user)` is used by the limit checks in `createJob`, `POST /api/syncs` and the file upload check. If Premium ends with more than 1 sync, the extra syncs are set to `PAUSED` (oldest one stays active) — never deleted.

### Secrets & setup
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. Billing buttons only appear when these exist. Test everything in Stripe **test mode** first.

### Privacy & legal
- We store only the Stripe customer id and plan dates — no card data, no address.
- "Delete my account" cancels the Stripe subscription first, then deletes the user.
- Update [07-legal-security.md](07-legal-security.md), the privacy page (Stripe as a processor) and the terms (price, renewal, cancellation, refunds) — **lawyer review before charging real money**.
- Cost check: if Premium usage outgrows the Workers Free limits, move to Workers Paid ($5/month); Premium income should cover it.

### Tests (`test/billing.test.ts`)
- Bad or old signature → 400, nothing changes.
- The same event twice → handled once.
- `subscription.deleted` → plan ends; extra syncs paused, not deleted.
- Free user hitting a Premium limit gets a clear 402/409 message with an **Upgrade** link.

---

## Build order
1. Auto-Sync (needs v1.1 groundwork + "add to existing").
2. Premium (Auto-Sync limits are the first thing it unlocks).
3. SoundCloud (independent; blocked only on getting a SoundCloud app approved).
4. Update [05-backend-schema.md](05-backend-schema.md), [02-trd.md](02-trd.md), [03-app-flow.md](03-app-flow.md), [07-legal-security.md](07-legal-security.md).

## v1.2 acceptance (plain words)
- I set up a sync once, add a song on my old app, and **by tomorrow** it's in my new app.
- Sync **never removes** anything, and never puts back a song I removed.
- I can move playlists **to and from SoundCloud** (or, if SoundCloud says no, with a file).
- I can **pay for Premium and cancel it** myself, and mix n match never sees my card.
