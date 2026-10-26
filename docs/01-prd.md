# 01 — Product Requirements (PRD)

**Product:** mix n match — a website that moves your playlists and liked songs from one music app to another.

## The problem
There is no "export to another app" button between music services. People who switch apps lose years of playlists and liked songs. Tools that exist (Soundiiz, TuneMyMusic) limit tracks, charge subscriptions, or hide which songs failed. A comparison with FreeYourMusic, Soundiiz, TuneMyMusic and SongShift, and what to build next because of it, is in [11-spec-v1.3.md](11-spec-v1.3.md).

## Who it is for
| Person | What they want |
|---|---|
| **The Switcher** | Moving for good (e.g. Spotify → TIDAL). Wants everything moved once, correctly. |
| **The Backer** | Wants a copy of their playlists in a file, just in case. |
| **The Multi-Homer** *(Phase 2)* | Pays for two apps and wants them kept in sync automatically. |

## Version 1 — decided scope
| ID | As a user I want to… | So that… | Status |
|---|---|---|---|
| FR-01 | Connect my music apps through their own login pages (OAuth) | mix n match never sees my password | ✅ v1 |
| FR-02 | See my playlists (with cover art) and peek inside before moving | I pick exactly what moves | ✅ v1 |
| FR-03 | See a per-song result: Matched, Need a look, Not found | I know what happened to every song | ✅ v1 |
| FR-04 | Move my Liked Songs, keeping their order | My favourites come with me | ✅ v1 |
| FR-08 | Download my playlists as JSPF or CSV, and upload such a file as a source | I have a backup that works even when an app blocks access | ✅ v1 |
| FR-05 | Copy my profile name/picture | — | ❌ Not possible: none of the APIs allow writing profile data |
| FR-07 | Fix "Need a look" songs by hand inside the app | Every song ends up right | ✅ v1.1 ([spec](08-spec-v1.1.md)) |
| — | Add to a playlist I already have, never twice; Stop + Try again | No mess when merging or retrying | ✅ v1.1 |
| FR-06 | Keep a playlist copied once a day (one-way, add-only) | My two apps stay in step | ✅ v1.2 ([spec](09-spec-v1.2.md)) |
| — | SoundCloud as source and destination | — | ✅ v1.2 (verify with a real app) |
| — | Paid Premium tier (Stripe) | — | ✅ v1.2 (needs a Stripe account) |

**Services:** Spotify, TIDAL, Deezer, YouTube Music (official YouTube Data API), SoundCloud (v1.2), plus file import/export.

## Non-functional requirements
- **Speed:** a 1,000-song playlist finishes in under 5 minutes when the services are not rate-limiting us (YouTube excepted — see quota).
- **Reliability:** obey "slow down" (HTTP 429 + `Retry-After`), pause and resume automatically, never add a song twice.
- **Cost:** runs on Cloudflare's **free** plan.
- **Usability:** one guided path: Connect → From → To → Choose → Review → Watch → Results.
- **Privacy:** see [07-legal-security.md](07-legal-security.md).

## Success measures
| Measure | Target |
|---|---|
| Match rate on mainstream songs | > 95% |
| Transfers that finish without a system error | > 99% |
| Time from sign-up to first transfer | < 10 minutes |

## Known outside limits (found during research, Oct 2026)
- **Spotify:** since Feb 2026, apps in "Development Mode" are limited to **5 users** and the app owner must have **Spotify Premium**. A public launch needs Spotify's "extended quota" approval, which they now give mainly to established businesses.
- **YouTube:** 10,000 quota units per day for the whole app. A song search costs 100 units, adding a song costs 50 → roughly **60 songs/day moved into YouTube** across all users until Google grants more.
- **Deezer:** could not confirm that Deezer still accepts new developer apps. If not, Deezer is supported through file import/export only.
- **Magic-link email** needs a domain you own before it can email anyone other than you.
