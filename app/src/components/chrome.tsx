// The frame around every screen: header, bottom tabs, offline bar, toasts, footer, page-visit counting.
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ArrowLeftRight, House, RefreshCw, UserRound, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { cx } from "../lib/format";
import { useSession } from "../store/session";
import { useToast } from "../store/toast";
import { Button, buttonClass, Spinner } from "./ui";

const TABS = [
  { to: "/dashboard", label: "Home", icon: House },
  { to: "/transfer", label: "Move", icon: ArrowLeftRight },
  { to: "/syncs", label: "Syncs", icon: RefreshCw },
  { to: "/account", label: "Account", icon: UserRound },
];

function Logo() {
  return (
    <Link to="/" className="flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap text-lg font-bold tracking-tight">
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      mix n match
    </Link>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function OfflineBar() {
  if (useOnline()) return null;
  return (
    <div role="status" id="offline" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-bg">
      <WifiOff size={16} aria-hidden /> You're offline. mix n match needs the internet to talk to your music apps.
    </div>
  );
}

function Toasts() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div
      role="status"
      className="toast fixed inset-x-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-xl border border-line bg-raised px-4 py-3 text-center text-sm shadow-2xl md:bottom-6"
    >
      {message}
    </div>
  );
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-muted">
      <span>mix n match</span>
      <span className="flex gap-4">
        <Link to="/privacy" className="inline-flex min-h-[44px] items-center hover:text-fg">
          Privacy
        </Link>
        <Link to="/terms" className="inline-flex min-h-[44px] items-center hover:text-fg">
          Terms
        </Link>
      </span>
    </footer>
  );
}

/** Never sends the sign-in page, or any address's ?part (it can hold a sign-in token or a transfer id). */
function privateUrl<T extends { url: string }>(event: T): T | null {
  const url = new URL(event.url);
  if (url.pathname === "/login") return null;
  return { ...event, url: url.origin + url.pathname };
}

/** Vercel Web Analytics and Speed Insights: cookie-free, counted in total only. Not on the sign-in page. */
function Measure() {
  if (useLocation().pathname === "/login") return null;
  return (
    <>
      <Analytics beforeSend={privateUrl} />
      <SpeedInsights beforeSend={privateUrl} />
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Braces matter: newer browsers return a value from scrollTo, and React would treat it as a clean-up.
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Welcome, sign-in, privacy and terms: no tabs. */
export function PublicLayout() {
  const me = useSession((s) => s.me);
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col pt-[env(safe-area-inset-top)]">
      <ScrollToTop />
      <OfflineBar />
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <Logo />
        {pathname !== "/login" ? (
          <Link to={me ? "/dashboard" : "/login"} className={buttonClass("default", "small")}>
            {me ? "Open app" : "Sign in"}
          </Link>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10">
        <Outlet />
      </main>
      <Footer />
      <Toasts />
      <Measure />
    </div>
  );
}

/** Every signed-in screen: header (desktop tabs) + bottom tabs on phones. */
export function AppLayout() {
  const { me, error, load, signOut } = useSession();
  useEffect(() => {
    if (!me) load();
  }, [me, load]);

  return (
    <div className="flex min-h-screen flex-col pt-[env(safe-area-inset-top)]">
      <ScrollToTop />
      <OfflineBar />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cx("rounded-full px-4 py-2 text-sm font-semibold transition", isActive ? "bg-raised text-accent" : "text-muted hover:text-fg")
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            {me ? (
              <span className="hidden max-w-[16rem] truncate text-sm text-muted lg:block" title={me.email}>
                {me.email}
              </span>
            ) : null}
            <Button size="small" variant="ghost" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:pb-10">
        {me ? (
          <Outlet />
        ) : error ? (
          <p className="text-muted">{error}</p>
        ) : (
          <p className="text-muted">
            <Spinner /> Loading…
          </p>
        )}
      </main>
      <div className="hidden md:block">
        <Footer />
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx("flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold", isActive ? "text-accent" : "text-muted")
              }
            >
              <Icon size={22} aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Toasts />
      <Measure />
    </div>
  );
}
