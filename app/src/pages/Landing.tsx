// Welcome screen for people who are not signed in.
import { Link } from "react-router-dom";
import { buttonClass, PlatformDot } from "../components/ui";

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
    <div className="space-y-24 pb-8">
      <section className="grid items-center gap-12 pt-6 md:grid-cols-[1.25fr_1fr] md:pt-14">
        <div className="space-y-7">
          <h1 className="hero-rise text-5xl font-semibold leading-[1.02] tracking-tighter sm:text-7xl">
            Take your music <span className="text-accent">anywhere.</span>
          </h1>
          <p className="hero-rise hero-rise-2 max-w-[48ch] text-lg leading-relaxed text-muted">
            One app for all your music apps. Move playlists and liked songs between Spotify, TIDAL, Deezer, YouTube Music and SoundCloud, then keep them in
            sync every day.
          </p>
          <div className="hero-rise hero-rise-3 flex flex-wrap gap-3">
            <Link to="/login" className={buttonClass("primary", "big")}>
              Get started, it's free
            </Link>
            <a href="#how" className={buttonClass("ghost", "big")}>
              How it works
            </a>
          </div>
        </div>
        {/* overflow-hidden: a turning disc's corners swing past the box, which would add a sideways scrollbar on phones. */}
        <div aria-hidden className="hero-rise hero-rise-2 mx-auto aspect-square w-full max-w-sm overflow-hidden p-6">
          <div className="relative h-full w-full">
            <div className="record turn-slow absolute left-0 top-0 h-[78%] w-[78%] opacity-90">
              <div className="absolute inset-[31%] rounded-full border border-line-strong bg-raised" />
            </div>
            <div className="record turn-slow absolute bottom-0 right-0 h-[78%] w-[78%] [animation-direction:reverse]">
              <div className="record-label" />
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="grid scroll-mt-6 gap-10 md:grid-cols-[1fr_1.6fr]">
        <div className="space-y-3 md:sticky md:top-24 md:self-start">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <p className="max-w-[34ch] text-muted">Four taps from one music app to another. Nothing to install on your music apps.</p>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="grid grid-cols-[3rem_1fr] gap-4 py-6">
              <span className="text-2xl font-medium tabular-nums text-accent">{i + 1}</span>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="max-w-[52ch] text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-5">
        <h2 className="text-3xl font-semibold tracking-tight">Works with</h2>
        <div className="flex flex-wrap gap-3">
          {SERVICES.map(([id, name]) => (
            <span key={id} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold shadow-soft">
              <PlatformDot id={id} /> {name}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight">Your music, your data</h2>
        <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {PROMISES.map(([title, text]) => (
            <div key={title} className="space-y-1.5 border-t border-line pt-5">
              <dt className="text-lg font-semibold">{title}</dt>
              <dd className="max-w-[44ch] text-muted">{text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
