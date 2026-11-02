## 📦 PROJECT CONTEXT — mix n match
**What:** one installable app to move playlists and liked songs between music apps (Spotify, TIDAL, Deezer, YouTube Music, SoundCloud, files) and keep them in sync daily.
**Stack:** Vite 7 + React 18 + TypeScript + Tailwind CSS v3 + vite-plugin-pwa + Zustand + React Router v7 + Lucide (app in `app/`)
**Backend:** one Vercel function (`api/[...path].ts` → `src/`) + Turso/libSQL (tables: users, sessions, magic_links, oauth_states, connections, transfer_jobs, transfer_selections, transfer_items, match_cache, syncs, sync_seen, billing_events, audit_log, api_quota, job_runs) + cron job runner (`src/jobs/runner.ts`, every minute). Not Supabase.
**Deploy:** Vercel. Build = DB migrations + app build. Vercel serves `dist/` (rewrite to index.html) and `/api/*`. Minute cron needs Vercel Pro. Live URL: https://mixnmatch-gilt.vercel.app (per README; go-live checks in docs/06 Phase 2 and docs/mpes/07 Phase A).
**Design:** dark luxury (bg #0b0a09, surface #141311, accent amber #e3a047, font Geist bundled; colours are CSS variables in app/src/index.css)
**Current phase:** Phase 5 (installable app) ✅ built. Phases 3–4 (v1.1, v1.2) ✅. Phase 2 (go live) waits on the owner's accounts.
**Key files:** app/src/App.tsx (routes), app/src/pages/*.tsx (one per screen), app/src/components/{chrome,ui,InstallCard}.tsx, app/src/store/{session,toast,install}.ts, app/src/lib/{api,formats,types}.ts, app/vite.config.ts (PWA + dev proxy), vercel.json
**PWA status:** Manifest ✅ | Service Worker ✅ (never handles /api/*) | Icons ✅ (scripts/make-icons.mjs) | HTTPS ✅ (Vercel) | Opens offline ✅
**Checks:** `npm test` (unit + deploy + MPES checks), `npm run typecheck` (server + app), `npm run smoke` (browser, against `npm run dev`), `npm run layout:check` (every screen × 3 widths, no server; plan in docs/layout-board.html)
**Dev:** `npm run dev` (builds app, then `vercel dev` on port 8787) · `npm run dev:app` (port 5173, instant reload, proxies /api to 8787)
**Open issues:** dev-only tools (vitest, vercel CLI) have npm audit warnings, same as main; the shipped app reports 0. SoundCloud/Stripe need the owner's accounts.
**Standard:** MPES (MixNMatch Product Engineering Standard) in docs/mpes/: audit, rules (SEC/A11Y/PERF/TEST…), launch checklist, roadmap. Machine-checkable rules run in `test/mpes.test.ts`.
**Next task:** MPES roadmap Phase A (R-01 lock DEV_MODE out of production, R-02 keep previews off the production database), then verify each music adapter with a real account.
