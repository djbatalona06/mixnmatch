# mix n match

mix n match moves your songs from one music app to another.

Say you use Spotify, but you want to switch to TIDAL. You have lots of playlists. You do not want to find every song again by hand. mix n match does it for you.

It works with **Spotify**, **TIDAL**, **Deezer**, **YouTube Music**, and **SoundCloud**.
It can also save your playlists in a file, so you have a backup.

It is **one app**. You can put it on your phone's home screen, like any other app:
- **Android / Chrome / Edge:** tap **Install app** on the Account screen.
- **iPhone:** in Safari, tap **Share**, then **Add to Home Screen**.

---

## What it does

1. **You sign in with your email.** We send you a link. You click it. That's it. No password.
2. **You connect your music apps.** You log in on the music app's own page. We never see your password.
3. **You pick playlists.** You can peek inside each one first.
4. **We move the songs.** We look for each song in the new app.
5. **You see what happened.** Every song gets a label:
   - ✅ **Matched** — we found it and added it.
   - ⚠️ **Need a look** — we were not sure, so we did not add it. You can check it.
   - ❌ **Not found** — the new app does not have it.
6. **You fix the unsure ones.** Tap **Fix** on a song. Pick the right one from a short list. Or tap **Skip**.
7. **Changed your mind?** Tap **Stop**. Songs already moved stay. Later, tap **Try again**. It picks up where it stopped. It never makes a second playlist.

## Extra things it can do

- **Add to a playlist you already have.** Songs that are already in it are skipped. Nothing goes in twice.
- **Keep a playlist copied.** Tap **Keep in sync** after a move. Once a day, new songs get copied too. It only adds songs. It never deletes any.
- **Premium (optional).** Pay to keep more playlists copied and run more moves at once. The free plan stays free. Stripe handles the payment, so we never see your card.

---

## How we find each song

We try three ways, in this order:

1. **The song's ID code.** Most songs have a special code, like a barcode. It is called an **ISRC**. If both apps know the code, it is a sure match.
2. **The same name and singer.** We clean up the name first. So "Hello (Remastered)" and "Hello" count as the same song.
3. **A name that is almost the same.** If the names are very close, we call it a match. If they are only a little close, we mark it "Need a look."

---

## What is in this folder

| Folder | What is inside |
|---|---|
| `docs/` | The plans for the app. Start here to learn how it was designed. |
| `app/` | The app people see (React). `app/src/pages/` has one file per screen. |
| `scripts/` | Helpers, like the one that draws the app icons. |
| `src/` | The code that runs on the server. |
| `migrations/` | The setup for the database (where we keep data). |
| `test/` | Checks that make sure the code works. |

---

## Try it on your own computer

You need **Node.js** installed. Then type these lines, one at a time:

```bash
npm install
cp .dev.vars.example .dev.vars
```

Now make a secret key. Type this:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy what it prints. Open the file `.dev.vars`. Paste it after `TOKEN_KEY=`.

Then type:

```bash
npm run db:migrate:local
npm run dev
```

Open **http://localhost:8787** in your web browser.

`npm run dev` builds the app first. When you save a file in `app/src/`, it builds again by itself. Then refresh the browser.

**Want instant updates while you change how screens look?** Keep `npm run dev` running, and in a second window type `npm run dev:app`. Then open **http://127.0.0.1:5173**. Changes show up as soon as you save. (Connecting a music app sends you back to port 8787. That is normal.)

**Good to know:** On your computer, you do not need real music accounts.
- The sign-in link shows up on the screen. No email is sent.
- There is a pretend music app called **Demo Music**. You can test everything with it.

---

## Run the checks

```bash
npm test
```
This runs quick checks on the code.

```bash
npm run typecheck
```
This looks for typing mistakes in the code.

```bash
npm run smoke
```
This opens a robot web browser and clicks through the whole app.
It needs `npm run dev` to be running in another window.

```bash
npm run layout:check
```
This opens every screen at phone, tablet and desktop size and measures it: nothing sticks out sideways, the edges line up, buttons are big enough to tap, and nothing hides under the bottom tabs. It needs nothing else running. Open `test-results/layout/report.html` to see the screenshots, and [docs/layout-board.html](docs/layout-board.html) for the plan of each screen.

---

## Put it on the internet

mix n match runs on **Cloudflare**. The free plan is enough.

**Step 1.** Log in to Cloudflare:
```bash
npx wrangler login
```

**Step 2.** Make the database:
```bash
npx wrangler d1 create mixnmatch
```
It prints a `database_id`. Copy it into the file `wrangler.jsonc`.

**Step 3.** Save your secret key (make one the same way as above):
```bash
npx wrangler secret put TOKEN_KEY
```

**Step 4.** Send it live:
```bash
npm run deploy
```

---

## Turn on each music app

Each music app needs its own "developer app." This gives mix n match permission to talk to it.

For each one:
1. Go to the website in the table.
2. Make a new app.
3. Where it asks for a **redirect URL**, put the link from the table. Change `<your-site>` to your real web address.
4. It gives you keys. Save each key with `npx wrangler secret put NAME`.

| Music app | Where to go | Redirect URL | Keys to save |
|---|---|---|---|
| Spotify | developer.spotify.com/dashboard | `https://<your-site>/api/callback/spotify` | `SPOTIFY_CLIENT_ID` |
| TIDAL | developer.tidal.com | `https://<your-site>/api/callback/tidal` | `TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET` |
| Deezer | developers.deezer.com/myapps | `https://<your-site>/api/callback/deezer` | `DEEZER_APP_ID`, `DEEZER_SECRET` |
| YouTube | console.cloud.google.com (turn on "YouTube Data API v3") | `https://<your-site>/api/callback/youtube` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| SoundCloud | soundcloud.com/you/apps (may need approval) | `https://<your-site>/api/callback/soundcloud` | `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET` |
| Email | resend.com (you need your own web address) | — | `RESEND_API_KEY` |

### Turn on Premium (optional)

1. Make a Stripe account. Stay in **test mode** first.
2. Make a product with a monthly price (and a yearly one if you want). Copy each **price id** (it starts with `price_`).
3. Add a webhook pointing to `https://<your-site>/api/billing/webhook`. Pick these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
4. Turn on the **Customer Portal** in Stripe's settings.
5. Save the keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, and (optional) `STRIPE_PRICE_YEARLY`.

Premium only shows up once these keys are saved. Have a lawyer check the terms before you charge real money.

---

## Limits to know about

- **Spotify:** In test mode, only **5 people** can use your app. The app owner needs **Spotify Premium**.
- **YouTube:** Google only lets us add about **60 songs a day** to YouTube. This is for everyone together. Big moves pause and finish the next day.
- **Email:** Sign-in emails only reach *you* until you own a web address.

---

## Keeping you safe

- We never see or save your music app passwords.
- The keys we get from music apps are **locked** (encrypted) before we save them.
- We only move song **names**. We never copy the music itself.
- Old song lists are deleted after 30 days.
- You can delete your account and all your data with one button.
