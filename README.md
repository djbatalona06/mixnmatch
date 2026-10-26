# mix n match

**Move your music from one app to another. No typing in song names. No starting over.**

Say you use Spotify, but you want to switch to TIDAL. You have lots of playlists. You do not want to find every song again by hand. mix n match does it for you.

It works with **Spotify**, **TIDAL**, **Deezer**, **YouTube Music** and **SoundCloud**. It can also save your playlists in a file, as a backup.

---

## Open the app

| | Link |
|---|---|
| **The app** | **https://mixnmatch-gilt.vercel.app** |
| Sign in | https://mixnmatch-gilt.vercel.app/login |
| Privacy (what we keep) | https://mixnmatch-gilt.vercel.app/privacy |
| Terms of use | https://mixnmatch-gilt.vercel.app/terms |
| The code (for builders) | https://github.com/djbatalona06/mixnmatch |

Nothing to download from a store. It is **one app** that runs in your web browser, and you can put it on your phone's home screen too.

### Put it on your phone's home screen

1. Open **https://mixnmatch-gilt.vercel.app** in your phone's browser.
2. Then:
   - **iPhone:** open it in **Safari**. Tap **Share**, then **Add to Home Screen**.
   - **Android (Chrome or Edge):** sign in, open the **Account** screen, and tap **Install app**.
3. Tap the new **mix n match** icon, like any other app.

---

## How to switch, step by step

1. **Sign in with your email.** We send you a link. You tap it. That's it. No password.
2. **Connect your music apps.** You log in on each music app's own page. We never see your password.
3. **Pick what to move.** Tap the playlists you want. You can peek inside each one first.
4. **Watch it move.** We look for each song in the new app and build your playlists there.
5. **Check the results.** Every song gets a label:
   - ✅ **Matched.** We found it and added it.
   - ⚠️ **Need a look.** We were not sure, so we did not add it. You can check it.
   - ❌ **Not found.** The new app does not have it.
6. **Fix the unsure ones.** Tap **Fix** on a song and pick the right one from a short list. Or tap **Skip**.

**Changed your mind?** Tap **Stop**. Songs already moved stay where they are. Later, tap **Try again**. It picks up where it stopped and never makes a second copy of a playlist.

### Extras

- **Add to a playlist you already have.** Songs that are already in it are skipped, so nothing goes in twice.
- **Keep a playlist copied.** Tap **Keep in sync** after a move. Once a day, new songs get copied too. It only adds songs. It never deletes any.
- **Back up to a file.** Save your playlists on your own device.
- **Premium (optional).** Pay to keep more playlists copied and run more moves at once. The free plan stays free. Stripe handles the payment, so we never see your card.

---

## Good to know before you start

We are still in a **testing phase**, so a few things are limited right now:

- **Spotify:** only **5 people** can use the app while it is in test mode.
- **Sign-in emails:** until the app has its own web address for email, the sign-in email may only reach the app's owner.
- **YouTube Music:** Google only lets us add about **60 songs a day** to YouTube. This is for everyone together. Big moves pause and finish the next day.

## Keeping you safe

- We never see or save your music app passwords.
- The keys we get from music apps are **locked** (encrypted) before we save them.
- We only move song **names**. We never copy the music itself.
- Old song lists are deleted after 30 days.
- We measure visits and page speed with Vercel Web Analytics and Speed Insights. They use no cookies. The sign-in page is not measured, because its link carries a secret.
- You can delete your account and all your data with one button.

## How we find each song

We try three ways, in this order:

1. **The song's ID code.** Most songs have a special code, like a barcode. It is called an **ISRC**. If both apps know the code, it is a sure match.
2. **The same name and singer.** We clean up the name first, so "Hello (Remastered)" and "Hello" count as the same song.
3. **A name that is almost the same.** If the names are very close, we call it a match. If they are only a little close, we mark it **Need a look**.

---
---

# For people who build and run it

Everything below is for the person who sets up, changes or hosts the app. If you only want to move your music, you can stop reading here.

## What is in this folder

| Folder | What is inside |
|---|---|
| `docs/` | The plans for the app. Start here to learn how it was designed. |
| `app/` | The app people see (React). `app/src/pages/` has one file per screen. |
| `scripts/` | Helpers, like the one that draws the app icons. |
| `src/` | The code that runs on the server. |
| `migrations/` | The setup for the database (where we keep data). |
| `test/` | Checks that make sure the code works. |

## Try it on your own computer

You need **Node.js 22** installed. Get the code, then type these lines one at a time:

```bash
git clone https://github.com/djbatalona06/mixnmatch.git
cd mixnmatch
npm install
cp .env.example .env.local
```

Now make a secret key. Type this:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy what it prints. Open the file `.env.local`. Paste it after `TOKEN_KEY=`. Do the same for `CRON_SECRET=` (use a new key).

Then type:

```bash
npm run db:migrate
npm run dev
```

The first time, `vercel dev` asks you to link the project to your Vercel account. Answer the questions. Then open **http://127.0.0.1:8787** in your web browser.

