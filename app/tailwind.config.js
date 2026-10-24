// Dark luxury theme: near-black surfaces, amber accent. Tokens are listed in docs/10-spec-app.md.
/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ["./index.html", "./src/**/*.{ts,tsx}"] },
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
        raised: "#1a1a1a",
        line: "#262626",
        fg: "#f5f5f5",
        muted: "#a3a3a3",
        accent: { DEFAULT: "#f59e0b", hover: "#fbbf24" },
        ok: "#10b981",
        warn: "#f59e0b",
        bad: "#f87171",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      spacing: { safe: "env(safe-area-inset-bottom)" },
    },
  },
  plugins: [],
};
