# MPES 1 — Codebase audit

> **In plain words**
> We read every part of mix n match: the app you tap, the server, the database, the tests and the deploy setup.
> It is in good shape: 115 tests pass, the code type-checks, the app builds, and the parts that ship to users have **0 known security holes**.
> We found **one setting that could let anyone sign in as anyone** if it is left on in the live site, **one build step that could change the live database from an unfinished pull request**, some old Cloudflare files and a test key saved in git (removed in this change), and docs that still describe the old Cloudflare setup.

**Audited:** `main` at `0e734e5` · 2 Nov 2026 · Everything below was read in the code or run in this session. Nothing is assumed.

---

## 1.1 What the code actually is

| Area | What exists (✅) | Where |
|---|---|---|
| **App (front end)** | React 18 + Vite 7 + TypeScript + Tailwind CSS 3, installable PWA (`vite-plugin-pwa`, Workbox `generateSW`), React Router 7, Zustand 5, Lucide icons, Geist font bundled locally | `app/`, `app/vite.config.ts` |
| **Screens** | Landing, Login, Dashboard, Transfer (4-step wizard), Results (live progress + Fix/Skip/Try again), Syncs, Account, Export, Privacy, Terms, Not found | `app/src/App.tsx`, `app/src/pages/*.tsx` |
| **State** | 3 small Zustand stores: `session`, `toast`, `install`. Server data is fetched per screen through one client | `app/src/store/`, `app/src/lib/api.ts` |
| **Server** | One Vercel Node function. Hand-written router over the standard `Request`/`Response` API | `api/[...path].ts` → `src/index.ts` |
| **API** | 27 routes: auth (magic link), platforms, me, connect/callback (OAuth + PKCE), library browse, jobs (create/list/get/items/cancel/retry), fix-it (search/fix/skip), syncs (CRUD), billing (checkout/portal/webhook), cron tick | `src/index.ts:31-170` |
| **Music adapters** | One contract (`PlatformAdapter`), six implementations: Spotify, TIDAL, Deezer, YouTube, SoundCloud, Demo (mock) | `src/adapters/types.ts`, `src/adapters/*.ts` |
| **Matching** | Three tiers: ISRC → exact normalised title + main artist → Jaro-Winkler fuzzy (threshold 0.85); shared `match_cache` | `src/matcher/` |
| **Background work** | Cron every minute → `runDueJobs` steps transfers inside a 150 s budget, with a lease (10 min) so overlapping crons never step the same job; Auto-Sync daily; clean-up 03:17 UTC | `src/jobs/runner.ts`, `src/jobs/engine.ts`, `src/index.ts:274` |
| **Database** | Turso / libSQL (SQLite). 16 tables, 4 forward-only SQL migrations, applied by `scripts/migrate.mjs` during every build | `migrations/`, `src/db.ts` |
| **Auth** | Passwordless magic links (Resend). Tokens and session ids stored only as SHA-256 hashes. 30-day `HttpOnly; Secure; SameSite=Lax` cookie | `src/auth/` |
| **Secrets at rest** | Music-service tokens encrypted with AES-256-GCM; the ciphertext is bound to `user:platform` (additional data) | `src/crypto.ts`, `src/connections.ts` |
| **Payments** | Stripe Checkout + Customer Portal by plain `fetch`; webhook HMAC check (constant-time, 5-min window), idempotent via `billing_events` | `src/routes/billing.ts` |
| **Plans** | Free vs Premium limits in one table | `src/plans.ts` |
| **Analytics** | Vercel Web Analytics + Speed Insights, cookie-free, sign-in page excluded | `app/src/components/chrome.tsx:87-93` |
| **Hosting** | Vercel: static `dist/`, one function (max 300 s), minute cron (needs Pro), strict CSP + security headers, immutable asset caching | `vercel.json` |
| **CI** | GitHub Actions: `typecheck` → `test` → `build:app` on every PR; live smoke test after every successful Vercel deploy | `.github/workflows/` |
| **Tests** | 115 Vitest tests in 13 files (adapters, matcher, engine, cancel/retry, fix, sync, billing, security, cron, deploy config, formats); Playwright smoke test; layout check (every screen × 3 widths) | `test/` |

