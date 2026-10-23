// Turns messy song names into a clean, comparable form.
// "Bohemian Rhapsody - Remastered 2011" and "Bohemian Rhapsody (Remastered 2011)"
// both become "bohemian rhapsody".

// Words that mark a bracket or " - " suffix as "extra info", not part of the name.
const NOISE =
  /\b(remaster(ed)?|live|feat\.?|ft\.?|featuring|with|radio edit|edit|explicit|clean|version|mono|stereo|deluxe|bonus( track)?|single|album version|original mix|anniversary|mix|remix|re-?recorded|from|soundtrack|acoustic|instrumental|official|video|audio|lyrics?|visualizer|hd|hq|4k|mv|taylor'?s version)\b/i;

// Things YouTube adds to video titles.
const YOUTUBE_JUNK =
  /\b(official (music )?video|official audio|official lyric video|lyric video|lyrics?|audio|visualizer|hd|hq|4k|mv|m\/v)\b/gi;

export function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function basicClean(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes "(Remastered 2011)", "[Live]", "- Radio Edit", "feat. X" and similar. */
export function stripNoise(title: string): string {
  let t = title;
  // Bracketed parts: drop the ones that look like extra info.
  t = t.replace(/\s*[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (whole, inner: string) =>
    NOISE.test(inner) ? " " : whole,
  );
  // " - Something" suffixes.
  t = t.replace(/\s+[-–—]\s+(.*)$/u, (whole, rest: string) => (NOISE.test(rest) ? "" : whole));
  // Bare "feat. X" without brackets.
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, "");
  return t;
}

export function normalizeTitle(title: string): string {
  const cleaned = basicClean(stripNoise(title));
  return cleaned || basicClean(title);
}

/** All artist names in a credit like "Daft Punk, Pharrell Williams & Nile Rodgers". */
export function splitArtists(artist: string): string[] {
  return artist
    .split(/\s*(?:,|;|&|\/|\bfeat\.?|\bft\.?|\bfeaturing|\bwith\b|\bx\b|\band\b|\bvs\.?)\s*/i)
    .map((a) => normalizeArtist(a))
    .filter(Boolean);
}

export function normalizeArtist(artist: string): string {
  return basicClean(
    artist
      .replace(/\s*-\s*topic$/i, "")
      .replace(/vevo$/i, "")
      .replace(/^the\s+/i, ""),
  );
}

export function primaryArtist(artist: string): string {
  return splitArtists(artist)[0] ?? normalizeArtist(artist);
}

/**
 * YouTube videos are often titled "Artist - Song (Official Video)".
 * Returns the best guess of { title, artist }.
 */
export function parseYouTubeTitle(videoTitle: string, channel: string): { title: string; artist: string } {
  const isTopic = /\s-\s*topic$/i.test(channel);
  const cleanChannel = channel.replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").trim();
  const title = videoTitle
    .replace(/[\(\[]\s*[^\)\]]*\b(official|lyrics?|audio|video|visualizer|hd|4k|mv)\b[^\)\]]*[\)\]]/gi, "")
    .replace(YOUTUBE_JUNK, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!isTopic) {
    const parts = title.split(/\s+[-–—|]\s+/);
    if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { title, artist: cleanChannel };
}

/** A stable key used for the shared match cache. */
export function cacheKey(track: { title: string; artist: string; isrc?: string | null }): string {
  if (track.isrc) return `isrc:${track.isrc.toUpperCase()}`;
  return `txt:${normalizeTitle(track.title)}|${primaryArtist(track.artist)}`;
}
