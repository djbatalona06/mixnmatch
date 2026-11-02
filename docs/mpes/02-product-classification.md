# MPES 2 — Product classification

> **In plain words**
> mix n match is a **moving van for your music lists**. It does not play music. It reads the list of songs in one app (like Spotify) and builds the same list in another app (like TIDAL), and it can keep doing that every day.
> It is for regular people, on their phone, who are switching music apps or using two at once. It is free to try, with a paid Premium plan for bigger jobs.

Everything here is taken from the code. Where a doc says something the code does not do, the code wins.

## 2.1 Category

| Question | Answer from the code | Evidence |
|---|---|---|
| Category | **Consumer data-portability utility**: music library transfer and one-way sync | `src/jobs/engine.ts` (read → match → existing → write), `src/routes/syncs.ts` |
| Not | A player, a streaming service, a recommender, a social network, or an AI playlist maker. It never touches audio | `docs/07-legal-security.md` "Copyright"; no audio code anywhere |
| Market type | **B2C**, self-serve. No teams, no admin roles, no org accounts | `users` table has no org/role column (`migrations/0001_init.sql`) |
| Business model | **Freemium subscription**: Free (1 running transfer, 1 sync, 5,000 file songs) and Premium monthly/yearly via Stripe (3 transfers, 20 syncs, 20,000 file songs) | `src/plans.ts`, `src/routes/billing.ts` |
| Delivery | **Installable web app (PWA)**, mobile-first, opens offline; no native store apps | `app/vite.config.ts` (manifest, service worker), bottom tab bar in `app/src/components/chrome.tsx` |
| Integration style | **Hub-and-spoke over official APIs**, OAuth per service, no scraping or unofficial APIs | `src/adapters/*.ts` |
| Data held | Email, encrypted service tokens, song metadata (title, artist, album, ISRC, duration) for 30 days | `migrations/*.sql`, `cleanup()` in `src/index.ts` |

## 2.2 Target users (from `docs/01-prd.md`, confirmed by features in code)

| Persona | Job to be done | Feature that serves it | Exists? |
|---|---|---|---|
| **The Switcher** | "Move everything once, correctly, and tell me what didn't make it" | 4-step Transfer, per-song Matched / Need a look / Not found, Fix / Skip, Try again, CSV of missing songs | ✅ |
| **The Backer** | "Give me a file copy, just in case" | Export JSPF / CSV; import JSPF / CSV / TXT | ✅ |
| **The Multi-Homer** | "I pay for two apps; keep a playlist copied" | Auto-Sync, one-way, add-only, daily; never re-adds a song you removed (`sync_seen`) | ✅ (schedule choice 📝 v1.3) |

## 2.3 Core use cases (as the code runs them)

1. **Sign in** with an emailed link → **connect** two services (OAuth + PKCE).
2. **Pick** playlists or Liked Songs (or upload a file) → **choose** "new playlist" or "add to an existing one".
3. The **job runner** reads, matches (ISRC → exact → fuzzy), skips songs already there, writes — pausing on rate limits and quotas.
4. **Review** results live; **fix** or **skip** songs that need a look; **try again** for failures.
5. Optionally **keep in sync** daily, or **export** a backup.
6. **Upgrade** to Premium, **manage/cancel** in Stripe's portal, **delete account** (cancels Stripe first).

## 2.4 What this means for the platform

The parts that make mix n match work are **not music-specific** at their core: passwordless sign-in, encrypted third-party tokens, a resumable job runner, an adapter contract, plans and billing, privacy clean-up, and an installable app shell. These are what future MixNMatch products should inherit (see [04-shared-architecture.md](04-shared-architecture.md)).

The music-specific parts are the six adapters, the matcher, and the transfer screens.