### Dependencies (from `package.json`)

| Runtime (ships to users) | Dev only |
|---|---|
| react 18.3, react-dom, react-router-dom 7.18, zustand 5, lucide-react, @fontsource-variable/geist, @libsql/client 0.18, @vercel/analytics 2, @vercel/speed-insights 2 | typescript 5.9, vite 7.3, vitest 3.2, vite-plugin-pwa 2, tailwindcss 3.4, postcss, autoprefixer, playwright-core 1.64, vercel CLI 65 |

**9 runtime dependencies.** No server framework, no ORM, no SDKs for Stripe or the music services. This is a deliberate, low-attack-surface choice and is kept as a standard (see `DEP-01`).

### Measured in this session

| Check | Result |
|---|---|
| `npm run typecheck` (server + app) | ✅ passes |
| `npm test` | ✅ 115 / 115 pass (2.9 s) |
| `npm run build:app` | ✅ JS 261.7 kB (84.9 kB gzip), CSS 29.1 kB (6.6 kB gzip), PWA precache 17 files / 372.6 KiB |
| `npm audit --omit=dev` | ✅ **0** vulnerabilities in shipped code |
| `npm audit` (incl. dev tools) | ⚠ 50 (3 low, 19 moderate, 25 high, 3 critical), all in dev tooling (mostly the `vercel` CLI chain). Never shipped to users |

---

## 1.2 Strengths to keep (these become standards)

1. **Universal adapter contract** — the engine never knows which service it talks to (`src/adapters/types.ts`). New services are one file. → `ARC-02`
2. **Small, resumable steps** — every transfer is a state machine saved in `job_runs`; a crash loses at most one step. 429 / `Retry-After` and quota pauses are first-class. → `ARC-04`, `REL-01`
3. **Security basics done right** — PKCE everywhere, hashed tokens, encrypted tokens bound to their row, CSRF guard (`X-Requested-With` + `Origin`), strict CSP with no inline scripts, every query scoped to the signed-in user, 404-not-403 on other users' data.
4. **Privacy by default** — 30-day deletion of song lists and IPs, full account deletion that cancels Stripe first, analytics without cookies.
5. **Tests that check deploy config** — `test/deploy-config.test.ts` fails CI before a broken `vercel.json` goes live. This idea is extended by `test/mpes.test.ts`.
6. **Plain-language docs** — every spec starts with an "In plain words" box. → `DOC-01`

---

## 1.3 Findings

