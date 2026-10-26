// Privacy and Terms. Drafts: a lawyer should review both before launch.

const Draft = () => <p className="text-muted">Draft — have a lawyer review this before launch. Last updated: October 2026.</p>;

export function Privacy() {
  return (
    <article className="prose-page mx-auto max-w-3xl pt-4">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <Draft />

      <h2>What we keep</h2>
      <ul>
        <li>
          <strong>Your email address</strong>, so you can sign in.
        </li>
        <li>
          <strong>Access keys for the music apps you connect.</strong> These let us read and create playlists for you. They are encrypted (AES-256-GCM)
          before they are saved, and the encryption key is stored separately.
        </li>
        <li>
          <strong>Transfer results</strong>: song titles, artists and match results, so you can review them. The song list of each transfer is deleted after
          30 days.
        </li>
        <li>
          <strong>A security log</strong> of sign-ins, connections and transfers. The IP address in it is removed after 30 days.
        </li>
        <li>
          <strong>Syncs you set up</strong>: which playlist is kept copied where, and a short fingerprint of each song already copied (so it is never copied
          twice). Deleted when you delete the sync.
        </li>
        <li>
          <strong>If you buy Premium</strong>: your Stripe customer number and the date your paid period ends. Never your card details — Stripe handles those.
        </li>
        <li>
          <strong>On your own device</strong>: the installed app keeps its own screens and pictures so it opens quickly, and remembers if you hid the "install"
          tip. None of your music data is kept there.
        </li>
      </ul>

      <h2>What we never do</h2>
      <ul>
        <li>We never see or store your music-app passwords.</li>
        <li>We never copy, store or share any audio. We only handle song names and IDs.</li>
        <li>We never sell your data or use it for ads.</li>
        <li>We only ask the music apps for the permissions needed to read and create playlists and liked songs.</li>
      </ul>

      <h2>Your controls</h2>
      <ul>
        <li>
          <strong>Disconnect</strong> any app on Home: its access key is deleted at once. You can also remove mix n match from the app's own settings.
        </li>
        <li>
          <strong>Delete your account</strong> on the Account screen: your email, keys, syncs and transfer history are removed, and any Premium plan is
          cancelled.
        </li>
      </ul>

      <h2>Who helps us run mix n match</h2>
      <ul>
        <li>
          Vercel hosts the app and the server code. Vercel Web Analytics and Speed Insights count visits and page speed. They use no cookies, and we
          use them only in total, not to identify you. The sign-in page is not measured, because its link carries a secret.
        </li>
        <li>Turso stores the database (songs, results and account details).</li>
        <li>Resend delivers sign-in emails.</li>
        <li>Stripe handles Premium payments (only if you buy Premium).</li>
        <li>The music apps you connect (Spotify, TIDAL, Deezer, Google/YouTube, SoundCloud) receive requests made on your behalf.</li>
      </ul>

      <h2>Contact</h2>
      <p>Questions or data requests: add a contact email here before launch.</p>
    </article>
  );
}

export function Terms() {
  return (
    <article className="prose-page mx-auto max-w-3xl pt-4">
      <h1 className="text-3xl font-bold">Terms of use</h1>
      <Draft />

      <h2>Using mix n match</h2>
      <ul>
        <li>You may only connect music accounts that belong to you.</li>
        <li>mix n match moves lists of song names between apps. It does not download, copy or share music.</li>
        <li>Each music app has its own rules. mix n match works inside those rules, and an app can change or limit its service at any time.</li>
      </ul>

      <h2>Syncs</h2>
      <ul>
        <li>A sync checks the original playlist once a day and adds new songs to the copy. It never removes songs.</li>
        <li>A sync can stop if a music app asks you to reconnect, or a playlist is removed. The Syncs screen shows when that happens.</li>
      </ul>

      <h2>Premium</h2>
      <ul>
        <li>Premium is optional. The free plan stays free.</li>
        <li>
          Premium renews each month or year until you cancel. You can cancel at any time on the Account screen ("Manage or cancel"); Premium then lasts until
          the end of the period you paid for.
        </li>
        <li>Prices are shown on the payment page before you pay. Payments are handled by Stripe.</li>
        <li>Refunds: to be decided by the owner before launch.</li>
      </ul>

      <h2>No perfect promises</h2>
      <ul>
        <li>
          Song catalogs differ between apps and countries, so some songs may not be found or may match a different version. We show you every result so you can
          check.
        </li>
        <li>We are not responsible for changes made by the music apps, songs that are missing from a catalog, or actions an app takes on your account.</li>
        <li>The service is provided "as is", without warranties.</li>
      </ul>

      <h2>Ending</h2>
      <p>You can stop using mix n match and delete your account at any time on the Account screen.</p>
    </article>
  );
}
