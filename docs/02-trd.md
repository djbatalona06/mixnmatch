# 02 — Technical Requirements (TRD)

## Stack (decided)
| Layer | Choice | Why |
|---|---|---|
| Hosting | **Vercel**: the built app (`dist/`), one `/api` function (`api/[...path].ts`), a cron, and Web Analytics + Speed Insights | One place for site, API and background jobs; cookie-free analytics |
| App | **React 18 + Vite + TypeScript + Tailwind CSS**, installable (PWA via `vite-plugin-pwa`), built into `dist/` and served by Vercel (every page path loads the app). See [10-spec-app.md](10-spec-app.md) | One app on the phone home screen; opens offline; same URL and sign-in as the API |
| API | TypeScript in one Vercel function (`api/[...path].ts` → `src/index.ts`) | Type safety; one place for every `/api/*` route |
| Database | **Turso** (libSQL, which is SQLite), from the Vercel Marketplace. Same SQL as before | Free tier; the SQL and the tests did not change |
| Background jobs | **Job runner** (`src/jobs/runner.ts`): one `job_runs` row per running transfer, stepped by the cron | One small step at a time, survives restarts |
| Scheduled jobs | **Vercel Cron** every minute, calling `/api/cron/tick`: runs due transfer steps and Auto-Syncs, and the 03:17 UTC clean-up | Transfers resume quickly. Needs Pro (Hobby crons run once a day) |
| Payments (v1.2) | **Stripe** Checkout + Customer Portal, called with plain `fetch`; webhook checked with Web Crypto HMAC | No card data on our side; no SDK or build step |
| Sign-in | Email magic links via **Resend** | No passwords |
| Tests | Vitest (unit, using Node's built-in SQLite as a database stand-in), deploy checks, a Playwright smoke test against `vercel dev` (also checks install, service worker and offline) | Catches breakage before deploy |

## Why not the original architecture?
The original plan named microservices, RabbitMQ/SQS, PostgreSQL, Redis and Auth0. For one developer on a free plan, that is many moving parts and bills. Each piece maps to a Vercel or Turso feature:

| Original | mix n match |
|---|---|
| API Gateway + services | One Vercel function with route functions (`api/[...path].ts` → `src/index.ts`) |
| RabbitMQ / SQS | `job_runs` table + Vercel Cron every minute (`src/jobs/runner.ts`) |
| PostgreSQL | Turso (libSQL / SQLite) |
| Redis cache | `match_cache` table in Turso |
| Auth0 / Cognito | Magic links + hashed sessions |
| KMS | Vercel environment secret `TOKEN_KEY` (AES-256-GCM) |

## Hosting limits we design around
| Limit | Value | How we stay under it |
|---|---|---|
| Function run time | 300 s (`vercel.json`) | Each cron call runs steps for at most 150 s (`CRON_BUDGET_MS`) |
| Cron frequency | Every minute on Vercel Pro (once a day on Hobby) | Transfers need Pro; see README "Limits" |
| Request body | 4.5 MB per request on Vercel | File uploads are capped by `LIMITS.*.bodyBytes` (Premium cap to be lowered below 4.5 MB, MPES roadmap R-10) |
| Database queries per step | Kept small | Bulk SQL with `json_each`; tests assert < 15 per step |

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

## Secrets (set in Vercel: Settings → Environment Variables)
`TOKEN_KEY` (required), `RESEND_API_KEY`, `SPOTIFY_CLIENT_ID`, `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`, `DEEZER_APP_ID`, `DEEZER_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`. A service only appears as "connectable" once its secrets exist.

Premium (optional): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. Premium is hidden until the first three exist.
