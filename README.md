# mix n match

Move your playlists and liked songs between **Spotify, TIDAL, Deezer and YouTube Music**, or back them up to a file. Runs on Cloudflare's free plan.

- Planning docs: [`docs/`](docs) — PRD, tech, app flow, UI/UX, schema, plan, legal/security
- Website files: [`public/`](public) — plain HTML, CSS and JavaScript
- Server code: [`src/`](src) — one Cloudflare Worker + one Durable Object
- Database: [`migrations/0001_init.sql`](migrations/0001_init.sql)

## How a transfer works
1. The source app's songs are copied into the `transfer_items` table.
2. Each song is looked up on the destination app:
   **ISRC** (the song's official barcode) → **exact** cleaned-up title + artist → **fuzzy** (Jaro-Winkler, ≥ 85% = match).
3. Matches are added to a new playlist (or saved as liked songs). Unsure ones are listed for you to check.
4. All of this runs in small steps inside a Durable Object, so it fits the free plan and pauses politely when a service says "slow down".

## Run it on your computer
```bash
npm install
cp .dev.vars.example .dev.vars          # then put a key in TOKEN_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm run db:migrate:local
npm run dev                             # http://localhost:8787
```
With `DEV_MODE=1` the sign-in link is shown on screen instead of emailed, and `ENABLE_MOCK=1` adds a pretend service called **Demo Music** so you can try everything without real accounts.

## Tests
```bash
npm test          # unit tests (matching, security, engine, adapters, file formats)
npm run typecheck
npm run smoke     # browser test; needs `npm run dev` running in another terminal
```

## Put it online (Cloudflare)
```bash
npx wrangler login
npx wrangler d1 create mixnmatch        # copy the database_id into wrangler.jsonc
npx wrangler secret put TOKEN_KEY       # 32 random bytes, base64 (see above)
npm run deploy                          # applies migrations, then deploys
```
Then, for each service you want, create a developer app and add its secrets:

| Service | Where | Redirect URL | Secrets |
|---|---|---|---|
| Spotify | developer.spotify.com/dashboard | `https://<your-site>/api/callback/spotify` | `SPOTIFY_CLIENT_ID` |
| TIDAL | developer.tidal.com | `https://<your-site>/api/callback/tidal` | `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET` |
| Deezer | developers.deezer.com/myapps | `https://<your-site>/api/callback/deezer` | `DEEZER_APP_ID`, `DEEZER_SECRET` |
| YouTube | console.cloud.google.com (enable *YouTube Data API v3*, OAuth client "Web") | `https://<your-site>/api/callback/youtube` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Email | resend.com (verify a domain you own) | — | `RESEND_API_KEY`, and set `EMAIL_FROM` in `wrangler.jsonc` |

Good to know: Spotify apps in Development Mode allow only 5 users and need the owner to have Premium; YouTube allows about 60 songs/day into YouTube for the whole app until Google raises the quota.
