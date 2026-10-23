// @ts-nocheck — formats.js is plain browser JavaScript.
import { describe, expect, it } from "vitest";
import { parseCsvRows, parseImport, toBackupJson, toCsv, toJspf } from "../public/js/formats.js";

const playlist = {
  name: "Road Trip",
  tracks: [
    { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", isrc: "GBUM71029604", durationMs: 354000 },
    { title: 'Song, with "quotes"', artist: "=HYPERLINK(evil)" },
  ],
};

describe("backup formats", () => {
  it("JSPF round-trips, including ISRC", () => {
    const doc = toJspf(playlist);
    expect(doc.playlist.track[0]).toMatchObject({ title: "Bohemian Rhapsody", creator: "Queen", identifier: ["isrc:GBUM71029604"] });
    const back = parseImport(JSON.stringify(doc), "x.jspf");
    expect(back).toEqual([{ name: "Road Trip", tracks: [
      { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", isrc: "GBUM71029604", durationMs: 354000 },
      { title: 'Song, with "quotes"', artist: "=HYPERLINK(evil)", album: undefined, isrc: undefined, durationMs: undefined },
    ] }]);
  });

  it("multi-playlist backups round-trip", () => {
    const text = toBackupJson([playlist, { name: "Two", tracks: [{ title: "A", artist: "B" }] }]);
    expect(parseImport(text).map((p) => p.name)).toEqual(["Road Trip", "Two"]);
  });

  it("CSV escapes quotes/commas and defuses spreadsheet formulas, then round-trips", () => {
    const csv = toCsv([playlist]);
    expect(csv).toContain('"Song, with ""quotes"""');
    expect(csv).toContain("'=HYPERLINK(evil)");
    const back = parseImport(csv, "backup.csv");
    expect(back[0].tracks[1]).toMatchObject({ title: 'Song, with "quotes"', artist: "=HYPERLINK(evil)" });
    expect(back[0].tracks[0].durationMs).toBe(354000);
  });

  it("reads CSVs from other tools (e.g. Exportify columns)", () => {
    const csv = 'Track Name,Artist Name(s),Album Name,ISRC\n"Get Lucky","Daft Punk, Pharrell Williams",RAM,USQX91300108\n';
    expect(parseImport(csv, "My Mix.csv")).toEqual([
      { name: "My Mix", tracks: [{ title: "Get Lucky", artist: "Daft Punk, Pharrell Williams", album: "RAM", isrc: "USQX91300108", durationMs: undefined }] },
    ]);
  });

  it("reads plain 'Artist - Title' text lists", () => {
    expect(parseImport("Queen - Bohemian Rhapsody\nnot a song line\nAdele - Hello\n", "list.txt")[0].tracks).toEqual([
      { artist: "Queen", title: "Bohemian Rhapsody" },
      { artist: "Adele", title: "Hello" },
    ]);
  });

  it("parses CSV rows with newlines inside quotes", () => {
    expect(parseCsvRows('a,"b\nc",d\r\n1,2,3')).toEqual([["a", "b\nc", "d"], ["1", "2", "3"]]);
  });

  it("rejects JSON that is not a playlist", () => {
    expect(() => parseImport('{"hello": 1}')).toThrow(/not a JSPF/);
  });
});
