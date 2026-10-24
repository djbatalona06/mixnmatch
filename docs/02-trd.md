# 02 — Technical Requirements (TRD)

## Stack (decided)
| Layer | Choice | Why |
|---|---|---|
| Hosting | **Cloudflare Workers** (free plan), `*.workers.dev` URL | One place for site, API, database and background jobs; free |
| App | **React 18 + Vite + TypeScript + Tailwind CSS**, installable (PWA via `vite-plugin-pwa`), built into `dist/` and served by the same Worker. See [10-spec-app.md](10-spec-app.md) | One app on the phone home screen; opens offline; same URL and sign-in as the API |
| API | TypeScript in one Worker (`src/index.ts`) | Type safety, runs at the edge |
| Database | **Cloudflare D1** (SQLite) | Free 5 GB, plain SQL |
| Background jobs | **Durable Object** `TransferJob` with alarms | One small step at a time, survives restarts, free |
| Scheduled jobs | **Cron Triggers**: daily 03:17 UTC clean-up; hourly `7 * * * *` Auto-Sync check (2 of the 5 free crons) | Privacy retention rules; daily syncs |
| Payments (v1.2) | **Stripe** Checkout + Customer Portal, called with plain `fetch`; webhook checked with Web Crypto HMAC | No card data on our side; no SDK or build step |
| Sign-in | Email magic links via **Resend** | No passwords |
| Tests | Vitest (unit, using Node's built-in SQLite as a D1 stand-in) + Playwright smoke test against `wrangler dev` (also checks install, service worker and offline) |

## Why not the original architecture?
The original plan named microservices, RabbitMQ/SQS, PostgreSQL, Redis and Auth0. For one developer on a free plan, that is many moving parts and bills. Each piece maps to a Cloudflare feature:

| Original | mix n match |
|---|---|
| API Gateway + services | One Worker with route functions |
| RabbitMQ / SQS | Durable Object alarms |
| PostgreSQL | D1 |
| Redis cache | `match_cache` table in D1 |
| Auth0 / Cognito | Magic links + hashed sessions |
| KMS | Worker secret `TOKEN_KEY` (AES-256-GCM) |

## Free-plan limits we design around
| Limit (per run) | Free plan | How we stay under it |
|---|---|---|
| CPU time | 10 ms | Small steps; network waiting does not count |
| Outside requests | 50 | ≤ 20 per step (10 songs × ISRC + text search) |
| D1 queries | 50 | Bulk SQL with `json_each`; tests assert < 15 per step |
| D1 writes | 100,000 rows/day | ~2 writes per song |

## Music service APIs
| Service | Login | Notes |
|---|---|---|
| Spotify | OAuth + PKCE (no secret) | 2026 endpoints: `/playlists/{id}/items`, `POST /me/playlists`, `PUT /me/library`; search `limit` max 10; ISRC search `q=isrc:…` |
| TIDAL | OAuth + PKCE | JSON:API at `openapi.tidal.com/v2`; 2026 paths `/userCollectionTracks/me/…`, `/userCollectionPlaylists/me/…`; `filter[isrc]` on `/tracks` |
| Deezer | Classic OAuth (`offline_access` → no expiry) | Errors come back as HTTP 200 with an `error` object; 50 calls / 5 s |
| YouTube | Google OAuth + PKCE | Data API v3; quota tracked in `api_quota`, budget 9,000/day; no ISRC → text matching, prefers "– Topic" channels |
| SoundCloud (v1.2) | OAuth 2.1 + PKCE **and** client secret | `Authorization: OAuth <token>`; paging via `linked_partitioning` → `next_href`; no ISRC search; adding = read playlist → append → `PUT /playlists/:id`; one like per call. New app sign-ups may need SoundCloud's approval |
| Demo Music | Fake, only when `ENABLE_MOCK=1` | For testing without real accounts |

All four real adapters were written from documentation and tested with fake replies. **Each must be checked once with a real developer account** before launch (marked "verify" in the implementation plan).

## Secrets (set with `npx wrangler secret put NAME`)
`TOKEN_KEY` (required), `RESEND_API_KEY`, `SPOTIFY_CLIENT_ID`, `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`, `DEEZER_APP_ID`, `DEEZER_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`. A service only appears as "connectable" once its secrets exist.

Premium (optional): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. Premium is hidden until the first three exist.
