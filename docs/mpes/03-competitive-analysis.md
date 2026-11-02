# MPES 3 — Competitive analysis and top-tier benchmarks

> **In plain words**
> Four other apps do what mix n match does: FreeYourMusic, Soundiiz, TuneMyMusic and SongShift.
> Only FreeYourMusic's prices have been checked on its own website. The others still need checking, so their rows say **unconfirmed** and must not be quoted to customers.
> Below that is a list of what a **top-tier** ("AAA") app of this kind should do. mix n match already does most of the hard parts; the biggest gaps are more services (Apple Music, Amazon Music), albums and artists, and choosing how often a sync runs.

## 3.1 How this was checked

| Source | Result |
|---|---|
| FreeYourMusic pricing, read with Firecrawl on 26 Oct 2026 | ✅ Confirmed (carried from [../11-spec-v1.3.md](../11-spec-v1.3.md)) |
| TuneMyMusic `https://www.tunemymusic.com/pricing`, read with Firecrawl on 2 Nov 2026 | ❌ **The page returns 404.** The address in the v1.3 spec is wrong; the real pricing page must be found |
| Soundiiz `https://soundiiz.com/premium`, SongShift `https://www.songshift.com/` | ❌ Not read: Firecrawl's daily limit without an account was reached in this session |

**Rule (`DOC-04`):** a competitor fact may be shown to customers, or used to set a price, only when it is marked ✅ with a link and the date it was read.

## 3.2 Direct competitors

| Competitor | What they offer | Confirmed? |
|---|---|---|
| **FreeYourMusic** | Free 300 songs (600 after email sign-up). Premium €14.99 / 3 months, €39.99 / year, €199.99 lifetime. Unlimited transfers, Auto-Sync, Cloud Backup, all platforms, multi-account. Rematch free on every plan. Refunds within 3 days | ✅ freeyourmusic.com/pricing, 26 Oct 2026 |
| FreeYourMusic (more) | Albums and followed artists; native desktop and mobile apps | ❌ Unconfirmed |
| **Soundiiz** | ~48 services; free: one playlist at a time, up to 200 songs; paid: batch, auto-sync, AI playlist maker | ❌ Unconfirmed |
| **TuneMyMusic** | Import from text, file or playlist URL; sync daily/weekly/monthly at a chosen hour; CSV of missing songs; backup | ❌ Unconfirmed |
| **SongShift** | Apple-focused iPhone app | ❌ Unconfirmed |

## 3.3 Top-tier benchmark ("AAA" capability list)

This is **our assessment** of what a best-in-class product in this category does, grouped by area. "Gap" means mix n match does not do it today.

| # | Capability | Why it matters | mix n match today |
|---|---|---|---|
| B-01 | Official APIs only, OAuth, no passwords | Trust, store/API approval | ✅ |
| B-02 | ISRC-first matching with a fuzzy fallback and a confidence score per song | Match rate > 95% | ✅ (`src/matcher/`) |
| B-03 | Show every song's result; fix wrong matches by hand | Users trust what they can check | ✅ Fix / Skip |
| B-04 | Resume after crash, rate limit or quota, never add a song twice | Reliability at 10k+ songs | ✅ job runner + `written` flags |
| B-05 | Add to an existing playlist without duplicates | Merging libraries | ✅ |
| B-06 | Scheduled sync with a chosen frequency and time | Multi-homers | 🟡 daily only; v1.3 F-1 📝 |
| B-07 | Paste text / import from a link | Fast start | 🟡 file upload only; v1.3 F-2 📝 |
| B-08 | Albums and followed artists | Full library, not just playlists | ❌ Gap (v1.3.1 F-3 📝) |
| B-09 | Apple Music and Amazon Music | Two of the biggest services | ❌ Gap (Apple needs $99/yr developer program) |
| B-10 | Two-way sync (removals too) | Power users | ❌ Gap (docs/06 "Later") |
| B-11 | Backups in an open format | Leaving is always possible | ✅ JSPF / CSV |
| B-12 | Account deletion that really deletes, data kept short | GDPR / CCPA, store reviews | ✅ |
| B-13 | Installable, works on any phone, accessible | Reach | ✅ PWA; 🟡 no automatic accessibility test |
| B-14 | Status page and alerts for the team | Fix outages before users notice | ❌ Gap (`AUD-07`) |
| B-15 | Fair free tier with clear limits | Conversion | ✅ 5,000 file songs free (FreeYourMusic: 300–600) |

**Where mix n match is already ahead (worth saying in marketing once confirmed):** larger free limits, a per-song result list with in-app fixing on the free plan, no tracking cookies, open-format backups.

**Where it must catch up to be top-tier:** B-06, B-07, B-08, then B-09 and B-14. These are in the roadmap ([07-implementation-roadmap.md](07-implementation-roadmap.md)).
