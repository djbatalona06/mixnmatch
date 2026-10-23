# 05 — Backend Schema

Source of truth: [`migrations/`](../migrations/) — `0001_init.sql` (v1), `0002_v1_1.sql` (v1.1), `0003_v1_2.sql` (v1.2). Cloudflare D1 / SQLite.

## Tables
| Table | One row per… | Key columns | Kept for |
|---|---|---|---|
| `users` | person | `id`, `email`, `plan`, `plan_until`, `stripe_customer_id` | Until account deleted |
| `magic_links` | sign-in email | `token_hash` (SHA-256, never the token), `email`, `expires_at`, `used_at` | 15 min (+1 day, then purged) |
| `sessions` | signed-in browser | `id_hash`, `user_id`, `expires_at` | 30 days |
| `oauth_states` | "Connect" click in progress | `state`, `code_verifier` (PKCE) | 10 min |
| `connections` | connected music app | (`user_id`, `platform`), `enc_tokens` + `iv` (AES-256-GCM), `account_name` | Until disconnected |
| `transfer_jobs` | transfer | `id`, `source`, `dest`, `selections` (JSON), `status`, `message`, `sync_id` | Until account deleted |
| `transfer_selections` | playlist (or Liked Songs) in a transfer | (`job_id`, `sel_index`), `kind`, `source_id`, `target_playlist_id`, `dest_playlist_id`, `read_done`, `write_done` | With its transfer |
| `transfer_items` | song in a transfer | `job_id`, `sel_index`, `position`, `src_*`, `src_key`, `dest_*`, `confidence`, `method`, `status`, `written` | **30 days**, then deleted |
| `syncs` | "keep this playlist copied" | `id`, `user_id`, `source`, `dest`, `source_id`, `dest_playlist_id`, `status`, `next_run_at`, `last_*` | Until deleted |
| `sync_seen` | song a sync already handled | (`sync_id`, `key`) | With its sync |
| `billing_events` | Stripe event handled | `id`, `type` | Kept (tiny) |
| `match_cache` | (song, destination) | `key` (`isrc:…` or `txt:title|artist`), `dest`, `dest_id` | 90 days |
| `api_quota` | (service, day) | `units` | 7 days |
| `audit_log` | security event | `user_id`, `action`, `ip`, `at` | IP removed after 30 days; row after 1 year |

## Relationships
```
users 1─* sessions
users 1─* oauth_states
users 1─* connections
users 1─* transfer_jobs 1─* transfer_items
                 transfer_jobs 1─* transfer_selections
users 1─* syncs 1─* sync_seen
syncs 1─* transfer_jobs   (sync_id: one job per daily run)
```
All child tables use `ON DELETE CASCADE`; "Delete my account" also deletes them explicitly.

## Status values
- `transfer_jobs.status`: `QUEUED` → `RUNNING` ⇄ `WAITING` → `DONE` | `FAILED` | `CANCELLED` (Stop). *Try again* puts a finished job back to `QUEUED`.
- `transfer_items.status`: `PENDING` → `MATCHED` | `LOW_CONFIDENCE` | `FAILED`; the user can turn the last two into `MATCHED` (Fix) or `SKIPPED` (Skip)
- `transfer_items.method`: `isrc` (1.0), `exact` (0.97), `fuzzy_jaro_winkler` (score), `cache`, `manual` (picked by the user — never shared via `match_cache`), `none`
- `transfer_items.written`: `0` not yet, `1` added, `2` already there (duplicate skipped on purpose)
- `syncs.status`: `ACTIVE` ⇄ `PAUSED`; `NEEDS_USER` after an access problem or a removed playlist (reconnecting sets it back to `ACTIVE`)
- `users.plan`: `free` | `premium` (Premium counts only while `plan_until` is in the future)

## Auth model
- Session cookie `mm_session`: `HttpOnly; Secure; SameSite=Lax`, random 256-bit id, only its hash stored.
- Every changing API call needs header `X-Requested-With: mixnmatch` and a same-site `Origin`.
- Every query that reads a job or connection includes `user_id = <signed-in user>`.

## API
| Method & path | Does |
|---|---|
| `POST /api/auth/request` | Email a sign-in link (5 per hour per email/IP) |
| `POST /api/auth/verify` | Use the link → session cookie |
| `POST /api/auth/logout` | End session |
| `GET /api/platforms` | Which services are switched on |
| `GET /api/me` · `DELETE /api/me` | Profile + connections · delete everything |
| `GET /api/connect/:p` · `GET /api/callback/:p` | OAuth start / finish |
| `DELETE /api/connections/:p` | Disconnect |
| `GET /api/library/:p/playlists` · `/playlists/:id/tracks` · `/liked` | Browse (one page per call, `?cursor=`) |
| `POST /api/jobs` · `GET /api/jobs` · `GET /api/jobs/:id` · `GET /api/jobs/:id/items` | Transfers (`selections[].targetPlaylistId` = add to an existing playlist; items `?status=` or `?filter=already`) |
| `POST /api/jobs/:id/cancel` · `POST /api/jobs/:id/retry` `{includeUnsure}` | Stop · Try again |
| `GET /api/jobs/:id/items/:itemId/search?q=` · `POST …/fix` `{destId,destTitle,destArtist}` · `POST …/skip` | Fix-it screen (search: 30/min per user) |
| `GET /api/syncs` · `POST /api/syncs` `{jobId,selIndex}` · `PATCH /api/syncs/:id` `{status}` · `DELETE /api/syncs/:id` | Auto-Sync |
| `POST /api/billing/checkout` `{plan}` · `POST /api/billing/portal` | Premium: Stripe Checkout / Customer Portal links |
| `POST /api/billing/webhook` | Stripe → us. No cookie or CSRF header; checked by `Stripe-Signature` (HMAC-SHA256, 5 min window) |
