// Names and brand colours of the music services (and file upload).
export const PLATFORM_INFO: Record<string, { name: string; color: string }> = {
  spotify: { name: "Spotify", color: "#1db954" },
  tidal: { name: "TIDAL", color: "#f5f5f5" },
  deezer: { name: "Deezer", color: "#a238ff" },
  youtube: { name: "YouTube Music", color: "#ff3347" },
  soundcloud: { name: "SoundCloud", color: "#ff7a1a" },
  mock: { name: "Demo Music", color: "#f59e0b" },
  file: { name: "File upload", color: "#7aa7ff" },
};

export function platformName(id: string): string {
  return PLATFORM_INFO[id]?.name ?? id;
}

export function platformColor(id: string): string {
  return PLATFORM_INFO[id]?.color ?? "#a3a3a3";
}
