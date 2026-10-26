// Live progress for one transfer, the per-song results, and the actions on it:
// Stop, Try again, Fix a song by hand, Skip, and Keep in sync.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { buttonClass, Button, Card, Dialog, Notice, Pill, Spinner, type Tone } from "../components/ui";
import { api } from "../lib/api";
import { cx, downloadFile, plural } from "../lib/format";
import { toCsv } from "../lib/formats";
import { platformName } from "../lib/platforms";
import { JOB_PILL, type Item, type Job, type JobPlaylist, type Song } from "../lib/types";
import { toast } from "../store/toast";

const POLL_MS = 2000;
const FINISHED = ["DONE", "FAILED", "CANCELLED"];
const FIXABLE = ["LOW_CONFIDENCE", "FAILED", "SKIPPED"];

const RESULT_LABEL: Record<string, [Tone, string]> = {
  PENDING: ["", "Waiting"],
  MATCHED: ["ok", "Matched"],
  LOW_CONFIDENCE: ["warn", "Need a look"],
  FAILED: ["bad", "Not found"],
  SKIPPED: ["", "Skipped"],
};
const METHOD_LABEL: Record<string, string> = {
  isrc: "exact recording code (ISRC)",
  exact: "same title and artist",
  fuzzy_jaro_winkler: "similar title and artist",
  cache: "remembered match",
  manual: "picked by you",
  none: "",
};
const TABS: { label: string; status?: string; already?: boolean }[] = [
  { label: "All", status: "" },
  { label: "Matched", status: "MATCHED" },
  { label: "Need a look", status: "LOW_CONFIDENCE" },
  { label: "Not found", status: "FAILED" },
  { label: "Already there", already: true },
  { label: "Skipped", status: "SKIPPED" },
];

// ---------- what the progress card says ----------

function progress(job: Job) {
  const c = job.counts;
  const checked = job.total - c.PENDING;
  // Progress = half for checking songs, half for adding the matched ones.
  const handled = job.written + job.alreadyThere;
  let percent = 0;
  if (job.status === "DONE") percent = 100;
  else if (job.total) percent = Math.round(((checked / job.total) * 0.5 + (c.MATCHED ? handled / c.MATCHED : 0) * 0.5) * 100);
  percent = Math.min(100, percent);

  let phase = "Reading your songs…";
  if (job.status === "DONE") phase = "All done!";
  else if (job.status === "FAILED") phase = "Stopped by a problem";
  else if (job.status === "CANCELLED") phase = "Stopped";
  else if (job.status === "WAITING") phase = "Paused for a moment";
  else if (checked < job.total) phase = `Finding songs on ${platformName(job.dest)}… (${checked.toLocaleString()} of ${job.total.toLocaleString()})`;
  else if (job.total) phase = `Adding songs to ${platformName(job.dest)}…`;

  let message = job.message ?? "";
  if (job.status === "CANCELLED") {
    message = job.written
      ? `Stopped. The ${plural(job.written, "song")} already added will stay in your ${job.playlists.length > 1 ? "playlists" : "playlist"}.`
      : "Stopped before any songs were added. Nothing was changed.";
  }
  return { percent, phase, message };
}

function summaryText(job: Job) {
  if (!job.written && !job.alreadyThere) return "";
  const where = job.playlists.length === 1 && job.playlists[0].kind === "playlist" ? ` to ${job.playlists[0].name}` : "";
  const added = `Added ${plural(job.written, "song")}${where}.`;
  return job.alreadyThere ? `${added} ${plural(job.alreadyThere, "song")} ${job.alreadyThere === 1 ? "was" : "were"} already there.` : added;
}

// ---------- one song ----------

