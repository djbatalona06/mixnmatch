// Dark theme: warm near-black surfaces, one amber accent. The colour values live in app/src/index.css
// as CSS variables (so one edit there restyles the whole app). Token table: docs/10-spec-app.md.
const rgb = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ["./index.html", "./src/**/*.{ts,tsx}"] },
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: rgb("surface"),
        raised: rgb("raised"),
        line: { DEFAULT: rgb("line"), strong: rgb("line-strong") },
        fg: rgb("fg"),
        muted: rgb("muted"),
        accent: { DEFAULT: rgb("accent"), hover: rgb("accent-hover"), deep: rgb("accent-deep") },
        ok: rgb("ok"),
        warn: rgb("accent"),
        bad: rgb("bad"),
      },
      fontFamily: {
        sans: ['"Geist Variable"', "Geist", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      // One corner system: cards, inputs and dialogs are `xl`, big panels are `2xl`, buttons and pills are full.
      borderRadius: { xl: "var(--radius-card)", "2xl": "var(--radius-panel)" },
      // Shadows are tinted to the background, never glowing.
      boxShadow: { soft: "var(--shadow-soft)", lift: "var(--shadow-lift)" },
      transitionTimingFunction: { DEFAULT: "cubic-bezier(0.16, 1, 0.3, 1)", out: "cubic-bezier(0.16, 1, 0.3, 1)" },
      transitionDuration: { DEFAULT: "200ms" },
    },
  },
  plugins: [],
};
