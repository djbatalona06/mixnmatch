// Account: email, plan (Premium), install the app, back up, sign out, delete account.
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { InstallCard } from "../components/InstallCard";
import { Button, Card, Notice, PageTitle, Pill } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, plural } from "../lib/format";
import type { Me } from "../lib/types";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

function PlanCard({ me }: { me: Me }) {
  const premium = me.plan === "premium";
  const go = async (path: string, body?: unknown) => {
    try {
      const { url } = await api<{ url: string }>(path, { method: "POST", body });
      location.href = url; // Stripe's own page
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <Card className="space-y-4" id="plan">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your plan: {premium ? "Premium" : "Free"}</h2>
        <Pill tone={premium ? "ok" : ""}>{premium ? "Active" : "Free plan"}</Pill>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">
        <li>{plural(me.limits.syncs, "playlist")} kept in sync</li>
        <li>{plural(me.limits.activeTransfers, "transfer")} at the same time</li>
        <li>Up to {me.limits.fileTracks.toLocaleString()} songs per uploaded file</li>
      </ul>
      {!me.billing ? null : premium ? (
        <div className="flex flex-wrap items-center gap-3">
          {me.planUntil ? <span className="text-sm text-muted">Paid until {formatDate(me.planUntil)}.</span> : null}
          <Button size="small" onClick={() => go("/api/billing/portal")}>
            Manage or cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => go("/api/billing/checkout", { plan: "monthly" })}>
              Get Premium (monthly)
            </Button>
            {me.billing.yearly ? <Button onClick={() => go("/api/billing/checkout", { plan: "yearly" })}>Get Premium (yearly)</Button> : null}
          </div>
          <p className="text-xs text-muted">Payment is handled by Stripe. mix n match never sees your card.</p>
        </div>
      )}
    </Card>
  );
}

function LinkRow({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="flex min-h-[52px] items-center justify-between px-5 transition hover:bg-raised">
      {children}
      <ChevronRight size={18} className="text-muted" aria-hidden />
    </Link>
  );
}

export default function Account() {
  const { me, load, signOut } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [thanks] = useState(params.get("premium") === "thanks");

  useEffect(() => {
    if (params.toString()) navigate("/account", { replace: true });
  }, [params, navigate]);

  if (!me) return null;

  async function deleteAccount() {
    if (!confirm("Delete your mix n match account and all its data? This cannot be undone.")) return;
    try {
      await api("/api/me", { method: "DELETE" });
      useSession.setState({ me: null });
      location.href = "/";
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {thanks ? (
        <Notice tone="ok" role="status">
          Thank you! Premium is switched on as soon as the payment is confirmed (usually a few seconds).{" "}
          <button type="button" className="font-semibold underline" onClick={() => load()}>
            Refresh
          </button>
        </Notice>
      ) : null}
      <PageTitle title="Account" subtitle={<span className="break-all">{me.email}</span>} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PlanCard me={me} />
        <InstallCard />
      </div>

      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        <LinkRow to="/export">Back up your playlists to a file</LinkRow>
        <LinkRow to="/privacy">Privacy</LinkRow>
        <LinkRow to="/terms">Terms</LinkRow>
      </div>

      <Button className="w-full sm:w-auto" onClick={() => signOut()}>
        Sign out
      </Button>

      <Card className="space-y-3 border-bad/30">
        <h2 className="text-lg font-semibold">Delete my account</h2>
        <p className="text-sm text-muted">
          Removes your account, every connected service and all transfer history from mix n match. Your playlists inside Spotify, TIDAL, etc. are not touched.
        </p>
        <Button variant="danger" id="delete-account" onClick={deleteAccount}>
          Delete my account and data
        </Button>
      </Card>
    </div>
  );
}
