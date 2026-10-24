# 03 — App Flow

## Screens
One app (`app/`). Every address loads the same app; React Router shows the right screen. The old page addresses still work.

| URL | Screen (`app/src/pages/…`) | Who can see it |
|---|---|---|
| `/` | `Landing.tsx` | Everyone |
| `/login` | `Login.tsx` | Everyone |
| `/dashboard` | `Dashboard.tsx` (Home tab) | Signed in |
| `/transfer` | `Transfer.tsx` (Move tab) | Signed in |
| `/results?job=…` | `Results.tsx` | Signed in, owner of the job |
| `/syncs` | `Syncs.tsx` (Syncs tab) | Signed in |
| `/account` | `Account.tsx` (Account tab: plan, install, sign out, delete) | Signed in |
| `/export` | `Export.tsx` | Signed in |
| `/privacy`, `/terms` | `Legal.tsx` | Everyone |
| anything else | `NotFound.tsx` | Everyone |

Phones get a bottom tab bar (Home · Move · Syncs · Account); bigger screens get the same tabs at the top.

## Map
```
Landing ──Get started──▶ Login ──email──▶ "check your inbox"
                                  │
               email link /login?token=…  ──"Sign in" button──▶ Dashboard
                                                                   │
     ┌──────────────── Connect <service> ◀────────────────────────┤
     │  /api/connect/x → service login page → /api/callback/x → Dashboard ("x is connected")
     │
     ├── Start a transfer ─▶ 1 From ─▶ 2 To ─▶ 3 Choose (Peek) ─▶ 4 Review ─▶ Start
     │                                                                        │
     │                     (Review: "New playlist" or "Add to: <your playlist>")
     │                                               Results (live progress) ◀┘
     │                    Stop · Try again · Fix (search → Use this / Skip) · Keep in sync
     │
     ├── Back up to a file ─▶ Export: pick app + playlists + format ─▶ file downloads
     ├── Recent transfers ─▶ Results
     ├── Syncs: Pause / Resume / Delete (last run → Results)
     ├── Your plan: Get Premium ─▶ Stripe Checkout ─▶ Dashboard · Manage or cancel ─▶ Stripe Portal
     ├── Disconnect <service>
     └── Delete my account ─▶ Landing
```

## Step by step
1. **Sign in.** Enter email → server stores a *hash* of a one-time token → email with link. Opening the link shows a "Sign in" button (so email scanners that open links can't use it up). Click → session cookie → Dashboard.
2. **Connect.** Click *Connect Spotify* → server saves a random `state` + PKCE secret → redirect to Spotify → user approves → Spotify returns to `/api/callback/spotify` → server checks `state`, swaps the code for tokens, encrypts and saves them → Dashboard.
3. **From.** Pick a connected app or *Upload a file* (JSPF/JSON/CSV/TXT, read in the browser).
4. **To.** Pick another connected app. YouTube shows a daily-limit warning.
5. **Choose.** Liked Songs + playlists with cover art; *Peek* shows the first 50 songs.
6. **Review.** Summary; each playlist can go to a **New playlist** (default) or **Add to:** one of your playlists on the new app (songs already in it are skipped) → *Start transfer* → `POST /api/jobs` → Results page.
7. **Results.** Polls `GET /api/jobs/:id` every 2 s: progress bar, Matched / Need a look / Not found / Already there counts, every song in a filterable table, CSV download of songs to check.
8. **Stop.** While running: *Stop* (with a confirm). Songs already added stay.
9. **Try again.** When finished: *Try again* (optionally also the *Need a look* songs). Songs are never read twice and no second playlist is made.
10. **Fix.** On a *Need a look* / *Not found* row: *Fix* → dialog with a search box pre-filled with title + artist → *Use this* (added now) or *Skip*. On YouTube the search only runs when you press *Search* (each search costs quota).
11. **Keep in sync.** On a finished transfer: *Keep "<playlist>" in sync*. Once a day (an hourly cron picks due syncs), new songs in the original are added to the copy. Never removes. Shown under *Syncs* on the dashboard.
12. **Premium.** Dashboard → *Get Premium* → Stripe's page → back to the dashboard. *Manage or cancel* opens Stripe's portal.

## Error paths
| Situation | What the user sees |
|---|---|
| Cancelled the service login | Dashboard: "You cancelled the connection, so nothing was changed." |
| Login took > 10 min | "That took too long. Please try connecting again." |
| Session expired | Sent to `/login` |
| Service says "slow down" | Results: *Paused* — resumes automatically |
| YouTube daily allowance used | Results: *Paused* until after midnight UTC |
| Service access revoked | Results: *Failed* — "please reconnect" |
| Already running a transfer | "You already have a transfer running" (+ Premium hint on the free plan) |
| Fix: playlist deleted on the app | "That playlist no longer exists on the destination app." |
| Fix: too many searches | "That's a lot of searches. Please wait a minute." |
| Sync: access revoked / playlist removed | Dashboard sync shows *Needs you* + reason; reconnecting turns it back on |
| Free-plan limit (syncs, file size, transfers at once) | Message ends with "Premium raises this limit — see your dashboard." |