Severity: **P0** fix before real users · **P1** fix before the next release · **P2** fix this quarter · **P3** nice to have.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| **AUD-01** | **P0** | **`DEV_MODE=1` in production would let anyone sign in as anyone.** With it on, `POST /api/auth/request` returns the sign-in link to whoever asked, for any email. Nothing stops it being on in production; only the README says to turn it off. This session could not reach the live site to check (network blocked) | `src/auth/magic-link.ts:43-45` | 📝 Roadmap R-01. A warning was added to the live smoke test (Demo Music listed = test settings are on) |
| **AUD-02** | **P1** | **Preview builds may change the live database.** `npm run build` runs `scripts/migrate.mjs` on every Vercel build, including pull-request previews. If the Turso variables are shared with the Preview environment, an unmerged migration is applied to production | `package.json` `build`, `scripts/migrate.mjs` | 📝 Roadmap R-02 |
| **AUD-03** | **P1** | **A test encryption key and old Cloudflare files were saved in git.** `.dev.vars` (with a 32-byte `TOKEN_KEY`) and 30 `.wrangler/state` SQLite files were tracked. The project moved to Vercel, so nothing uses them | `git ls-files` | ✅ **Fixed in this change**: untracked and added to `.gitignore`. The key is still in git history, so it must never be used for a real environment |
| **AUD-04** | P2 | **Site address comes from the `Host` header.** Sign-in links, OAuth `redirect_uri` and Stripe return URLs use `url.origin`, which is built from `req.headers.host`. Vercel routes by host, so this is hard to abuse today, but a proxy or custom domain mistake would put attacker addresses into sign-in emails | `api/[...path].ts:21`, `src/index.ts:45,96,167,168,188` | 📝 R-05 |
| **AUD-05** | P2 | **Migrations are not all-or-nothing.** A migration that fails halfway leaves some tables changed, and the next build re-runs the file and fails on "duplicate column" | `scripts/migrate.mjs:21-22` | 📝 R-06 |
| **AUD-06** | P2 | **Tests and production differ on foreign keys.** The test database turns foreign-key rules on; the production client never does, so `ON DELETE CASCADE` may not run in production (account deletion deletes rows by hand, so no data is left today, but `job_runs` is not in that list) | `test/d1-shim.ts:39`, `src/db.ts`, `src/index.ts:204-216` | 📝 R-06 |
| **AUD-07** | P2 | **No error alerts.** Failures go to `console.error` only. A cron that stops working, or Stripe webhooks that fail, would go unnoticed | `src/index.ts:226`, `src/jobs/runner.ts:139` | 📝 R-07 |
| **AUD-08** | P2 | **An unconfigured service gives a 500.** `getAdapter` throws a plain `Error`, which becomes "Something went wrong on our side" | `src/adapters/registry.ts:61` | 📝 R-08 |
| **AUD-09** | P2 | **No way to change the encryption key** (`TOKEN_KEY` rotation), already an open item | `docs/07-legal-security.md` | 📝 R-09 |
| **AUD-10** | P2 | **Docs still describe Cloudflare.** PRD says "runs on Cloudflare's free plan"; TRD's architecture and limits tables describe Workers, D1 and Durable Objects; plan Phase 2 lists `wrangler` steps; security doc points to `app/public/_headers`; PROJECT-CONTEXT says "not deployed" while the README lists a live URL; spec v1.3 says the free file limit is 500 (code: 5,000); TuneMyMusic's `/pricing` link returns 404 | `docs/01`, `02`, `06`, `07`, `11`, `PROJECT-CONTEXT.md` | ✅ **Fixed in this change** (text only) |
| **AUD-11** | P3 | **Premium upload limit is above Vercel's limit.** `LIMITS.premium.bodyBytes` is 8 MB; Vercel functions accept at most 4.5 MB request bodies, so big uploads get Vercel's error, not ours. The size check also counts characters, not bytes | `src/plans.ts:6`, `src/web.ts:32` | 📝 R-10 |
| **AUD-12** | P3 | **Known shortcuts, already documented in code** (`ponytail:` comments): Stripe event order trusted; Premium lapse checked only on start; TIDAL country fixed to US; SoundCloud rewrites whole playlists | `src/routes/billing.ts:125`, `src/plans.ts:9`, `src/adapters/tidal.ts:9`, `src/adapters/soundcloud.ts:63` | Tracked, acceptable for now |
| **AUD-13** | P3 | **One JavaScript file for every screen** (85 kB gzip). Fine today; no split per screen | build output | Budget set in `PERF-01` |
| **AUD-14** | P3 | **No automatic accessibility test.** The layout check measures sizes and overflow, not labels, roles or contrast | `test/layout.mjs` | 📝 R-11 |
| **AUD-15** | P3 | **No linter or formatter** (ESLint / Prettier). Style is consistent by hand | `package.json` | 📝 R-12 |
| **AUD-16** | P3 | **Dev tool vulnerabilities** (50, mostly the `vercel` CLI). Not shipped | `npm audit` | Watch; `DEP-03` |

### Outside limits (not code bugs, but they shape every product decision)

- **Spotify Development Mode:** 5 users until Spotify grants extended quota (`docs/01-prd.md`).
- **YouTube:** 10,000 units a day for the whole app ≈ 60 songs a day moved into YouTube for everyone together.
- **Vercel Cron every minute needs the Pro plan.**
- **Deezer:** new developer apps not confirmed.