`npm run dev` builds the app first. After you change a file in `app/src/`, stop it and start it again, or use the faster way below.

**Want instant updates while you change how screens look?** Keep `npm run dev` running, and in a second window type `npm run dev:app`. Then open **http://127.0.0.1:5173**. Changes show up as soon as you save. (Connecting a music app sends you back to port 8787. That is normal.)

**Good to know:** on your computer you do not need real music accounts.
- The sign-in link shows up on the screen. No email is sent.
- There is a pretend music app called **Demo Music**. You can test everything with it.
- The database is a small file in `.data/`. Delete that folder to start fresh.
- Transfers move forward when the cron runs. To push them on by hand, type:
  `curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://127.0.0.1:8787/api/cron/tick`

## Run the checks

| Command | What it does |
|---|---|
| `npm test` | Quick checks on the code. Also checks the Vercel setup, the analytics tags and the cron lock. |
| `npm run typecheck` | Looks for typing mistakes in the code. |
| `npm run smoke` | Opens a robot web browser and clicks through the whole app. Needs `npm run dev` running in another window. |
| `npm run layout:check` | Opens every screen at phone, tablet and desktop size and measures it: nothing sticks out sideways, edges line up, buttons are big enough to tap, nothing hides under the bottom tabs. Needs nothing else running. Open `test-results/layout/report.html` to see the screenshots, and [docs/layout-board.html](docs/layout-board.html) for the plan of each screen. |
| `npm run smoke:deploy -- https://mixnmatch-gilt.vercel.app` | Checks the **live** site: the pages, the API, the security headers and the analytics. It only reads, so it is safe to run any time. A GitHub workflow runs it after every deploy. |

## Put it on the internet

mix n match runs on **Vercel** (the website and the server). The database is **Turso**. Both have free plans, but the transfer check needs the **Vercel Pro** plan (see Limits below).

**Step 1.** Import this GitHub repo at vercel.com/new. Vercel builds it and gives you a web address. Every push to `main` makes a new live version.

**Step 2.** Add the database. In your Vercel project, open **Storage** (or the Marketplace) and add **Turso**. It sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for you. Every build then creates any new database tables on its own.

**Step 3.** Add your secrets under **Settings, then Environment Variables**:
- `TOKEN_KEY`: a secret key (make one the same way as above).
- `CRON_SECRET`: another new secret key. Vercel sends it with every cron call, so nobody else can run the cron.

**Step 4.** Turn on **Web Analytics** and **Speed Insights** in the project. Both are free and use no cookies.

**Step 5.** Check the live site: `npm run smoke:deploy -- https://mixnmatch-gilt.vercel.app`

## Turn on each music app

Each music app needs its own "developer app". This gives mix n match permission to talk to it.

For each one:
1. Go to the website in the table.
2. Make a new app.
3. Where it asks for a **redirect URL**, paste the link from the table. (If you host your own copy, swap `mixnmatch-gilt.vercel.app` for your own web address.)
4. It gives you keys. Save each key as an environment variable in Vercel (Settings, then Environment Variables).

| Music app | Where to go | Redirect URL | Keys to save |
|---|---|---|---|
| Spotify | developer.spotify.com/dashboard | `https://mixnmatch-gilt.vercel.app/api/callback/spotify` | `SPOTIFY_CLIENT_ID` |
| TIDAL | developer.tidal.com | `https://mixnmatch-gilt.vercel.app/api/callback/tidal` | `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET` |
| Deezer | developers.deezer.com/myapps | `https://mixnmatch-gilt.vercel.app/api/callback/deezer` | `DEEZER_APP_ID`, `DEEZER_SECRET` |
| YouTube | console.cloud.google.com (turn on "YouTube Data API v3") | `https://mixnmatch-gilt.vercel.app/api/callback/youtube` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| SoundCloud | soundcloud.com/you/apps (may need approval) | `https://mixnmatch-gilt.vercel.app/api/callback/soundcloud` | `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET` |
| Email | resend.com (you need your own web address) | none | `RESEND_API_KEY` |

### Turn on Premium (optional)

1. Make a Stripe account. Stay in **test mode** first.
2. Make a product with a monthly price (and a yearly one if you want). Copy each **price id** (it starts with `price_`).
3. Add a webhook pointing to `https://mixnmatch-gilt.vercel.app/api/billing/webhook`. Pick these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Turn on the **Customer Portal** in Stripe's settings.
5. Save the keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, and (optional) `STRIPE_PRICE_YEARLY`.

Premium only shows up once these keys are saved. Have a lawyer check the terms before you charge real money.

## Limits to know about

- **Vercel Pro is needed for transfers.** The free Hobby plan runs scheduled jobs only once a day. Transfers then wait up to a day between steps, and the deploy may be refused. Pro runs the check every minute.
- **Spotify:** in test mode, only **5 people** can use your app. The app owner needs **Spotify Premium**.
- **YouTube:** Google only lets us add about **60 songs a day** to YouTube, for everyone together.
- **Email:** sign-in emails only reach *you* until you own a web address.
