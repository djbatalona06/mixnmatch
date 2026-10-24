# 10 — Spec: the mix n match app (installable, one app)

> **In plain words**
> Right now mix n match is a website with nine separate pages. We are turning it into **one app** you can put on your phone's home screen, like any other app.
> It still does the same jobs: connect your music apps, move playlists, fix songs, and keep playlists copied every day.
> It talks to the same server and keeps the same accounts, so nobody loses anything.
> If you open it with no internet, it still opens and tells you it is offline, instead of showing a broken page.

Status: ✅ built

This one file holds the six planning parts for the app (PRD, TRD, App Flow, UI/UX, Backend, Plan). The older docs 01–09 still describe the server and the features. This file only covers what changes for the app.

---

## 1. PRD — what and for whom

**One sentence:** one installable app where anyone can connect their music apps, move playlists between them, and keep them copied.

**Who it's for:** the owner and anyone with music on more than one service (Spotify, TIDAL, Deezer, YouTube Music, SoundCloud, or a backup file).

**Core loop:** connect two apps → pick playlists → watch them move → fix the few songs that didn't match → tap **Keep in sync**.

| # | Requirement | Done when |
|---|---|---|
| A-01 | One app, not separate pages. Moving between screens doesn't reload the page. | Clicking around never shows a white flash. |
| A-02 | Installable on Android, iPhone and desktop | Chrome shows "Install". iPhone users get a short "Share → Add to Home Screen" guide. |
| A-03 | Works like an app on a phone | Bottom tab bar, taps at least 44 px, safe areas respected (notch, home bar), no sideways scrolling at 375 px. |
| A-04 | Opens with no internet | The app shell loads from the phone and a clear "You're offline" bar shows. Nothing pretends to work. |
| A-05 | Same features as today | Everything in v1.0–v1.2 works: magic-link sign-in, connect, the 4-step move, live results, Fix / Skip / Try again / Stop, add to an existing playlist, Keep in sync, back up to a file, Premium, delete account. |
| A-06 | Old links keep working | Email sign-in links (`/login?token=…`), app-connect returns (`/dashboard?connected=…`), payment returns (`/dashboard?premium=thanks`) and `/results?job=…` all open the right screen. |
| A-07 | Updates arrive by themselves | A new version replaces the old one on the next visit, so nobody gets stuck on an old copy. |

**Not in scope:** push notifications, offline transfers (moving songs always needs the server), and app-store packaging.

## 2. TRD — tech choices

