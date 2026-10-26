# 11 — Spec: v1.3 "Catch up with the others"

> **In plain words**
> We looked at the other apps that move music (FreeYourMusic, Soundiiz, TuneMyMusic, SongShift) to see what they do that mix n match does not.
> Two of the ideas are **already in mix n match**. Two are worth building next: **choose how often a sync runs** (daily, weekly or monthly, at the hour you pick), and **paste a list of songs** instead of uploading a file.
> One more, **moving saved albums**, is worth building after that, for Spotify, TIDAL and Deezer only.
> Two ideas wait: **importing someone else's playlist link** and **sharing your results with a link**. They cost more than they give right now.

**Status:** 📝 spec only. Nothing here is built yet.
**Builds on:** v1.1 ([08-spec-v1.1.md](08-spec-v1.1.md)), v1.2 ([09-spec-v1.2.md](09-spec-v1.2.md)), the app ([10-spec-app.md](10-spec-app.md)) and the move to Vercel (PR #4, which adds migration `0004_job_runner.sql`; so v1.3 uses `0005`).

---

## Research notes (26 Oct 2026)

**Where this comes from.** There was no competitor study in `docs/` before this one. The only mention was one line in [01-prd.md](01-prd.md) naming Soundiiz and TuneMyMusic. So this section is new.

**How it was checked.** Each competitor's own pricing page was to be read with Firecrawl. Only one page could be read:

- **FreeYourMusic** was read with Firecrawl on 26 Oct 2026. Its numbers below are **confirmed**.
- **Soundiiz, TuneMyMusic and SongShift** could not be read. Firecrawl hit its daily limit for use without an account, and this cloud environment's network rules block those three sites. Their rows come from search-result snippets seen while planning. They are marked **unconfirmed** and must be checked before anyone quotes them (see step 1.1 of the plan).

| Competitor | What they offer | Confirmed? | Source |
|---|---|---|---|
| **FreeYourMusic** | Free: **300 songs, or 600 after a free email sign-up**, no card. Premium Quarterly **€14.99 every 3 months** (€5.00/mo). Premium Yearly **€39.99 a year** (€3.33/mo). Lifetime **€199.99 once**. Premium includes unlimited transfers, **Auto-Sync**, **Cloud Backup**, all platforms, multi-account. **Rematch** ("fix imperfect matches in one tap") is free on every plan. Refunds within 3 days. | ✅ Yes | https://freeyourmusic.com/pricing (read 26 Oct 2026) |
| FreeYourMusic (more) | Moves **albums and followed artists**; native desktop and mobile apps | ❌ Unconfirmed (not on the pricing page) | search snippets during planning |
| **Soundiiz** | About **48 services**. Free: one playlist at a time, **up to 200 songs per playlist**. Paid: batch transfers, auto-sync, an AI playlist maker | ❌ Unconfirmed | search snippets during planning; check https://soundiiz.com/premium |
| **TuneMyMusic** | Import from pasted **text, a file or a playlist URL**. Auto-sync **daily, weekly or monthly at a chosen hour**. Download a **CSV of missing songs**. Backup. AI playlist maker | ❌ Unconfirmed | search snippets during planning; check https://www.tunemymusic.com/pricing |
| **SongShift** | Focused on Apple devices (iPhone app) | ❌ Unconfirmed | search snippets during planning; check https://songshift.com |

**What mix n match already has** (checked in the code, not guessed):

| Idea seen at competitors | In mix n match today? | Where |
|---|---|---|
| Fix a wrong match by hand ("Rematch") | ✅ Yes: **Fix** and **Skip** on each song | `app/src/pages/Results.tsx` |
| Try failed songs again | ✅ Yes: **Try again** | `app/src/pages/Results.tsx` |
| Add to a playlist you already have | ✅ Yes, without adding songs twice | v1.1 |
| Keep a playlist in sync | ✅ Yes, add-only, **once a day** (fixed) | v1.2, `src/routes/syncs.ts` (`now + DAY`) |
| Back up to a file | ✅ Yes: JSPF or CSV | `app/src/pages/Export.tsx` |
| **CSV of missing songs** | ✅ Yes: "Download songs that need a look (CSV)" (Need a look + Not found) | `downloadMissing()` in `Results.tsx` |
| **Import from text** | 🟡 Half: a `.txt` file with one "Artist - Title" per line can be uploaded. You cannot paste text | Step 1 of Move, `app/src/lib/formats.ts` |
| Choose how often a sync runs | ❌ No | — |
| Albums and followed artists | ❌ No: playlists and liked songs only (`kind = playlist \| liked`) | `src/jobs/engine.ts` |
| Import a playlist from a link | ❌ No | — |
| Share results with a link | ❌ No (unconfirmed whether competitors do) | — |

**Limits that decide what we can build** (from [01-prd.md](01-prd.md), [02-trd.md](02-trd.md) and [09-spec-v1.2.md](09-spec-v1.2.md)):

- **Spotify Development Mode:** 5 users at most, and the app owner needs Spotify Premium, until Spotify grants "extended quota". Anything Spotify-only helps 5 people until then.
- **YouTube:** 10,000 units a day for the whole app (we budget 9,000). Search costs 100, adding a song 50. That is **about 60 songs a day for everyone together**. Anything that makes more YouTube calls hurts everybody.
- **Deezer:** 50 calls per 5 seconds.
- **SoundCloud:** no ISRC search; adding songs means reading and rewriting the whole playlist.
- **Vercel Cron:** once a day on the Hobby plan, every minute on Pro (PR #4 needs Pro).

---

## 1. PRD — what and for whom

**Who it helps:** *The Switcher* (moving everything once) and the person who keeps two apps going (Auto-Sync, from v1.2).

### Go / no-go for each idea

| # | Idea | Who asked for it | Effort | Risk | API cost | Decision |
|---|---|---|---|---|---|---|
| F-1 | **Sync schedule:** daily, weekly or monthly, at the hour you pick | TuneMyMusic has it (unconfirmed) | **S** | Low | **Lower** than today for weekly/monthly | ✅ **Go** (v1.3) |
| F-2 | **Paste a list of songs** (one per line), same rules as the `.txt` file | TuneMyMusic has text import (unconfirmed) | **S** | Low | None to read (it's your text). Normal matching cost to add | ✅ **Go** (v1.3) |
| F-3 | **Saved albums** (Spotify, TIDAL, Deezer) | FreeYourMusic has it (unconfirmed) | **M** | Medium: three new read and save calls per service, each to verify with a real account | Album match uses UPC/title search, about 1 call per album | ✅ **Go, after F-1 and F-2** (v1.3.1) |
| F-3b | Followed artists | FreeYourMusic has it (unconfirmed) | M | Medium; artist names are often ambiguous | 1 search per artist | ⏸ **Later**: albums first, then reuse the same screens |
| F-4 | **Import from a playlist link** someone sent you | TuneMyMusic has it (unconfirmed) | **M** | **High**: only allowed through each service's official API; Spotify Development Mode limits who can use it; YouTube links cost quota to read | Read cost on the source service | ⏸ **Later**: only for links from a service you have connected, and not YouTube |
| F-5 | **Share results with a link** | Not seen at competitors (unconfirmed) | M | **High** for privacy: song lists say a lot about a person; needs a secret link, an expiry, a way to turn it off, and a privacy-page update | None | ❌ **No-go** for v1.3 |
| — | CSV of missing songs | TuneMyMusic has it (unconfirmed) | — | — | — | ✅ **Already built** |
| — | Rematch / fix a song | FreeYourMusic has it (confirmed) | — | — | — | ✅ **Already built** (Fix / Skip) |

**Not doing, and why:** AI playlist makers (not what mix n match is for, and costs money per use); a lifetime price (Premium pricing is the owner's call; FreeYourMusic's €199.99 is a data point, not a plan).

### Requirements

| ID | Requirement | Done when |
|---|---|---|
| R-1 | A sync can run **daily, weekly or monthly** | The sync card shows the choice, and the next run date follows it |
| R-2 | You choose the **hour** a sync runs, in your own time zone | "Runs every Monday at 07:00" shows your local time; the server stores UTC |
| R-3 | Syncs **into YouTube** stay off (as in v1.2), and no option can run a sync more than once a day | Checked by a test |
| R-4 | You can **paste** songs, one per line ("Artist - Title" or "Title - Artist" with a tab), up to the plan's `fileTracks` limit (500 free) | Pasting 3 lines shows "Found 1 playlist with 3 songs", like a file |
| R-5 | Pasted text never leaves the phone except as the song list of the transfer | Same path as a file upload; nothing new is stored |
| R-6 (v1.3.1) | You can pick **Saved albums** as a source on Spotify, TIDAL and Deezer, and they are saved as albums on the other app | An album that is found is saved; one that is not shows under "Not found" with its artist and title |

---

## 2. TRD — tech choices

No new services, libraries or secrets.

| Part | Choice | Why |
|---|---|---|
| Schedule | Three new columns on `syncs` (below). The next run is worked out by one pure function `nextRun(sync, now)` | Easy to test with fixed dates; the cron (minute on Pro, hourly check before) only looks at `next_run_at` as today |
| Time zones | The browser sends its zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The server keeps the hour in **UTC** plus the zone name, and uses `Intl` to handle summer time | No time-zone library needed |
| Paste | Reuse `parseImport()` in `app/src/lib/formats.ts` with the text and a pretend file name `pasted.txt` | One parser, one set of tests |
| Albums (v1.3.1) | New selection `kind = "album"`. Adapters gain `listSavedAlbums`, `findAlbum` (UPC first, then title + artist) and `saveAlbums` | Same step-by-step engine as songs; UPC plays the role ISRC plays for songs |
| API cost | F-1 weekly/monthly **lowers** calls. F-2 reads nothing. F-3 is about 1 search per album | Fits the limits above; YouTube stays out of albums (it has no albums) |

---

## 3. App flow

**Syncs → change schedule (F-1)**
1. Syncs screen → each card gets a **Schedule** button.
2. A small dialog: **How often?** Daily · Weekly · Monthly. **Which day?** (weekly: Mon–Sun; monthly: 1–28). **What time?** (00:00–23:00).
3. **Save** → the card now says "Every Monday at 07:00 · next: 27 Oct". New syncs start as **Daily at the current hour** (the same as today's behaviour).

**Move → paste songs (F-2)**
1. Move, step 1 → a new tile **Paste a list** next to **Upload a file**.
2. A text box: "One song per line, like *Queen - Bohemian Rhapsody*". A playlist name field (default "Pasted songs").
3. Under the box: "Found 1 playlist with 12 songs" (or the error). **Next** → step 2, exactly as for a file.

**Move → saved albums (F-3, v1.3.1)**
1. Step 3 (Choose) shows a **Saved albums** cover next to **Liked Songs** for Spotify, TIDAL and Deezer.
2. Results list albums the same way as songs: Matched · Need a look · Not found, with **Fix** to search by hand.

---

## 4. UI/UX brief

Same dark theme and parts as today ([10-spec-app.md](10-spec-app.md) §4). Every new part follows the layout rules in [layout-board.html](layout-board.html) and must pass `npm run layout:check`:

- **Schedule dialog:** uses the existing `Dialog`. Three `select`s, each 44px tall, stacked on phones and side by side from 640px (`sm:grid-cols-3`).
- **Sync card line:** "Every Monday at 07:00 · next: 27 Oct" in `text-sm text-muted`, cut off with … if it is too long.
- **Paste tile:** same `Tile` as "Upload a file". The text box is a `textarea`, at least 8 lines tall, full width, with the 16px side gutter.
- **Albums cover:** same `CoverCard`, with a stacked-records icon instead of a letter.
- **Words:** say "every week", not "weekly cron"; say "time", not "UTC". Never show the raw zone name unless it differs from the phone's.

Add the new states to `test/layout.mjs`: the schedule dialog open, the paste tile filled in, and the Choose step with Saved albums.

---

## 5. Backend schema

Migration `migrations/0005_v1_3.sql`:

```sql
-- How often each sync runs (v1.3). Old rows keep today's behaviour: daily.
ALTER TABLE syncs ADD COLUMN every    TEXT    NOT NULL DEFAULT 'day';  -- day, week, month
ALTER TABLE syncs ADD COLUMN on_day   INTEGER;                         -- week: 1-7 (Mon-Sun); month: 1-28; day: NULL
ALTER TABLE syncs ADD COLUMN at_hour  INTEGER;                         -- 0-23 in the user's zone; NULL = the hour it was made
ALTER TABLE syncs ADD COLUMN zone     TEXT;                            -- e.g. 'Europe/Amsterdam'; NULL = UTC
```

API changes:

| Call | Change |
|---|---|
| `PATCH /api/syncs/:id` | Also accepts `{ every, onDay, atHour, zone }`. Checks: `every` in the list, `onDay` in range for `every`, `atHour` 0–23, `zone` accepted by `Intl`. Recomputes `next_run_at` |
| `GET /api/syncs` | Returns the four new fields |
| `POST /api/jobs` | No change for paste (it arrives as a file playlist). v1.3.1: selections may have `kind: "album"` |

Albums (v1.3.1) add `kind = 'album'` to `transfer_selections` and reuse `transfer_items`: album title in `src_title`, artist in `src_artist`, and the album's UPC in a new `src_upc` column (added by its own v1.3.1 migration, `0006`).

---

## 6. Implementation plan

| Step | What | Done when | Who |
|---|---|---|---|
| 1.1 | **Confirm the research.** Read Soundiiz, TuneMyMusic and SongShift pricing pages (Firecrawl with an API key, or allow those sites in the environment) and update the table above with dates | Every competitor row says ✅ with a link and date | Owner / next session |
| 1.2 | `nextRun(sync, now)` with tests: daily, weekly, monthly, the 28th, summer-time change in `Europe/Amsterdam` and `America/New_York` | `npm test` covers all of them | Build |
| 1.3 | Migration `0005_v1_3.sql`; `PATCH /api/syncs/:id` checks and saves the schedule | API tests for good and bad values | Build |
| 1.4 | Schedule dialog on the Syncs screen; card line | Layout check passes with the dialog open | Build |
| 2.1 | **Paste a list** tile and text box in Move step 1, using `parseImport` | A test pastes 3 lines and gets 3 songs; smoke test moves a pasted list to Demo Music | Build |
| 2.2 | Add the new states to `test/layout.mjs` | `npm run layout:check` passes | Build |
| 3.1 (v1.3.1) | Album reading and saving for Spotify, TIDAL, Deezer and Demo Music, with fake-reply tests | Adapter tests pass | Build |
| 3.2 (v1.3.1) | Engine and Results for `kind = "album"` | A Demo Music album transfer shows in Results | Build |
| 3.3 (v1.3.1) | **Verify** each album call once with a real account | Marked ✅ in [02-trd.md](02-trd.md) | Owner |

**Order:** 1 → 2 → 3. F-1 and F-2 are small and safe; F-3 waits until they ship.
