// The Move wizard: 1 From -> 2 To -> 3 Choose -> 4 Review -> start.
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, CoverCard, Dialog, Notice, PageTitle, PlatformDot, Spinner } from "../components/ui";
import { api, type Page } from "../lib/api";
import { cx, plural } from "../lib/format";
import { parseImport, type FilePlaylist } from "../lib/formats";
import { platformName } from "../lib/platforms";
import type { Playlist, Song } from "../lib/types";
import { useSession } from "../store/session";

const LIKED = "__liked__";
const MORE = "__more__";
const PREVIEW_LIMIT = 50;
const STEPS = ["From", "To", "Choose", "Review"];

function Tile({ id, title, subtitle, pressed, onClick }: { id: string; title: string; subtitle: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-id={id}
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "tile flex min-h-[72px] items-center gap-3 rounded-xl border bg-surface p-4 text-left transition",
        pressed ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong",
      )}
    >
      <PlatformDot id={id} className="h-3.5 w-3.5" />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{subtitle}</span>
      </span>
    </button>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 grid grid-cols-4 gap-2" id="stepper">
      {STEPS.map((label, i) => {
        const n = i + 1;
        return (
          <li key={label} className="flex flex-col items-center gap-1.5 text-xs font-semibold sm:flex-row sm:text-sm">
            <span
              className={cx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm",
                n === step ? "border-accent bg-accent text-bg" : n < step ? "border-accent text-accent" : "border-line text-muted",
              )}
            >
              {n < step ? "✓" : n}
            </span>
            <span className={n === step ? "text-fg" : "text-muted"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Transfer() {
  const me = useSession((s) => s.me)!;
  const navigate = useNavigate();
  const connected = me.connections.map((c) => c.platform);

  const [step, setStep] = useState(1);
  const [source, setSource] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; playlists: FilePlaylist[] } | null>(null);
  const [fileNote, setFileNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [pickStatus, setPickStatus] = useState<ReactNode>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Destination playlists for "Add to": null = not asked yet, undefined = loading.
  const [destPlaylists, setDestPlaylists] = useState<Playlist[] | null | undefined>(null);
  const [destCursor, setDestCursor] = useState<string | undefined>();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [peek, setPeek] = useState<{ item: Playlist; songs: Song[] | null; more: boolean; error?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = playlists.filter((p) => selected.has(p.id));

  // ---------- step 1 & 2 ----------

  function chooseSource(id: string) {
    if (source !== id) {
      setSource(id);
      setPlaylists([]);
      setSelected(new Set());
      setNextCursor(undefined);
      if (dest === id && id !== "mock") setDest(null);
    }
  }

  function chooseDest(id: string) {
    if (dest !== id) {
      setDestPlaylists(null);
      setDestCursor(undefined);
      setTargets({});
    }
    setDest(id);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    setFile(null);
    setFileNote(null);
    setPlaylists([]);
    setSelected(new Set());
    if (!picked) return;
    try {
      if (picked.size > 5 * 1024 * 1024) throw new Error("That file is too big (5 MB max).");
      const parsed = parseImport(await picked.text(), picked.name);
      if (!parsed.length) throw new Error("No songs found in that file.");
      setFile({ name: picked.name, playlists: parsed });
      const total = parsed.reduce((n, p) => n + p.tracks.length, 0);
      setFileNote({ ok: true, text: `Found ${plural(parsed.length, "playlist")} with ${plural(total, "song")}.` });
    } catch (err) {
      setFileNote({ ok: false, text: (err as Error).message || "Could not read that file." });
    }
  }

  // ---------- step 3 ----------

  async function loadPlaylists(more = false) {
    if (source === "file") {
      const list = file!.playlists.map((p, i) => ({ id: String(i), name: p.name, trackCount: p.tracks.length }));
      setPlaylists(list);
      if (!selected.size) setSelected(new Set(list.map((p) => p.id)));
      setPickStatus("These playlists are in your file.");
      return;
    }
    const base = more ? playlists : [{ id: LIKED, name: "Liked Songs" }];
    if (!more) {
      setPlaylists(base);
      setNextCursor(undefined);
    }
    setPickStatus(
      <>
        <Spinner /> Loading your playlists…
      </>,
    );
    try {
      const q = more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const page = await api<Page<Playlist>>(`/api/library/${source}/playlists${q}`);
      const list = [...base, ...page.items];
      setPlaylists(list);
      setNextCursor(page.next);
      setPickStatus(`Tap a playlist to select it. ${plural(list.length - 1, "playlist")} found.`);
    } catch (err) {
      setPickStatus((err as Error).message);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openPeek(item: Playlist) {
    setPeek({ item, songs: null, more: false });
    try {
      const path =
        item.id === LIKED ? `/api/library/${source}/liked` : `/api/library/${source}/playlists/${encodeURIComponent(item.id)}/tracks`;
      const page = await api<Page<Song>>(path);
      setPeek((p) => (p?.item === item ? { item, songs: page.items.slice(0, PREVIEW_LIMIT), more: !!page.next } : p));
    } catch (err) {
      setPeek((p) => (p?.item === item ? { item, songs: [], more: false, error: (err as Error).message } : p));
    }
  }

  // ---------- step 4 ----------

  async function loadDestPlaylists(more = false) {
    try {
      const q = more && destCursor ? `?cursor=${encodeURIComponent(destCursor)}` : "";
      const page = await api<Page<Playlist>>(`/api/library/${dest}/playlists${q}`);
      setDestPlaylists((list) => [...(list ?? []), ...page.items]);
      setDestCursor(page.next);
    } catch {
      setDestPlaylists((list) => list ?? []);
      setDestCursor(undefined);
    }
  }

  useEffect(() => {
    if (step === 4 && destPlaylists === null && chosen.some((p) => p.id !== LIKED)) {
      setDestPlaylists(undefined);
      loadDestPlaylists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, destPlaylists]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { source, dest };
      if (source === "file") {
        body.file = {
          name: file!.name,
          playlists: chosen.map((p) => ({ ...file!.playlists[Number(p.id)], targetPlaylistId: targets[p.id] || undefined })),
        };
      } else {
        body.selections = chosen.map((p) =>
          p.id === LIKED ? { kind: "liked" } : { kind: "playlist", id: p.id, name: p.name, targetPlaylistId: targets[p.id] || undefined },
        );
      }
      const { id } = await api<{ id: string }>("/api/jobs", { method: "POST", body });
      navigate(`/results?job=${id}`);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  }

  // ---------- navigation ----------

  const canContinue =
    step === 1 ? !!source && (source !== "file" || !!file) : step === 2 ? !!dest : step === 3 ? selected.size > 0 : !starting;

  function show(n: number) {
    setStep(n);
    if (n === 3 && !playlists.length) loadPlaylists();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const destOptions = connected.filter((id) => id !== source || id === "mock");
  const songs = chosen.reduce((n, p) => n + (p.trackCount ?? 0), 0);

  return (
    <div>
      <PageTitle title="Move your music" />
      <Stepper step={step} />

      {step === 1 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Where is your music now?</h2>
          <div id="source-tiles" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((id) => (
              <Tile key={id} id={id} title={platformName(id)} subtitle="Connected" pressed={source === id} onClick={() => chooseSource(id)} />
            ))}
            <Tile id="file" title="Upload a file" subtitle="JSPF, CSV or TXT backup" pressed={source === "file"} onClick={() => chooseSource("file")} />
          </div>
          {source === "file" ? (
            <Card className="space-y-3">
              <label htmlFor="file">Choose a backup file (.jspf, .json, .csv or .txt)</label>
              <input id="file" type="file" accept=".jspf,.json,.csv,.txt,application/json,text/csv,text/plain" onChange={onFile} />
              <p className="text-sm text-muted">CSV needs "title" and "artist" columns. A .txt file can list one "Artist - Title" per line.</p>
              {fileNote ? <Notice tone={fileNote.ok ? "ok" : "bad"}>{fileNote.text}</Notice> : null}
            </Card>
          ) : null}
          <p className="text-sm text-muted">
            {connected.length ? "Missing an app? " : "Connect at least one music app first. "}
            <Link to="/dashboard" className="font-semibold text-accent">
              Connect it on Home
            </Link>
          </p>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Where should it go?</h2>
          {destOptions.length ? (
            <div id="dest-tiles" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {destOptions.map((id) => (
                <Tile key={id} id={id} title={platformName(id)} subtitle="Songs will be added here" pressed={dest === id} onClick={() => chooseDest(id)} />
              ))}
            </div>
          ) : (
            <p className="text-muted">
              Connect a second music app first.{" "}
              <Link to="/dashboard" className="font-semibold text-accent">
                Go to Home
              </Link>
            </p>
          )}
          {dest === "youtube" ? (
            <Notice tone="warn">
              YouTube gives mix n match a small daily allowance (about 60 songs a day for everyone together). Big transfers will pause and continue automatically
              the next day.
            </Notice>
          ) : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Pick what to move</h2>
            <div className="flex gap-2">
              <Button size="small" onClick={() => setSelected(new Set(playlists.map((p) => p.id)))}>
                Select all
              </Button>
              <Button size="small" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <p className="text-muted" id="pick-status">
            {pickStatus}
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
                action={
                  source !== "file" ? (
                    <Button
                      size="small"
                      className="peek w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPeek(item);
                      }}
                    >
                      Peek
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
          {nextCursor ? (
            <Button id="load-more" onClick={() => loadPlaylists(true)}>
              Load more playlists
            </Button>
          ) : null}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Ready?</h2>
          <Card className="space-y-4" id="summary">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <PlatformDot id={source!} /> {platformName(source!)} <span className="text-muted">→</span> <PlatformDot id={dest!} /> {platformName(dest!)}
            </div>
            <p>
              {plural(chosen.length, "list")}
              {songs ? `, about ${plural(songs, "song")}` : ""}:
            </p>
            <ul className="divide-y divide-line">
              {chosen.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  {p.id === LIKED ? (
                    <span className="text-sm text-muted">Saved to your liked songs</span>
                  ) : (
                    <select
                      aria-label={`Where should “${p.name}” go?`}
                      className="sm:max-w-xs"
                      value={targets[p.id] ?? ""}
                      onChange={(e) => {
                        if (e.target.value === MORE) loadDestPlaylists(true);
                        else setTargets((t) => ({ ...t, [p.id]: e.target.value }));
                      }}
                    >
                      <option value="">New playlist</option>
                      {destPlaylists === undefined ? (
                        <option value="" disabled>
                          Loading your playlists…
                        </option>
                      ) : null}
                      {(destPlaylists ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          Add to: {d.name}
                        </option>
                      ))}
                      {destCursor ? <option value={MORE}>Show more playlists…</option> : null}
                    </select>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">Adding to a playlist you already have? Songs that are already in it are skipped, so nothing is added twice.</p>
          </Card>
          <Notice>
            Songs we're not sure about are <strong>not</strong> added. After the transfer you'll see them in a list so you can check them yourself.
          </Notice>
        </section>
      ) : null}

      {error ? (
        <Notice tone="bad" role="alert" id="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
        {step > 1 ? (
          <Button variant="ghost" id="back" onClick={() => show(step - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" size="big" id="next" disabled={!canContinue} onClick={() => (step === 4 ? start() : show(step + 1))}>
          {step === 4 ? (starting ? "Starting…" : "Start transfer") : "Next"}
        </Button>
      </div>

      <Dialog open={!!peek} onClose={() => setPeek(null)} title={peek?.item.name ?? "Songs"} id="peek">
        <ol id="peek-list" className="space-y-2">
          {!peek || peek.songs === null ? (
            <li>
              <Spinner />
            </li>
          ) : peek.error ? (
            <li>{peek.error}</li>
          ) : !peek.songs.length ? (
            <li>This list is empty.</li>
          ) : (
            <>
              {peek.songs.map((t, i) => (
                <li key={`${t.id}-${i}`} className="flex gap-3">
                  <span className="pos w-6 shrink-0 text-right text-sm text-muted">{i + 1}</span>
                  <span className="min-w-0">
                    <strong className="block truncate">{t.title}</strong>
                    <span className="block truncate text-sm text-muted">{t.artist}</span>
                  </span>
                </li>
              ))}
              {peek.more ? <li className="text-muted">…and more</li> : null}
            </>
          )}
        </ol>
      </Dialog>
    </div>
  );
}
