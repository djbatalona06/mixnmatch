// Back up: reads playlists page by page on the device, then saves them as a file.
// Doing the work here (not on the server) keeps every server request small and cheap.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Card, CoverCard, Notice, PageTitle, Spinner } from "../components/ui";
import { api, fetchAllPages, type Page } from "../lib/api";
import { downloadFile, plural } from "../lib/format";
import { toBackupJson, toCsv, type FileTrack } from "../lib/formats";
import { platformName } from "../lib/platforms";
import type { Playlist } from "../lib/types";
import { useSession } from "../store/session";

const LIKED = "__liked__";

export default function Export() {
  const me = useSession((s) => s.me)!;
  const [platform, setPlatform] = useState(me.connections[0]?.platform ?? "");
  const [format, setFormat] = useState<"jspf" | "csv">("jspf");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<ReactNode>("");
  const [progress, setProgress] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function load(more = false) {
    if (!platform) return;
    const base = more ? playlists : [{ id: LIKED, name: "Liked Songs" }];
    if (!more) {
      setPlaylists(base);
      setSelected(new Set());
      setNextCursor(undefined);
    }
    setStatus(
      <>
        <Spinner /> Loading…
      </>,
    );
    try {
      const q = more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const page = await api<Page<Playlist>>(`/api/library/${platform}/playlists${q}`);
      setPlaylists([...base, ...page.items]);
      setNextCursor(page.next);
      setStatus("Tap the playlists you want in your backup.");
    } catch (err) {
      setStatus((err as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download() {
    const chosen = playlists.filter((p) => selected.has(p.id));
    setWorking(true);
    try {
      const result = [];
      for (const [i, p] of chosen.entries()) {
        const path = p.id === LIKED ? `/api/library/${platform}/liked` : `/api/library/${platform}/playlists/${encodeURIComponent(p.id)}/tracks`;
        const tracks = await fetchAllPages<FileTrack>(path, (n) => setProgress(`Reading “${p.name}” (${i + 1} of ${chosen.length}): ${plural(n, "song")}…`));
        result.push({ name: p.name, tracks });
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `mixnmatch-${platform}-${stamp}`;
      if (format === "csv") downloadFile(`${base}.csv`, toCsv(result), "text/csv");
      else downloadFile(`${base}.${result.length === 1 ? "jspf" : "json"}`, toBackupJson(result), "application/json");
      const total = result.reduce((n, p) => n + p.tracks.length, 0);
      setProgress(`Saved ${plural(result.length, "playlist")} with ${plural(total, "song")}.`);
    } catch (err) {
      setProgress((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (!me.connections.length) {
    return (
      <div>
        <PageTitle title="Back up your music" />
        <p className="text-muted">
          Connect a music app first.{" "}
          <Link to="/dashboard" className="font-semibold text-accent">
            Go to Home
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Back up your music"
        subtitle="Save your playlists as a file. You can open it in a spreadsheet, keep it safe, or upload it later to move the songs to any app."
      />
      <Card className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="platform">From which app?</label>
          <select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {me.connections.map((c) => (
              <option key={c.platform} value={c.platform}>
                {platformName(c.platform)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="format">File type</label>
          <select id="format" value={format} onChange={(e) => setFormat(e.target.value as "jspf" | "csv")}>
            <option value="jspf">JSPF (best for moving back in later)</option>
            <option value="csv">CSV (opens in Excel / Google Sheets)</option>
          </select>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Pick playlists</h2>
        <Button size="small" id="select-all" onClick={() => setSelected(new Set(playlists.map((p) => p.id)))}>
          Select all
        </Button>
      </div>
      <p className="text-muted" id="pick-status">
        {status}
      </p>
      <div id="playlist-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {playlists.map((item) => (
          <CoverCard
            key={item.id}
            name={item.name}
            subtitle={item.trackCount != null ? plural(item.trackCount, "song") : "Songs"}
            imageUrl={item.imageUrl}
            liked={item.id === LIKED}
            selected={selected.has(item.id)}
            onToggle={() => toggle(item.id)}
          />
        ))}
      </div>
      {nextCursor ? (
        <Button id="load-more" onClick={() => load(true)}>
          Load more playlists
        </Button>
      ) : null}

      {progress ? (
        <Notice role="status" id="progress">
          {progress}
        </Notice>
      ) : null}
      <Button variant="primary" size="big" id="download" disabled={!selected.size || working} onClick={download}>
        Download backup
      </Button>
    </div>
  );
}
