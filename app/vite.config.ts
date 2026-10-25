// Builds the mix n match app into ../dist, which Vercel serves (see vercel.json).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const API = "http://127.0.0.1:8787";

export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      // A new version replaces the old one on the next visit, so nobody gets stuck on an old copy.
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "mix n match",
        short_name: "mix n match",
        description: "Move your playlists and liked songs between music apps, and keep them in sync.",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Only the Latin letters are stored on the phone; other alphabets load when a song needs them.
        globIgnores: ["**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*"],
        navigateFallback: "/index.html",
        // Never answer /api/* from the phone: connecting a music app goes through
        // /api/connect and /api/callback, and every answer from the server must be fresh.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: {
    // `npm run dev:app` gives instant reloads while you change screens. It passes /api/* on to
    // `npm run dev` (port 8787). Same host (127.0.0.1) so both share the sign-in cookie.
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: API,
        // The server only accepts changes from its own address, so present this one as that.
        configure: (proxy) => proxy.on("proxyReq", (req) => req.getHeader("origin") && req.setHeader("origin", API)),
      },
    },
  },
});
