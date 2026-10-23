import { describe, expect, it } from "vitest";
import {
  cacheKey,
  normalizeTitle,
  parseYouTubeTitle,
  primaryArtist,
  splitArtists,
} from "../src/matcher/normalize";
import { jaroWinkler } from "../src/matcher/similarity";
import { matchTrack, pickBest } from "../src/matcher/match";

describe("normalizeTitle", () => {
  it.each([
    ["Bohemian Rhapsody - Remastered 2011", "bohemian rhapsody"],
    ["Bohemian Rhapsody (Remastered 2011)", "bohemian rhapsody"],
    ["Get Lucky (feat. Pharrell Williams & Nile Rodgers)", "get lucky"],
    ["Get Lucky feat. Pharrell Williams", "get lucky"],
    ["Hey Ya! [Live]", "hey ya"],
    ["Mr. Brightside - Radio Edit", "mr brightside"],
    ["Café del Mar", "cafe del mar"],
    ["  Too   many    spaces ", "too many spaces"],
    ["Don’t Stop Me Now", "dont stop me now"],
    ["Love Story (Taylor's Version)", "love story"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it("keeps brackets that are part of the real name", () => {
    expect(normalizeTitle("(I Can't Get No) Satisfaction")).toBe("i cant get no satisfaction");
    expect(normalizeTitle("Part 1 - The Beginning")).toBe("part 1 the beginning");
  });

  it("never returns an empty title", () => {
    expect(normalizeTitle("(Live)")).not.toBe("");
  });
});

describe("artists", () => {
  it("splits credits and picks the main artist", () => {
    expect(splitArtists("Daft Punk, Pharrell Williams & Nile Rodgers")).toEqual([
      "daft punk",
      "pharrell williams",
      "nile rodgers",
    ]);
    expect(primaryArtist("Beyoncé feat. Jay-Z")).toBe("beyonce");
    expect(primaryArtist("The Killers")).toBe("killers");
    expect(primaryArtist("Adele - Topic")).toBe("adele");
  });
});

describe("parseYouTubeTitle", () => {
  it("splits 'Artist - Title (Official Video)'", () => {
    expect(parseYouTubeTitle("Queen - Bohemian Rhapsody (Official Video Remastered)", "Queen Official")).toEqual({
      artist: "Queen",
      title: "Bohemian Rhapsody",
    });
  });
  it("uses the channel for auto-generated '- Topic' channels", () => {
    expect(parseYouTubeTitle("Blinding Lights", "The Weeknd - Topic")).toEqual({
      artist: "The Weeknd",
      title: "Blinding Lights",
    });
  });
});

describe("jaroWinkler", () => {
  it("scores identical strings as 1 and unrelated ones low", () => {
    expect(jaroWinkler("hello", "hello")).toBe(1);
    expect(jaroWinkler("", "x")).toBe(0);
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("bohemian rhapsody", "billie jean")).toBeLessThan(0.7);
  });
});

describe("cacheKey", () => {
  it("prefers ISRC and falls back to cleaned text", () => {
    expect(cacheKey({ title: "x", artist: "y", isrc: "gbum71029604" })).toBe("isrc:GBUM71029604");
    expect(cacheKey({ title: "Bohemian Rhapsody - Remastered", artist: "Queen" })).toBe("txt:bohemian rhapsody|queen");
  });
});

describe("matching tiers", () => {
  const source = { title: "Bohemian Rhapsody - Remastered 2011", artist: "Queen", isrc: "GBUM71029604", durationMs: 354000 };

  it("tier 1: ISRC wins with confidence 1", async () => {
    const result = await matchTrack(source, {
      byIsrc: async () => [{ id: "a", title: "Bohemian Rhapsody", artist: "Queen" }],
      byText: async () => {
        throw new Error("should not search text");
      },
    });
    expect(result).toMatchObject({ status: "MATCHED", method: "isrc", confidence: 1 });
    expect(result.dest?.id).toBe("a");
  });

  it("tier 2: exact normalized match when ISRC is missing", async () => {
    const result = await matchTrack(source, {
      byIsrc: async () => [],
      byText: async () => [
        { id: "live", title: "Bohemian Rhapsody", artist: "Queen Tribute" },
        { id: "good", title: "Bohemian Rhapsody (Remastered 2011)", artist: "Queen" },
      ],
    });
    expect(result).toMatchObject({ status: "MATCHED", method: "exact", confidence: 0.97 });
    expect(result.dest?.id).toBe("good");
  });

  it("tier 3: fuzzy match above the threshold", () => {
    const r = pickBest({ title: "Dont Stop Me Now", artist: "Queen" }, [
      { id: "x", title: "Don't Stop Me Now...", artist: "Queen, Brian May" },
    ]);
    expect(r.status).toBe("MATCHED");
  });

  it("fuzzy matches below the threshold need review", () => {
    const r = pickBest({ title: "Bohemian Rhapsody", artist: "Queen" }, [
      { id: "k", title: "Bohemian Rhapsody (Karaoke Version)", artist: "Sing King" },
    ]);
    expect(r.status).toBe("LOW_CONFIDENCE");
    expect(r.method).toBe("fuzzy_jaro_winkler");
  });

  it("fails when nothing similar exists", () => {
    const r = pickBest({ title: "Bohemian Rhapsody", artist: "Queen" }, [{ id: "z", title: "Baby Shark", artist: "Pinkfong" }]);
    expect(r.status).toBe("FAILED");
    expect(r.dest).toBeNull();
  });

  it("works when the destination has no ISRC search (YouTube)", async () => {
    const r = await matchTrack(source, {
      byText: async () => [{ id: "yt", title: "Bohemian Rhapsody", artist: "Queen" }],
    });
    expect(r.status).toBe("MATCHED");
  });

  it("penalises very different song lengths", () => {
    const short = pickBest({ title: "Song", artist: "Band", durationMs: 200000 }, [
      { id: "1", title: "Songs", artist: "Band", durationMs: 200000 },
    ]);
    const long = pickBest({ title: "Song", artist: "Band", durationMs: 200000 }, [
      { id: "1", title: "Songs", artist: "Band", durationMs: 600000 },
    ]);
    expect(long.confidence).toBeLessThan(short.confidence);
  });
});
