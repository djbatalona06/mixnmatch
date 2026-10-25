// Backup files: JSPF (JSON playlists) and CSV (opens in any spreadsheet).
// Used for exporting a library and for importing one as a transfer source.

export interface FileTrack {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  durationMs?: number;
}
export interface FilePlaylist {
  name: string;
  tracks: FileTrack[];
}

/** One playlist -> a JSPF document. https://www.xspf.org/jspf */
export function toJspf(playlist: FilePlaylist) {
  return {
    playlist: {
      title: playlist.name,
      creator: "mix n match",
      date: new Date().toISOString(),
      track: playlist.tracks.map((t) => {
        const track: Record<string, unknown> = { title: t.title, creator: t.artist };
        if (t.album) track.album = t.album;
        if (t.durationMs) track.duration = t.durationMs;
        if (t.isrc) track.identifier = [`isrc:${t.isrc}`];
        return track;
      }),
    },
  };
}

/** Several playlists -> one file. A single playlist stays plain JSPF. */
export function toBackupJson(playlists: FilePlaylist[]): string {
  const docs = playlists.map(toJspf);
  return JSON.stringify(docs.length === 1 ? docs[0] : { playlists: docs }, null, 2);
}

const CSV_HEADER = ["playlist", "title", "artist", "album", "isrc", "duration_ms"];

function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  // Stop spreadsheet apps from running cells that start like a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(playlists: FilePlaylist[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const p of playlists) {
    for (const t of p.tracks) {
      lines.push([p.name, t.title, t.artist, t.album, t.isrc, t.durationMs].map(csvCell).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** Splits CSV text into rows of cells, handling quotes and commas inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const unquoteFormula = (v: string | undefined) => (v && v.startsWith("'") && /^'[=+\-@]/.test(v) ? v.slice(1) : v);

function fromCsv(text: string, fallbackName: string): FilePlaylist[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iTitle = col("title", "track", "track name", "song", "name");
  const iArtist = col("artist", "artists", "artist name(s)", "artist name", "creator");
  if (iTitle < 0 || iArtist < 0) {
    // No header: treat each line as "Artist - Title".
    return fromText(text, fallbackName);
  }
  const iPlaylist = col("playlist", "playlist name");
  const iAlbum = col("album", "album name");
  const iIsrc = col("isrc");
  const iDuration = col("duration_ms", "duration (ms)", "duration");
  const byName = new Map<string, FileTrack[]>();
  for (const r of rows.slice(1)) {
    const name = (iPlaylist >= 0 && r[iPlaylist]?.trim()) || fallbackName;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({
      title: unquoteFormula(r[iTitle]?.trim()) ?? "",
      artist: unquoteFormula(r[iArtist]?.trim()) ?? "",
      album: unquoteFormula(r[iAlbum]?.trim()) || undefined,
      isrc: r[iIsrc]?.trim() || undefined,
      durationMs: Number(r[iDuration]) || undefined,
    });
  }
  return [...byName].map(([name, tracks]) => ({ name, tracks }));
}

function fromText(text: string, name: string): FilePlaylist[] {
  const tracks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+[-–—]\s+/);
      return parts.length >= 2 ? { artist: parts[0], title: parts.slice(1).join(" - ") } : null;
    })
    .filter((t): t is FileTrack => t !== null);
  return tracks.length ? [{ name, tracks }] : [];
}

function fromJspfPlaylist(p: any, fallbackName: string): FilePlaylist {
  const isrcOf = (t: any): string | undefined => {
    const ids: unknown[] = Array.isArray(t.identifier) ? t.identifier : t.identifier ? [t.identifier] : [];
    const hit = ids.map(String).find((id) => id.toLowerCase().startsWith("isrc:"));
    return hit ? hit.slice(5) : undefined;
  };
  return {
    name: p.title || fallbackName,
    tracks: (p.track || []).map((t: any) => ({
      title: t.title,
      artist: t.creator,
      album: t.album || undefined,
      isrc: isrcOf(t),
      durationMs: Number(t.duration) || undefined,
    })),
  };
}

/** Reads an uploaded file (JSPF, our multi-playlist JSON, CSV, or TXT) into [{ name, tracks }]. */
export function parseImport(text: string, fileName = "Imported playlist"): FilePlaylist[] {
  const fallbackName = fileName.replace(/\.[^.]+$/, "") || "Imported playlist";
  const trimmed = text.replace(/^﻿/, "").trim();
  let playlists: FilePlaylist[];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed);
    if (data.playlist) playlists = [fromJspfPlaylist(data.playlist, fallbackName)];
    else if (Array.isArray(data.playlists)) playlists = data.playlists.map((d: any) => fromJspfPlaylist(d.playlist || d, fallbackName));
    else if (Array.isArray(data)) playlists = data.map((d: any) => fromJspfPlaylist(d.playlist || d, fallbackName));
    else throw new Error("This JSON file is not a JSPF playlist");
  } else {
    playlists = fromCsv(trimmed, fallbackName);
  }
  return playlists
    .map((p) => ({ name: p.name, tracks: p.tracks.filter((t) => t.title && t.artist) }))
    .filter((p) => p.tracks.length);
}
