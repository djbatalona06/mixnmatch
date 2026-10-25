// Home: connected music services and recent transfers.
import { ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { InstallBanner } from "../components/InstallCard";
import { buttonClass, Button, Card, Notice, PageTitle, Pill, PlatformDot, Spinner, type Tone } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { platformName } from "../lib/platforms";
import { JOB_PILL, type JobSummary, type Me } from "../lib/types";
import { useSession } from "../store/session";
import { toast } from "../store/toast";

const ERRORS: Record<string, string> = {
  denied: "You cancelled the connection, so nothing was changed.",
  expired: "That took too long. Please try connecting again.",
  failed: "We couldn't finish connecting. Please try again.",
};

/** The note shown after coming back from a music app's sign-in page. */
function useFlash(): [Tone, string] | null {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [flash] = useState<[Tone, string] | null>(() => {
    if (params.get("connected")) return ["ok", `${platformName(params.get("connected")!)} is connected.`];
    if (params.get("error")) return ["bad", `${platformName(params.get("platform") ?? "")}: ${ERRORS[params.get("error")!] ?? "Something went wrong."}`];
    return null;
  });
  useEffect(() => {
    if (params.toString()) navigate("/dashboard", { replace: true });
  }, [params, navigate]);
  return flash;
}

function ServiceCard({ platform, connection, onChange }: { platform: Me["platforms"][number]; connection?: Me["connections"][number]; onChange: () => void }) {
  async function disconnect() {
    if (!confirm(`Disconnect ${platform.name}? mix n match will forget its access key. Your music on ${platform.name} is not changed.`)) return;
    try {
      await api(`/api/connections/${platform.id}`, { method: "DELETE" });
      toast(`${platform.name} disconnected`);
      onChange();
    } catch (err) {
      toast((err as Error).message);
    }
  }
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2 font-semibold">
        <PlatformDot id={platform.id} className="h-3 w-3" />
        {platform.name}
      </div>
      {!platform.configured ? (
        <>
          <p className="text-sm text-muted">Not switched on for this server yet.</p>
          <Button size="small" disabled className="self-start">
            Coming soon
          </Button>
        </>
      ) : connection ? (
        <>
          <p className="truncate text-sm text-muted">Connected as {connection.accountName ?? "your account"}</p>
          <div className="flex items-center gap-2">
            <Pill tone="ok">Connected</Pill>
            <Button size="small" variant="ghost" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">Not connected</p>
          {/* A real page visit (not an in-app link): the server sends you to the music app's own sign-in page. */}
          <a className={buttonClass("primary", "small", "self-start")} href={`/api/connect/${platform.id}`}>
            Connect {platform.name}
          </a>
        </>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { me, load } = useSession();
  const flash = useFlash();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    load();
    api<{ jobs: JobSummary[] }>("/api/jobs")
      .then((r) => setJobs(r.jobs))
      .catch((err) => toast(err.message));
  }, [load]);

  if (!me) return null;
  const byPlatform = Object.fromEntries(me.connections.map((c) => [c.platform, c]));
  const canTransfer = me.connections.length > 0;

  return (
    <div className="space-y-10">
      {flash ? (
        <Notice tone={flash[0]} role="status" id="flash">
          {flash[1]}
        </Notice>
      ) : null}
      <InstallBanner />

      <PageTitle title="Your music" subtitle="Connect the apps you use, then move playlists between them.">
        {canTransfer ? (
          <Link id="start-transfer" to="/transfer" className={buttonClass("primary", "big")}>
            Start a transfer
          </Link>
        ) : null}
        <Link to="/export" className={buttonClass("default", "big")}>
          Back up to a file
        </Link>
      </PageTitle>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Music services</h2>
        <div id="services" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {me.platforms.map((p) => (
            <ServiceCard key={p.id} platform={p} connection={byPlatform[p.id]} onChange={load} />
          ))}
        </div>
      </section>

      <Link to="/syncs" className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 transition hover:border-neutral-600">
        <RefreshCw className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Syncs</span>
          <span className="block text-sm text-muted">Playlists kept copied between your apps every day.</span>
        </span>
        <ChevronRight className="shrink-0 text-muted" aria-hidden />
      </Link>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Recent transfers</h2>
        {jobs === null ? (
          <p className="text-muted">
            <Spinner /> Loading…
          </p>
        ) : !jobs.length ? (
          <p className="text-muted">No transfers yet.</p>
        ) : (
          <ul id="jobs" className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {jobs.map((job) => {
              const [tone, label] = JOB_PILL[job.status] ?? ["", job.status];
              return (
                <li key={job.id}>
                  <Link to={`/results?job=${job.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{job.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {platformName(job.source)} → {platformName(job.dest)} · {formatDate(job.created_at)}
                      </span>
                    </span>
                    <Pill tone={tone}>{label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