function ItemRow({ item, finished, onFix }: { item: Item; finished: boolean; onFix: (item: Item) => void }) {
  let [tone, label] = RESULT_LABEL[item.status] ?? ["", item.status];
  if (item.written === 2) [tone, label] = ["", "Already there"];
  if (item.status === "PENDING" && finished) label = "Not checked yet";
  const confidence = item.confidence && item.method !== "manual" ? ` · ${Math.round(item.confidence * 100)}% sure` : "";
  const canFix = FIXABLE.includes(item.status) && item.written === 0;
  return (
    <li data-id={item.id} tabIndex={-1} className="flex gap-3 px-4 py-3 focus-visible:ring-inset">
      <span className="w-8 shrink-0 pt-0.5 text-right text-sm text-muted">{item.position + 1}</span>
      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-2 sm:gap-4">
        <div className="min-w-0">
          <div className="truncate">{item.src_title}</div>
          <div className="truncate text-xs text-muted">{item.src_artist}</div>
        </div>
        <div className="min-w-0 text-sm">
          {item.dest_title ? (
            <>
              <div className="truncate">
                <span className="text-muted sm:hidden">→ </span>
                {item.dest_title}
              </div>
              <div className="truncate text-xs text-muted">{item.dest_artist ?? ""}</div>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <Pill tone={tone}>{label}</Pill>
        <span className="max-w-[9rem] text-[11px] leading-tight text-muted">
          {METHOD_LABEL[item.method ?? ""] ?? ""}
          {confidence}
        </span>
        {canFix ? (
          <Button size="small" className="fix-btn" aria-label={`Fix ${item.src_title}`} onClick={() => onFix(item)}>
            Fix
          </Button>
        ) : null}
      </div>
    </li>
  );
}

// ---------- the screen ----------

export default function Results() {
  const [params] = useSearchParams();
  const jobId = params.get("job");
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [tab, setTab] = useState(0);
  const [pollKey, setPollKey] = useState(0);
  const [itemsKey, setItemsKey] = useState(0);
  const [includeUnsure, setIncludeUnsure] = useState(false);
  const [busy, setBusy] = useState<"stop" | "retry" | null>(null);
  const [synced, setSynced] = useState<Set<number>>(new Set());
  const wasFinished = useRef<boolean | null>(null);
  const itemsRequest = useRef(0);

  const finished = !!job && FINISHED.includes(job.status);

  const refreshJob = useCallback(async () => {
    const j = await api<Job>(`/api/jobs/${jobId}`);
    setJob(j);
    const done = FINISHED.includes(j.status);
    // Just finished: reload the song list so every row shows its final result.
    if (done && wasFinished.current === false) setItemsKey((k) => k + 1);
    wasFinished.current = done;
    return done;
  }, [jobId]);

  // Ask the server every 2 seconds until the transfer has finished.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (await refreshJob()) return;
      } catch (err) {
        if (alive) toast((err as Error).message);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId, pollKey, refreshJob]);

  const fetchItems = useCallback(
    (offset: number) => {
      const q = new URLSearchParams({ offset: String(offset) });
      const t = TABS[tab];
      if (t.status) q.set("status", t.status);
      if (t.already) q.set("filter", "already");
      return api<{ items: Item[]; hasMore: boolean }>(`/api/jobs/${jobId}/items?${q}`);
    },
    [jobId, tab],
  );

  useEffect(() => {
    if (!jobId) return;
    const request = ++itemsRequest.current;
    setItems(null);
    fetchItems(0)
      .then((page) => {
        if (request !== itemsRequest.current) return;
        setItems(page.items);
        setHasMore(page.hasMore);
      })
      .catch((err) => toast(err.message));
  }, [jobId, fetchItems, itemsKey]);

  async function showMore() {
    const page = await fetchItems(items?.length ?? 0);
    setItems((list) => [...(list ?? []), ...page.items]);
    setHasMore(page.hasMore);
  }

  const replaceItem = (updated: Item) => setItems((list) => list?.map((i) => (i.id === updated.id ? updated : i)) ?? null);

  // ---------- Stop / Try again ----------

  async function stop() {
    if (!confirm("Stop moving songs? Songs already added will stay.")) return;
    setBusy("stop");
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      await refreshJob();
      setItemsKey((k) => k + 1);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      await api(`/api/jobs/${jobId}/retry`, { method: "POST", body: { includeUnsure } });
      toast("Trying again…");
      // Show "running" straight away, so the old "All done" can't be acted on in the meantime.
      wasFinished.current = false;
      setJob((j) => (j ? { ...j, status: "QUEUED", message: null } : j));
      setPollKey((k) => k + 1);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ---------- Keep in sync ----------

  async function keepInSync(playlist: JobPlaylist) {
    try {
      await api("/api/syncs", { method: "POST", body: { jobId, selIndex: playlist.sel_index } });
      setSynced((s) => new Set(s).add(playlist.sel_index));
      toast("Done! New songs will be copied once a day. See the Syncs tab.");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  // ---------- Fix a song by hand ----------

  const [fixing, setFixing] = useState<Item | null>(null);
  const [query, setQuery] = useState("");
  const [searchNote, setSearchNote] = useState<ReactNode>("");
  const [found, setFound] = useState<Song[]>([]);
  const fixingRef = useRef<Item | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const youtube = job?.dest === "youtube";

  async function runSearch(item: Item, q: string) {
    setSearchNote(
      <>
        <Spinner /> Searching…
      </>,
    );
    try {
      const { results } = await api<{ results: Song[] }>(`/api/jobs/${jobId}/items/${item.id}/search?q=${encodeURIComponent(q.trim())}`);
      if (fixingRef.current?.id !== item.id) return;
      setSearchNote(results.length ? plural(results.length, "result") : "No songs found. Try different words.");
      setFound(results);
    } catch (err) {
      if (fixingRef.current?.id === item.id) setSearchNote((err as Error).message);
    }
  }

  function openFix(item: Item) {
    const q = `${item.src_title} ${item.src_artist}`.slice(0, 200);
    fixingRef.current = item;
    setFixing(item);
    setQuery(q);
    setFound([]);
    setSearchNote("");
    if (!youtube) runSearch(item, q); // YouTube searches cost a lot: only search when asked
  }

  function onQuery(q: string) {
    setQuery(q);
    if (youtube || !fixing) return;
    clearTimeout(searchTimer.current);
    const item = fixing;
    searchTimer.current = setTimeout(() => runSearch(item, q), 400);
  }

  function onFixClosed() {
    const id = fixingRef.current?.id;
    clearTimeout(searchTimer.current);
    fixingRef.current = null;
    setFixing(null);
    // Focus goes back to the song's row if its Fix button is gone (fixed or skipped).
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLElement>(`#items [data-id="${id}"]`)?.focus();
    });
  }

  async function pickSong(song: Song) {
    const item = fixing!;
    try {
      const res = await api<{ written: 0 | 1 | 2; note?: string }>(`/api/jobs/${jobId}/items/${item.id}/fix`, {
        method: "POST",
        body: { destId: song.id, destTitle: song.title, destArtist: song.artist },
      });
      replaceItem({ ...item, status: "MATCHED", method: "manual", confidence: 1, dest_title: song.title, dest_artist: song.artist, written: res.written });
      toast(res.written === 2 ? "That song is already in the playlist." : (res.note ?? (res.written ? "Added!" : "Saved. It will be added in a moment.")));
      setFixing(null);
      refreshJob().catch(() => {});
    } catch (err) {
      setSearchNote((err as Error).message);
    }
  }

  async function skip() {
    const item = fixing!;
    try {
      await api(`/api/jobs/${jobId}/items/${item.id}/skip`, { method: "POST" });
      replaceItem({ ...item, status: "SKIPPED" });
      setFixing(null);
      refreshJob().catch(() => {});
    } catch (err) {
      setSearchNote((err as Error).message);
    }
  }

  // ---------- CSV of songs to check ----------

  async function downloadMissing() {
    const rows: Item[] = [];
    for (const status of ["LOW_CONFIDENCE", "FAILED"]) {
      let start = 0;
      let more = true;
      while (more) {
        const page = await api<{ items: Item[]; hasMore: boolean }>(`/api/jobs/${jobId}/items?status=${status}&offset=${start}`);
        rows.push(...page.items);
        start += page.items.length;
        more = page.hasMore;
      }
    }
    if (!rows.length) return toast("Every song matched — nothing to download.");
    const tracks = rows.map((r) => ({ title: r.src_title, artist: r.src_artist, album: r.src_album ?? undefined, isrc: r.src_isrc ?? undefined }));
    downloadFile("mixnmatch-songs-to-check.csv", toCsv([{ name: "Songs to check", tracks }]), "text/csv");
  }

  if (!jobId) return <Navigate to="/dashboard" replace />;
  if (!job)
    return (
      <p className="text-muted">
        <Spinner /> Loading…
      </p>
    );

  const [tone, label] = JOB_PILL[job.status] ?? ["", job.status];
  const { percent, phase, message } = progress(job);
  const summary = summaryText(job);
  const c = job.counts;
  const somethingToRetry = c.FAILED > 0 || c.LOW_CONFIDENCE > 0 || job.status !== "DONE";
  const syncable = job.playlists.filter((p) => p.kind === "playlist" && p.dest_playlist_id);
  const canSync = job.status === "DONE" && job.source !== "file" && !job.sync_id && syncable.length > 0;

  const stats: [string, number, Tone, string][] = [
    ["n-total", job.total, "", "Songs found"],
    ["n-matched", c.MATCHED, "ok", "Matched & added"],
    ["n-low", c.LOW_CONFIDENCE, "warn", "Need a look (not added)"],
    ["n-failed", c.FAILED, "bad", "Not found"],
    ["n-already", job.alreadyThere, "", "Already there (skipped)"],
  ];
  const STAT_TONE: Record<string, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", "": "text-fg" };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{job.title}</h1>
          <p className="text-muted">
            {platformName(job.source)} → {platformName(job.dest)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={tone} id="status-pill">
            {label}
          </Pill>
          {!finished ? (
            <Button size="small" variant="danger" id="stop" onClick={stop} disabled={busy === "stop"}>
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <strong id="phase">{phase}</strong>
          <span className="text-muted" id="percent">
            {percent}%
          </span>
        </div>
        <div id="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2.5 overflow-hidden rounded-full bg-raised">
          <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
        {message ? <p className="text-sm text-muted">{message}</p> : null}
        {finished && summary ? <p id="summary">{summary}</p> : null}
        {finished && somethingToRetry ? (
          <div id="retry-box" className="flex flex-wrap items-center gap-4 pt-1">
            <Button variant="primary" id="retry" onClick={retry} disabled={busy === "retry"}>
              Try again
            </Button>
            <label className="flex min-h-[44px] items-center gap-2 font-normal">
              <input type="checkbox" id="include-unsure" checked={includeUnsure} onChange={(e) => setIncludeUnsure(e.target.checked)} /> Also try "Need a look" songs again
            </label>
          </div>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([id, n, t, text]) => (
          <div key={id} className={cx("rounded-xl border border-line bg-surface p-4", id === "n-total" && "col-span-2 sm:col-span-1")}>
            <div id={id} className={cx("text-2xl font-bold tabular-nums", STAT_TONE[t])}>
              {n.toLocaleString()}
            </div>
            <div className="text-xs text-muted">{text}</div>
          </div>
        ))}
      </div>

      {canSync ? (
        <Card className="space-y-3" id="sync-box">
          <h2 className="text-lg font-semibold">Keep it copied</h2>
          <p className="text-sm text-muted">Once a day, new songs you add to the original playlist are added here too. Nothing is ever removed.</p>
          {job.dest === "youtube" ? (
            <p className="text-sm text-muted">Syncing into YouTube is switched off for now: its small daily allowance is shared by everyone.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {syncable.map((p) =>
                synced.has(p.sel_index) ? (
                  <Button key={p.sel_index} size="small" disabled className="max-w-full" title={p.name}>
                    <span className="truncate">“{p.name}” is kept in sync ✓</span>
                  </Button>
                ) : (
                  <Button key={p.sel_index} size="small" variant="primary" className="max-w-full" title={p.name} onClick={() => keepInSync(p)}>
                    <span className="truncate">Keep “{p.name}” in sync</span>
                  </Button>
                ),
              )}
            </div>
          )}
        </Card>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Every song</h2>
          <Button size="small" id="download-missing" onClick={downloadMissing}>
            Download songs that need a look (CSV)
          </Button>
        </div>
        <div role="tablist" id="tabs" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              data-status={t.status}
              data-filter={t.already ? "already" : undefined}
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={cx(
                "min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-semibold transition md:min-h-[40px]",
                tab === i ? "border-accent bg-accent text-bg" : "border-line text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ul id="items" className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items === null ? (
            <li className="px-4 py-3 text-muted">
              <Spinner /> Loading…
            </li>
          ) : !items.length ? (
            <li className="px-4 py-3 text-muted">Nothing here yet.</li>
          ) : (
            items.map((item) => <ItemRow key={item.id} item={item} finished={finished} onFix={openFix} />)
          )}
        </ul>
        {hasMore ? (
          <Button id="more" onClick={showMore}>
            Show more
          </Button>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Link to="/dashboard" className={buttonClass()}>
          Back to Home
        </Link>
        <Link to="/transfer" className={buttonClass("ghost")}>
          Start another transfer
        </Link>
      </div>

      <Dialog open={!!fixing} onClose={onFixClosed} title="Find the right song" id="fix" titleId="fix-title">
        {fixing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Original: {fixing.src_title} — {fixing.src_artist}
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                runSearch(fixing, query);
              }}
            >
              <label className="sr-only" htmlFor="fix-q">
                Search
              </label>
              <input id="fix-q" type="search" autoComplete="off" maxLength={200} value={query} onChange={(e) => onQuery(e.target.value)} autoFocus />
              <Button type="submit">Search</Button>
            </form>
            {youtube ? <Notice className="text-xs">Each search on YouTube uses part of a small daily allowance.</Notice> : null}
            <p className="text-sm text-muted" aria-live="polite">
              {searchNote}
            </p>
            <ol id="fix-results" className="space-y-2">
              {found.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="pick flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-2 text-left transition hover:border-accent"
                    onClick={() => pickSong(r)}
                  >
                    <span className="min-w-0">
                      <strong className="block truncate">{r.title}</strong>
                      <span className="block truncate text-xs text-muted">{[r.artist, r.album].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-accent">Use this</span>
                  </button>
                </li>
              ))}
            </ol>
            <Button variant="ghost" id="fix-skip" onClick={skip}>
              Skip this song
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
