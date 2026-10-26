// Syncs: playlists kept copied once a day. Started from a finished transfer ("Keep in sync").
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, Notice, PageTitle, Pill, PlatformDot, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { formatDate, plural } from "../lib/format";
import { platformName } from "../lib/platforms";
import type { Sync } from "../lib/types";
import { toast } from "../store/toast";

const SYNC_PILL = {
  ACTIVE: ["ok", "On"],
  PAUSED: ["", "Paused"],
  NEEDS_USER: ["bad", "Needs you"],
} as const;

function lastRun(sync: Sync): string {
  if (sync.message) return sync.message;
  if (!sync.last_run_at) return `First check ${formatDate(sync.next_run_at)}`;
  const added = sync.last_added ? `added ${plural(sync.last_added, "song")}` : "nothing new";
  return `Last checked ${formatDate(sync.last_run_at)}. ${added}`;
}

export default function Syncs() {
  const [data, setData] = useState<{ syncs: Sync[]; limit: number } | null>(null);

  const refresh = useCallback(() => {
    api<{ syncs: Sync[]; limit: number }>("/api/syncs")
      .then(setData)
      .catch((err) => toast(err.message));
  }, []);
  useEffect(refresh, [refresh]);

  async function setStatus(sync: Sync, status: "ACTIVE" | "PAUSED") {
    try {
      await api(`/api/syncs/${sync.id}`, { method: "PATCH", body: { status } });
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function remove(sync: Sync) {
    if (!confirm(`Stop keeping “${sync.name}” in sync? The copied playlist stays where it is.`)) return;
    try {
      await api(`/api/syncs/${sync.id}`, { method: "DELETE" });
      toast("Sync deleted");
      refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Syncs" subtitle="Once a day, new songs in the original playlist are copied to the other app. Syncs only ever add songs." />
      <Notice>
        To start one: move a playlist, then tap <strong>Keep in sync</strong> on its results.
      </Notice>
      <div id="syncs" className="space-y-3">
        {data === null ? (
          <div className="space-y-3" role="status" aria-label="Loading">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !data.syncs.length ? (
          <EmptyState
            action={
              <Link to="/transfer" className="font-semibold text-accent hover:text-accent-hover">
                Move a playlist
              </Link>
            }
          >
            No syncs yet. You can keep {plural(data.limit, "playlist")} in sync.
          </EmptyState>
        ) : (
          data.syncs.map((sync) => {
            const [tone, label] = SYNC_PILL[sync.status] ?? ["", sync.status];
            const paused = sync.status === "PAUSED";
            return (
              <Card key={sync.id} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">
                      {sync.last_job_id ? (
                        <Link to={`/results?job=${sync.last_job_id}`} className="hover:text-accent">
                          {sync.name}
                        </Link>
                      ) : (
                        sync.name
                      )}
                    </h2>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                      <PlatformDot id={sync.source} /> {platformName(sync.source)} → <PlatformDot id={sync.dest} /> {platformName(sync.dest)}
                    </p>
                  </div>
                  <Pill tone={tone}>{label}</Pill>
                </div>
                <p className="text-sm text-muted">{lastRun(sync)}</p>
                <div className="flex gap-2">
                  <Button size="small" onClick={() => setStatus(sync, paused ? "ACTIVE" : "PAUSED")}>
                    {paused ? "Resume" : "Pause"}
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => remove(sync)}>
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
      {data && data.syncs.length > 0 ? <p className="text-sm text-muted">Your plan allows {plural(data.limit, "sync")}.</p> : null}
    </div>
  );
}
