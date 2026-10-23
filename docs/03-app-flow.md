# 03 — App Flow

## Pages
| URL | File | Who can see it |
|---|---|---|
| `/` | `public/index.html` | Everyone |
| `/login` | `public/login.html` | Everyone |
| `/dashboard` | `public/dashboard.html` | Signed in |
| `/transfer` | `public/transfer.html` | Signed in |
| `/results?job=…` | `public/results.html` | Signed in, owner of the job |
| `/export` | `public/export.html` | Signed in |
| `/privacy`, `/terms` | `public/privacy.html`, `public/terms.html` | Everyone |

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
     │                                               Results (live progress) ◀┘
     │
     ├── Back up to a file ─▶ Export: pick app + playlists + format ─▶ file downloads
     ├── Recent transfers ─▶ Results
     ├── Disconnect <service>
     └── Delete my account ─▶ Landing
```

## Step by step
1. **Sign in.** Enter email → server stores a *hash* of a one-time token → email with link. Opening the link shows a "Sign in" button (so email scanners that open links can't use it up). Click → session cookie → Dashboard.
2. **Connect.** Click *Connect Spotify* → server saves a random `state` + PKCE secret → redirect to Spotify → user approves → Spotify returns to `/api/callback/spotify` → server checks `state`, swaps the code for tokens, encrypts and saves them → Dashboard.
3. **From.** Pick a connected app or *Upload a file* (JSPF/JSON/CSV/TXT, read in the browser).
4. **To.** Pick another connected app. YouTube shows a daily-limit warning.
5. **Choose.** Liked Songs + playlists with cover art; *Peek* shows the first 50 songs.
6. **Review.** Summary → *Start transfer* → `POST /api/jobs` → Results page.
7. **Results.** Polls `GET /api/jobs/:id` every 2 s: progress bar, Matched / Need a look / Not found counts, every song in a filterable table, CSV download of songs to check.

## Error paths
| Situation | What the user sees |
|---|---|
| Cancelled the service login | Dashboard: "You cancelled the connection, so nothing was changed." |
| Login took > 10 min | "That took too long. Please try connecting again." |
| Session expired | Sent to `/login` |
| Service says "slow down" | Results: *Paused* — resumes automatically |
| YouTube daily allowance used | Results: *Paused* until after midnight UTC |
| Service access revoked | Results: *Failed* — "please reconnect" |
| Already running a transfer | "You already have a transfer running" |
