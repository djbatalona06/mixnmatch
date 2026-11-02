# MPES 7 — Implementation roadmap

> **In plain words**
> This is the to-do list, in the order to do it. The first two items keep strangers out of people's accounts and keep test changes away from the real database, so they come first.
> Then come the "spot problems early" items (alerts, safer database updates), then the features that make mix n match as good as the best apps (sync schedule, paste a list, albums).
> Each item says when it counts as done, so nobody has to guess.

**Order:** Phase A (safety) → Phase B (foundations) → Phase C (catch up with the best) → Phase D (platform, only when product two exists).
Size: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks. **Who:** Build = code change in this repo · Owner = needs the owner's accounts or decision.

## Phase A — Safety (before more real users)

| # | Task | Rule / finding | Size | Who | Done when |
|---|---|---|---|---|---|
| R-01 | **Lock test switches out of production.** In `loadEnv()`, when `VERCEL_ENV === "production"`, ignore `DEV_MODE` and `ENABLE_MOCK` and log one warning. **Owner first:** check Vercel → Settings → Environment Variables that `DEV_MODE` is not `1` on Production, and set up Resend so sign-in emails work without it | SEC-07, AUD-01 | S | Owner + Build | A test sets `VERCEL_ENV=production, DEV_MODE=1` and gets no `devLink`; `smoke:deploy` shows no "Demo Music" warning |
| R-02 | **Keep previews away from production data.** Either (a) give Preview its own Turso database (Turso branch) in Vercel env settings, or (b) make `scripts/migrate.mjs` skip when `VERCEL_ENV !== "production"` and no `PREVIEW_DB=1` | REL-05, AUD-02 | S | Owner (a) or Build (b) | A PR with a new migration deploys a preview; production's `schema_migrations` is unchanged |
| R-03 | **Never reuse the old test key** that was in `.dev.vars`; make a fresh `TOKEN_KEY` for every environment | AUD-03 | S | Owner | Production `TOKEN_KEY` differs from any value ever committed |
| R-04 | ✅ Untrack `.dev.vars` and `.wrangler/`; add an automatic check | SEC-06 | S | Build | **Done in this change** (`test/mpes.test.ts`) |

## Phase B — Foundations (this quarter)

| # | Task | Rule / finding | Size | Done when |
|---|---|---|---|---|
| R-05 | Add `APP_ORIGIN`; use it for sign-in links, OAuth redirects and Stripe returns; refuse to start in production without it | SEC-11, AUD-04 | S | Test: request with `Host: evil.test` still produces links to `APP_ORIGIN` |
| R-06 | Make migrations all-or-nothing (run each file + its `schema_migrations` row in one `batch`/transaction); run `PRAGMA foreign_keys = ON` on every connection; add `job_runs` to account deletion | REL-03, DATA-06, AUD-05, AUD-06 | S | A broken migration leaves the schema unchanged; deletion test checks `job_runs` |
| R-07 | Alerts: a Vercel log drain (or Sentry) for 5xx and `console.error`; cron "heartbeat" row checked by the smoke workflow on a schedule; webhook failure alert | OPS-02, AUD-07 | M | Stopping the cron for 15 min sends an alert |
| R-08 | Return 404 "That music service is not set up yet" for unconfigured services; add tests for OAuth `state` expiry and wrong-user `state` | API-03, SEC-02, AUD-08 | S | `GET /api/connect/<unconfigured>` → 404 JSON; two new state tests pass |
| R-09 | `TOKEN_KEY` rotation: `key_id` column, `TOKEN_KEY_PREVIOUS`, re-encrypt on read, migration `NNNN_token_key_id.sql` | ENC-03, AUD-09 | M | Rotating the key keeps every connection working; test covers old → new |
| R-10 | Body limits: count bytes, stop reading past the limit, cap Premium at 4 MB (below Vercel's 4.5 MB) | SEC-14, AUD-11 | S | Test: 4.1 MB multi-byte body → our 413 message |
| R-11 | Accessibility check: run axe-core inside `test/layout.mjs` for every screen state; add `layout:check` to CI | A11Y-02/04/07, TEST-07, AUD-14 | M | CI fails on any serious/critical axe issue |
| R-12 | ESLint (typescript + react-hooks + jsx-a11y) and Prettier with the current style; `npm run lint` in CI | AUD-15 | S | `npm run lint` passes on `main` |
| R-13 | Release checklist and rollback steps in `docs/mpes/06` used in every release PR | OPS-04 | S | Next release PR contains the ticked checklist |

## Phase C — Catch up with the best (product)

Already specified in [../11-spec-v1.3.md](../11-spec-v1.3.md); MPES adds the rules each must meet.

| # | Task | Benchmark | Size | Done when |
|---|---|---|---|---|
| R-14 | **Confirm competitor research** (Soundiiz, TuneMyMusic real pricing URL, SongShift) with dates | DOC-04, B-* | S | Every row in [03](03-competitive-analysis.md) is ✅ with link + date |
| R-15 | **Sync schedule** (daily / weekly / monthly, chosen hour, user's time zone) — v1.3 F-1 | B-06 | M | v1.3 spec R-1…R-3 pass; layout + a11y checks pass with the dialog open |
| R-16 | **Paste a list of songs** — v1.3 F-2 | B-07 | S | v1.3 spec R-4, R-5 pass |
| R-17 | **Saved albums** for Spotify, TIDAL, Deezer — v1.3.1 F-3 | B-08 | L | v1.3 spec R-6 passes; each album call verified once with a real account |
| R-18 | Followed artists (reuse album screens) | B-08 | M | Same as R-17 for artists |
| R-19 | Apple Music adapter (needs Apple Developer Program) | B-09 | L | Owner decision; adapter tests + real-account verification |
| R-20 | Public status page fed by R-07 | B-14 | S | Status page shows cron + API health |

## Phase D — Platform (only when product two is approved)

| # | Task | Rule | Done when |
|---|---|---|---|
| R-21 | Turn the repo into npm workspaces: `apps/mixnmatch` + first packages (`authentication`, `api-client`, `design-system`) as in [04](04-shared-architecture.md) §4.4 | ARC-01 | mix n match builds and all tests pass from the workspace root; no behaviour change |
| R-22 | Move `test/mpes.test.ts` into `standards/` and run it for every app | TEST-04 | Product two's CI runs the same MPES checks |
| R-23 | Product two starts from the six planning docs and the 6.1 checklist | DOC-03 | Its PRD–Implementation Plan exist before code |

## Tracking

Each row becomes one pull request (or one issue first). The PR title starts with the roadmap number, e.g. `R-05: use a configured site address for links`. When a row is done, change its status here in the same PR (`DOC-02`).
