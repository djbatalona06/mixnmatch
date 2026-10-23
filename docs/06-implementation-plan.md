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

## Phase 3 — Better results
- In-app "fix it" screen for *Need a look* songs (search the destination, pick the right one) — FR-07
- Per-user country code for TIDAL (currently `US`)
- Spotify extended-quota application; Google YouTube quota increase request

## Phase 4 — Grow
- Recurring Sync (Cron Trigger + diff of playlists) — FR-06
- Premium plan (Stripe) — likely needs Workers Paid ($5/mo) for higher limits
- Apple Music (needs Apple Developer Program, $99/yr)