| Layer | Choice | Why |
|---|---|---|
| App | React 18 + Vite 7 + TypeScript | Fast to build and to reload while coding. |
| Styling | Tailwind CSS v3 | Mobile-first utility classes and a small CSS file. |
| PWA | `vite-plugin-pwa` (Workbox) with `registerType: "autoUpdate"` | Makes the manifest and service worker, and updates itself (A-07). |
| State | Zustand (`session` store for "who am I", `toast` store) | Small, with no extra setup code. |
| Routing | React Router v7 (the skill's default is v6; v7 fixes a security warning in v6 and works the same for this app) | Keeps the same paths as the old pages (A-06). |
| Icons | Lucide React | One consistent icon set. |
| Font | Inter, bundled with the app (`@fontsource-variable/inter`) | Works offline, with no outside font server. |
| Server / DB | **Unchanged**: the Cloudflare Worker + D1 + Durable Object | The skill's default is Supabase. We keep the server we already have, because it holds every account, key and sync. |
| Hosting | The same Worker serves the built app from `dist/` | One URL, so cookies and sign-in stay the same. No CORS. |

**Important settings**
- `wrangler.jsonc` `assets.directory = ./dist`, `not_found_handling = "single-page-application"` (any page path loads the app), `run_worker_first = ["/api/*"]`.
- `wrangler.jsonc` `build.command = "npm run build"`, so `wrangler dev` and `wrangler deploy` always build the app first.
- The service worker **never** handles `/api/*`. This matters because connecting an app goes to `/api/connect/...` and back through `/api/callback/...`. If the service worker answered those, connecting would break. `navigateFallbackDenylist: [/^\/api\//]` and no runtime caching of the API.
- CSP stays strict (`script-src 'self'`). Vite emits only files, never inline scripts.
- `index.html` contains only HTML. All behaviour lives in `app/src/**/*.tsx` / `*.ts`.

## 3. App flow

```
/            Welcome (signed out)  ──►  /login  ──email link──►  /login?token=…  ──►  /dashboard
                                                                                    │
Bottom tabs (signed in):  Home (/dashboard) · Move (/transfer) · Syncs (/syncs) · Account (/account)
                                                                                    │
/dashboard   music services (Connect / Disconnect) · Start a transfer · recent transfers
/transfer    1 From → 2 To → 3 Choose (Peek) → 4 Review (New playlist / Add to …) → Start
/results?job=…  live progress · Stop · Try again · Fix / Skip · Keep in sync · CSV of songs to check
/syncs       every sync: Pause / Resume / Delete, last run, "needs you" messages
/account     email · plan (Premium) · install the app · back up · sign out · delete account
/export      back up playlists to a JSPF or CSV file
/privacy /terms   readable signed in or out
anything else      "Lost the beat" page
```

**Errors:** a 401 from the server sends you to `/login`. An offline error shows the offline bar and a toast. The connect errors (`?error=denied|expired|failed`) show as a red note on Home, the same as before.

## 4. UI/UX brief — dark luxury, amber

| Token | Value |
|---|---|
| Background | `#0a0a0a` |
| Surface / raised | `#141414` / `#1a1a1a` |
| Border | `#262626` |
| Accent (buttons, focus, progress) | amber `#f59e0b`, with `#0a0a0a` text on top |
| Text / muted | `#f5f5f5` / `#a3a3a3` |
| Good / warn / bad | `#10b981` / `#f59e0b` / `#f87171` |
| Shapes | cards `rounded-xl`, buttons and pills `rounded-full` |
| Font | Inter |

- Service colours stay as small dots (Spotify green, TIDAL white, …) so people still recognise their apps.
- **Phone:** bottom tab bar, header with only the logo, content padded clear of the notch and home bar.
- **Desktop:** top bar with the same four tabs, centred content up to 72 rem wide.
- Every button has a visible focus ring. Nothing works only on hover. `touch-action: manipulation` stops double-tap zoom.
- Dialogs (Peek, Fix) use the native `<dialog>`: Esc closes them and focus goes back to the button that opened them.

## 5. Backend schema

**No changes.** The app calls the same `/api/*` routes listed in [05-backend-schema.md](05-backend-schema.md). There is no new table, migration or secret.

## 6. Implementation plan

| Phase | What | Status |
|---|---|---|
| 5.1 | Tooling: Vite + React + TS + Tailwind + PWA plugin, `app/` folder, `dist/` build, Worker serves it | ✅ |
| 5.2 | Shared code: `api.ts`, `formats.ts` (moved from `public/js`), platform names, session + toast stores | ✅ |
| 5.3 | Layout: header, bottom tabs, offline bar, toasts, install prompt (Android + iPhone guide) | ✅ |
| 5.4 | Screens: Welcome, Login, Home, Move, Results (+ Fix dialog), Syncs, Account, Back up, Privacy, Terms, Not found | ✅ |
| 5.5 | Icons (192, 512, maskable 512, Apple 180) drawn from one SVG by `scripts/make-icons.mjs` | ✅ |
| 5.6 | Checks: unit tests, typecheck for server + app, browser smoke test of the whole app, PWA checks (manifest, service worker, opens offline), phone-width check | ✅ |
| 5.7 | Remove the old `public/` pages | ✅ |

**Owner:** nothing new. `npm run deploy` builds and ships the app together with the server.
