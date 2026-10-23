# 06 — Implementation Plan

## Phase 1 — Foundation ✅ (this pull request)
1. ✅ Planning docs 01–07
2. ✅ Worker + static site + D1 migration + Durable Object + cron (`wrangler.jsonc`)
3. ✅ Magic-link sign-in, hashed sessions, CSRF guard, rate limit
4. ✅ Adapter contract + Spotify, TIDAL, Deezer, YouTube, Demo adapters
5. ✅ Matching engine (ISRC → exact → Jaro-Winkler) + shared cache
6. ✅ Transfer engine in small steps; pause on 429 / quota; never double-adds
7. ✅ Pages: landing, login, dashboard, 4-step wizard, live results, export, privacy, terms
8. ✅ JSPF / CSV / TXT export and import
9. ✅ Disconnect, delete account, daily privacy clean-up
10. ✅ Tests: 63 unit tests + browser smoke test (1,060-song demo transfer)

## Phase 2 — Go live (needs the owner's accounts)
| # | Task | Who |
|---|---|---|
| 2.1 | `npx wrangler d1 create mixnmatch`, paste id into `wrangler.jsonc` | Owner or Claude with a Cloudflare API token |
| 2.2 | `npx wrangler secret put TOKEN_KEY` (32 random bytes, base64) | Owner |
| 2.3 | `npm run deploy` | Either |
| 2.4 | Spotify developer app → redirect `https://<site>/api/callback/spotify`; add your account to the 5 allowed users | Owner |
| 2.5 | TIDAL, Google Cloud (YouTube Data API v3), Deezer developer apps, same redirect pattern | Owner |
| 2.6 | **Verify each adapter with a real account** (paths were built from docs) and fix any differences | Claude |
| 2.7 | Buy/attach a domain, verify it in Resend, set `RESEND_API_KEY` + `EMAIL_FROM`, set `DEV_MODE=0` | Owner |
| 2.8 | Have a lawyer review privacy + terms; add a contact email | Owner |

## Phase 3 — Better results (v1.1) ✅ built → spec: [08-spec-v1.1.md](08-spec-v1.1.md)
| # | Task | Spec section | Status |
|---|---|---|---|
| 3.1 | Groundwork: `transfer_selections` table (migration `0002_v1_1.sql`), new values `SKIPPED` / `manual` / `CANCELLED` / `written = 2` | Shared groundwork | ✅ |
| 3.2 | Cancel + Retry (no second playlist, no re-reading songs) | Feature 3 | ✅ |
| 3.3 | Add to an existing playlist + skip duplicates | Feature 2 | ✅ |
| 3.4 | In-app Fix-it screen for *Need a look* / *Not found* songs — FR-07 | Feature 1 | ✅ |
| 3.5 | Per-user country code for TIDAL (currently `US`) | — (small, not in spec) | ⏭ later |
| 3.6 | Spotify extended-quota application; Google YouTube quota increase request | — | Owner |

## Phase 4 — Grow (v1.2) ✅ built → spec: [09-spec-v1.2.md](09-spec-v1.2.md)
| # | Task | Spec section | Status |
|---|---|---|---|
| 4.1 | Auto-Sync: one-way, add-only, once a day (hourly cron + `syncs` / `sync_seen`) — FR-06 | Feature 4 | ✅ |
| 4.2 | Premium plan (Stripe Checkout + Customer Portal + signed webhook) | Feature 6 | ✅ code · Owner: Stripe account, prices, webhook, lawyer review |
| 4.3 | SoundCloud adapter (or file-only if SoundCloud won't approve a new app) | Feature 5 | ✅ code · Owner: SoundCloud app · Claude: verify with a real account |

Checks for Phase 3 + 4: 95 unit tests, and the browser smoke test now also clicks Fix, Skip, Try again, Keep in sync, Add to an existing playlist and Stop.

## Later
- Two-way sync and mirroring removals
- Apple Music (needs Apple Developer Program, $99/yr)
