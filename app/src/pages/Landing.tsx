// Welcome screen for people who are not signed in.
import { Link } from "react-router-dom";
import { buttonClass, Card, PlatformDot } from "../components/ui";

const STEPS = [
  ["Connect", "Log in to your music apps through their own secure pages. We never see your passwords."],
  ["Pick", "Choose the playlists and liked songs you want to move. Peek inside before you start."],
  ["Move", "We find each song on the other app and build your playlists there. Watch it happen live."],
  ["Keep in sync", "Tap once and new songs you add to the original are copied every day."],
];
const SERVICES = [
  ["spotify", "Spotify"],
  ["tidal", "TIDAL"],
  ["deezer", "Deezer"],
  ["youtube", "YouTube Music"],
  ["soundcloud", "SoundCloud"],
  ["file", "JSPF / CSV files"],
];
const PROMISES = [
  ["No passwords", "You sign in to each app on its own site. We only get a key you can cancel any time."],
  ["Locked keys", "Those keys are encrypted before they are saved."],
  ["Song names only", "We move lists of song names. We never copy or store any music."],
  ["Delete anytime", "One button removes your account and everything we know about you."],
];

export default function Landing() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 md:grid-cols-[1.3fr_1fr] md:pt-12">
        <div className="space-y-6">
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Take your music <span className="text-accent">anywhere.</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">
            One app for all your music apps. Move playlists and liked songs between Spotify, TIDAL, Deezer, YouTube Music and SoundCloud, then keep them in
            sync every day.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/login" className={buttonClass("primary", "big")}>
              Get started — it's free
            </Link>
            <a href="#how" className={buttonClass("ghost", "big")}>
              How it works
            </a>
          </div>
        </div>
        <div aria-hidden className="relative mx-auto aspect-square w-full max-w-xs">
          <div className="absolute left-0 top-0 h-3/4 w-3/4 rounded-full border-2 border-fg/80 bg-raised shadow-2xl">
            <div className="absolute inset-[42%] rounded-full bg-fg/80" />
          </div>
          <div className="absolute bottom-0 right-0 h-3/4 w-3/4 rounded-full bg-accent shadow-[0_0_80px_rgba(245,158,11,0.35)]">
            <div className="absolute inset-[42%] rounded-full bg-bg" />
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-6 space-y-4">
        <h2 className="text-2xl font-bold">How it works</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, text], i) => (
            <Card key={title} className="space-y-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-bg">{i + 1}</span>
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Works with</h2>
        <div className="flex flex-wrap gap-3">
          {SERVICES.map(([id, name]) => (
            <span key={id} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold">
              <PlatformDot id={id} /> {name}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold">Your music, your data</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map(([title, text]) => (
            <Card key={title} className="space-y-2">
              <h3 className="font-semibold">{title}</h3>
              <p className="text-sm text-muted">{text}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
