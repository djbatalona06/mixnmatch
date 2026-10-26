// Deploy checks: these fail in CI before a bad Vercel setup can go live.
// They read the files as they are in the repo, so no network or Vercel account is needed.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const vercel = JSON.parse(read("vercel.json"));
type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };
const allPaths: HeaderRule = vercel.headers.find((h: HeaderRule) => h.source === "/(.*)");
const csp = allPaths.headers.find((h) => h.key === "Content-Security-Policy")!.value;

describe("Vercel setup", () => {
  it("serves the built app and builds it on every deploy", () => {
    expect(vercel.outputDirectory).toBe("dist");
    expect(vercel.buildCommand).toBe("npm run build");
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toContain("scripts/migrate.mjs");
    expect(pkg.scripts.build).toContain("vite build --config app/vite.config.ts");
  });

  it("sends every page address to the app, but never /api or Vercel's own paths", () => {
    expect(vercel.rewrites).toHaveLength(1);
    const { source, destination } = vercel.rewrites[0];
    expect(destination).toBe("/index.html");
    // Vercel's path pattern is a regular expression after the first "/".
    const pattern = new RegExp(`^/${source.slice(1).replace(/^\(/, "(?:")}$`);
    for (const page of ["/", "/dashboard", "/results", "/login", "/syncs", "/account", "/export", "/no-such-page"]) {
      expect(pattern.test(page), page).toBe(true);
    }
    for (const path of ["/api/me", "/api/cron/tick", "/_vercel/insights/script.js"]) {
      expect(pattern.test(path), path).toBe(false);
    }
  });

  it("never lets a phone keep an old copy of the app files that check for updates (A-07)", () => {
    const noCache = vercel.headers.find((h: HeaderRule) => h.headers.some((x) => x.key === "Cache-Control" && x.value === "no-cache"));
    expect(noCache).toBeDefined();
    for (const file of ["sw.js", "registerSW.js", "manifest.webmanifest", "index.html"]) {
      expect(noCache.source, file).toContain(file);
    }
  });

  it("runs the server code as one function with enough time for transfer steps", () => {
    const fn = vercel.functions["api/[...path].ts"];
    expect(fn).toBeDefined();
    expect(existsSync(new URL("api/[...path].ts", root))).toBe(true);
    expect(fn.maxDuration).toBeGreaterThanOrEqual(200); // the cron spends up to 150 seconds on steps
  });

  it("calls the job runner every minute, and only that path", () => {
    expect(vercel.crons).toEqual([{ path: "/api/cron/tick", schedule: "* * * * *" }]);
  });

  it("keeps the strict security headers on every path", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    const names = allPaths.headers.map((h) => h.key);
    expect(names).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]));
  });

  it("has no Cloudflare leftovers in the code or the app", () => {
    expect(existsSync(new URL("wrangler.jsonc", root))).toBe(false);
    expect(existsSync(new URL("public/_headers", root))).toBe(false);
    expect(existsSync(new URL("app/public/_headers", root))).toBe(false);
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).not.toContain("wrangler");
    expect(deps).not.toContain("@cloudflare/workers-types");
    for (const file of ["src/index.ts", "src/env.ts", "src/db.ts", "src/web.ts", "api/[...path].ts"]) {
      expect(read(file), file).not.toMatch(/cloudflare|CF-Connecting|ASSETS|TRANSFER_JOB/);
    }
    expect(read("app/src/pages/Legal.tsx")).not.toMatch(/cloudflare/i);
  });

  it("never commits the built app", () => {
    expect(read(".gitignore").split("\n")).toContain("dist/");
  });
});

describe("Vercel Web Analytics and Speed Insights", () => {
  const chrome = read("app/src/components/chrome.tsx");

  it("is part of the frame around every screen", () => {
    expect(chrome).toContain('from "@vercel/analytics/react"');
    expect(chrome).toContain('from "@vercel/speed-insights/react"');
    // Both layouts (public pages and signed-in pages) render it.
    expect(chrome.match(/<Measure \/>/g)).toHaveLength(2);
  });

  it("is not on the sign-in page, and never sends the ?part of an address (it can hold a sign-in token)", () => {
    expect(chrome).toMatch(/pathname === "\/login"\) return null/);
    expect(chrome).toContain("url: url.origin + url.pathname");
    expect(chrome).toContain("<Analytics beforeSend={privateUrl} />");
    expect(chrome).toContain("<SpeedInsights beforeSend={privateUrl} />");
  });

  it("keeps the app's page shell free of inline scripts, so the strict CSP does not block anything", () => {
    const inline = [...read("app/index.html").matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
    expect(inline.map((m) => m[0])).toEqual([]);
  });

  it("tells visitors about the analytics and the database host in the privacy policy", () => {
    const privacy = read("app/src/pages/Legal.tsx");
    expect(privacy).toContain("Vercel Web Analytics");
    expect(privacy).toContain("Speed Insights");
    expect(privacy).toContain("no cookies");
    expect(privacy).toContain("Turso");
  });
});
