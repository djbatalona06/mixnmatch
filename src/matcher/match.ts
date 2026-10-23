// The matching engine. For each song it tries, in order:
//   Tier 1  ISRC (the song's official barcode)        -> confidence 1.0
//   Tier 2  same cleaned-up title + same main artist  -> confidence 0.97
//   Tier 3  "close enough" text (Jaro-Winkler)        -> MATCHED if >= threshold
import type { Track } from "../adapters/types";
import { normalizeTitle, primaryArtist, splitArtists } from "./normalize";
import { jaroWinkler } from "./similarity";

export type MatchStatus = "MATCHED" | "LOW_CONFIDENCE" | "FAILED";
export type MatchMethod = "isrc" | "exact" | "fuzzy_jaro_winkler" | "cache" | "none";

export interface MatchResult {
  source: Track;
  dest: Track | null;
  confidence: number;
  method: MatchMethod;
  status: MatchStatus;
}

export interface Searcher {
  /** Undefined when the destination cannot search by ISRC (e.g. YouTube). */
  byIsrc?: (isrc: string) => Promise<Track[]>;
  byText: (query: { title: string; artist: string }) => Promise<Track[]>;
}

export const DEFAULT_THRESHOLD = 0.85;
const EXACT_CONFIDENCE = 0.97;
// Jaro-Winkler gives even unrelated words ~0.5, so titles below this are "not the same song".
const MIN_TITLE_SIMILARITY = 0.75;
const MIN_REVIEW_SCORE = 0.65;

/** How alike two songs are, from 0 to 1. */
export function scoreCandidate(source: Track, candidate: Track): { score: number; exact: boolean; titleScore: number } {
  const srcTitle = normalizeTitle(source.title);
  const dstTitle = normalizeTitle(candidate.title);
  const srcArtist = primaryArtist(source.artist);
  const dstArtists = splitArtists(candidate.artist);

  const titleScore = jaroWinkler(srcTitle, dstTitle);
  const artistScore = Math.max(0, ...dstArtists.map((a) => jaroWinkler(srcArtist, a)));
  const exact = srcTitle === dstTitle && dstArtists.includes(srcArtist);

  let score = 0.6 * titleScore + 0.4 * artistScore;
  // Very different lengths usually mean a different version (live, extended mix...).
  if (source.durationMs && candidate.durationMs) {
    const diffSec = Math.abs(source.durationMs - candidate.durationMs) / 1000;
    if (diffSec > 30) score -= 0.1;
    else if (diffSec > 10) score -= 0.04;
  }
  return { score: Math.max(0, Math.min(1, score)), exact, titleScore };
}

export function pickBest(
  source: Track,
  candidates: Track[],
  threshold = DEFAULT_THRESHOLD,
): Omit<MatchResult, "source"> {
  let best: Track | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const { score, exact, titleScore } = scoreCandidate(source, candidate);
    if (exact) return { dest: candidate, confidence: EXACT_CONFIDENCE, method: "exact", status: "MATCHED" };
    if (titleScore >= MIN_TITLE_SIMILARITY && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (!best || bestScore < MIN_REVIEW_SCORE) return { dest: null, confidence: 0, method: "none", status: "FAILED" };
  return {
    dest: best,
    confidence: Number(bestScore.toFixed(3)),
    method: "fuzzy_jaro_winkler",
    status: bestScore >= threshold ? "MATCHED" : "LOW_CONFIDENCE",
  };
}

export async function matchTrack(
  source: Track,
  searcher: Searcher,
  threshold = DEFAULT_THRESHOLD,
): Promise<MatchResult> {
  // Tier 1: ISRC.
  if (source.isrc && searcher.byIsrc) {
    const hits = await searcher.byIsrc(source.isrc);
    if (hits.length) {
      // Several releases can share an ISRC; prefer the one whose name fits best.
      const ranked = hits
        .map((t) => ({ t, s: scoreCandidate(source, t).score }))
        .sort((x, y) => y.s - x.s);
      return { source, dest: ranked[0].t, confidence: 1, method: "isrc", status: "MATCHED" };
    }
  }
  // Tiers 2 and 3: text search.
  const candidates = await searcher.byText({ title: source.title, artist: source.artist });
  return { source, ...pickBest(source, candidates, threshold) };
}
