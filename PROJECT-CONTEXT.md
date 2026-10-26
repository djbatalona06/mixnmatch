## 📦 PROJECT CONTEXT — mix n match
**What:** one installable app to move playlists and liked songs between music apps (Spotify, TIDAL, Deezer, YouTube Music, SoundCloud, files) and keep them in sync daily.
**Stack:** Vite 7 + React 18 + TypeScript + Tailwind CSS v3 + vite-plugin-pwa + Zustand + React Router v7 + Lucide (app in `app/`)
**Backend:** Cloudflare Worker (`src/`) + D1 (tables: users, sessions, magic_links, oauth_states, connections, transfer_jobs, transfer_selections, transfer_items, match_cache, syncs, sync_seen, billing_events, audit_log, api_quota) + Durable Object `TransferJob`. Not Supabase.
**Deploy:** Cloudflare Workers. `npm run deploy` = D1 migrations + build app + deploy. Same Worker serves `dist/` (SPA fallback) and `/api/*`. Live URL: not deployed yet (owner: Phase 2 in docs/06).
**Design:** dark luxury (bg #0b0a09, surface #141311, accent amber #e3a047, font Geist bundled; colours are CSS variables in app/src/index.css)
**Current phase:** Phase 5 (installable app) ✅ built. Phases 3–4 (v1.1, v1.2) ✅. Phase 2 (go live) waits on the owner's accounts.
**Key files:** app/src/App.tsx (routes), app/src/pages/*.tsx (one per screen), app/src/components/{chrome,ui,InstallCard}.tsx, app/src/store/{session,toast,install}.ts, app/src/lib/{api,formats,types}.ts, app/vite.config.ts (PWA + dev proxy), wrangler.jsonc
**PWA status:** Manifest ✅ | Service Worker ✅ (never handles /api/*) | Icons ✅ (scripts/make-icons.mjs) | HTTPS ✅ (Cloudflare) | Opens offline ✅
**Checks:** `npm test` (96 unit), `npm run typecheck` (server + app), `npm run smoke` (browser, against `npm run dev`)
**Dev:** `npm run dev` (port 8787, rebuilds on save in app/src) · `npm run dev:app` (port 5173, instant reload, proxies /api to 8787)
**Open issues:** dev-only tools (vitest, wrangler) have npm audit warnings, same as main; the shipped app reports 0. SoundCloud/Stripe need the owner's accounts.
**Next task:** go live (docs/06 Phase 2), then verify each music adapter with a real account.
