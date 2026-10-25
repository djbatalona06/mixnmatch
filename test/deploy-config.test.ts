// Deploy checks: these fail in CI before a bad Vercel setup can go live.
// They read the files as they are in the repo, so no network or Vercel account is needed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const vercel = JSON.parse(read("vercel.json"));
const csp: string = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value;

const htmlPages = readdirSync(new URL("public/", root))
  .filter((f) => f.endsWith(".html"))
  .sort();
const INSIGHTS = '<script defer src="/_vercel/insights/script.js"></script>';
const SPEED = '<script defer src="/_vercel/speed-insights/script.js"></script>';

describe("Vercel setup", () => {
  it("serves the public folder and gives clean web addresses", () => {
    expect(vercel.outputDirectory).toBe("public");
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.buildCommand).toBe("npm run build");
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

  it("keeps the security headers that used to live in public/_headers", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    const names = vercel.headers[0].headers.map((h: { key: string }) => h.key);
    expect(names).toEqual(expect.arrayContaining(["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]));
  });

  it("has no Cloudflare leftovers in the code or the site", () => {
    expect(existsSync(new URL("wrangler.jsonc", root))).toBe(false);
    expect(existsSync(new URL("public/_headers", root))).toBe(false);
    const pkg = JSON.parse(read("package.json"));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })).not.toEqual(expect.arrayContaining(["wrangler"]));
    for (const file of ["src/index.ts", "src/env.ts", "src/db.ts", "src/web.ts", "api/[...path].ts"]) {
      expect(read(file), file).not.toMatch(/cloudflare|CF-Connecting|ASSETS|TRANSFER_JOB/);
    }
  });
});

describe("Vercel Web Analytics and Speed Insights", () => {
  it("is on every public page except the sign-in page", () => {
    const measured = htmlPages.filter((p) => p !== "login.html");
    expect(measured.length).toBeGreaterThan(5);
    for (const page of measured) {
      const html = read(`public/${page}`);
      expect(html, page).toContain(INSIGHTS);
      expect(html, page).toContain(SPEED);
    }
  });

  it("is not on the sign-in page, because the sign-in link carries a secret token", () => {
    const html = read("public/login.html");
    expect(html).not.toContain("/_vercel/insights/");
    expect(html).not.toContain("/_vercel/speed-insights/");
  });

  it("uses only external scripts, so the strict CSP does not block them", () => {
    for (const page of htmlPages) {
      const inline = [...read(`public/${page}`).matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)];
      expect(inline.map((m) => m[0]), page).toEqual([]);
    }
  });

  it("tells visitors about the analytics in the privacy policy", () => {
    const privacy = read("public/privacy.html");
    expect(privacy).toContain("Vercel Web Analytics");
    expect(privacy).toContain("Speed Insights");
    expect(privacy).toContain("no cookies");
    expect(privacy).toContain("Turso");
  });
});
