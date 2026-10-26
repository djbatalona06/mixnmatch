// Layout check: opens every screen at phone, tablet and desktop width and measures the
// alignment rules written down in docs/layout-board.html. It needs no server and no
// Vercel account: `vite preview` serves the built app, and every /api/* request gets
// fake data from test/layout-fixtures.mjs.
// Run:     npm run layout:check   (builds the app first)
// Report:  test-results/layout/report.html  (screenshots and problems, one tab per screen)
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { answer } from "./layout-fixtures.mjs";

const OUT = "test-results/layout";
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const executablePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

// The rules (the same numbers are listed on the board's "Rules" panel).
const RULES = { gutter: 16, maxWidth: 1152, tap: 44 };
const WIDTHS = [
  { id: "phone", name: "Phone", width: 375, height: 812 },
  { id: "tablet", name: "Tablet", width: 768, height: 1024 },
  { id: "desktop", name: "Desktop", width: 1280, height: 900 },
];

const click = (selector) => (page) => page.locator(selector).first().click();
const pickTwo = async (page) => {
  await page.locator(".cover-card", { hasText: "Road Trip" }).click();
  await page.locator(".cover-card", { hasText: "Gym" }).click();
};

// One tab per screen. A screen can have more than one state (steps of a wizard, for example).
const SCREENS = [
  { id: "landing", name: "Landing", views: [{ path: "/", ready: "text=How it works", signedIn: false }] },
  {
    id: "login",
    name: "Login",
    views: [
      { path: "/login", ready: "#email", signedIn: false },
      { label: "Opened from the email link", path: "/login?token=sample", ready: "#confirm-btn", signedIn: false },
    ],
  },
  { id: "privacy", name: "Privacy", views: [{ path: "/privacy", ready: "text=Who helps us run mix n match", signedIn: false }] },
  { id: "terms", name: "Terms", views: [{ path: "/terms", ready: "h1", signedIn: false }] },
  { id: "notfound", name: "Not found", views: [{ path: "/no-such-page", ready: "text=Lost the beat", signedIn: false }] },
  { id: "dashboard", name: "Home", views: [{ path: "/dashboard", ready: "#jobs" }] },
  {
    id: "transfer",
    name: "Move",
    views: [
      { label: "Step 1: From", path: "/transfer", ready: "#source-tiles" },
      {
        label: "Step 3: Choose",
        path: "/transfer",
        ready: "#playlist-grid .cover-card >> nth=3",
        steps: [click('#source-tiles [data-id="spotify"]'), click("#next"), click('#dest-tiles [data-id="tidal"]'), click("#next")],
      },
      {
        label: "Step 4: Review",
        path: "/transfer",
        ready: "#summary",
        steps: [
          click('#source-tiles [data-id="spotify"]'),
          click("#next"),
          click('#dest-tiles [data-id="tidal"]'),
          click("#next"),
          (page) => page.locator("#playlist-grid .cover-card").nth(3).waitFor(),
          pickTwo,
          click("#next"),
        ],
      },
    ],
  },
  { id: "results", name: "Results", views: [{ path: "/results?job=job-1", ready: "#items li[data-id]" }] },
  { id: "syncs", name: "Syncs", views: [{ path: "/syncs", ready: "#syncs h2" }] },
  { id: "account", name: "Account", views: [{ path: "/account", ready: "#plan" }] },
  { id: "export", name: "Back up", views: [{ path: "/export", ready: "#playlist-grid .cover-card >> nth=3" }] },
  {
    id: "chrome",
    name: "Shared frame",
    views: [
      {
        label: "Header, bottom tabs, offline bar and a message",
        path: "/dashboard",
        ready: "[role=status].toast",
        failJobs: true,
        steps: [(page) => page.context().setOffline(true), (page) => page.locator("#offline").waitFor()],
      },
    ],
  },
];

/** Runs inside the page. Returns a list of { rule, message } for everything that breaks a rule. */
function measure({ rules, phone }) {
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });
  const rect = (el) => el.getBoundingClientRect();
  const style = (el) => getComputedStyle(el);
  const visible = (el) => {
    const r = rect(el);
    return r.width > 0 && r.height > 0 && style(el).visibility !== "hidden" && !el.closest("dialog:not([open])");
  };
  const name = (el) => {
    const text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${text ? ` “${text.slice(0, 40)}”` : ""}`;
  };
  const px = (n) => `${Math.round(n * 10) / 10}px`;
  const root = document.documentElement;
  const width = root.clientWidth;

  // 1. Nothing makes the page scroll sideways.
  if (root.scrollWidth > width) {
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (["auto", "scroll", "hidden", "clip"].includes(style(p).overflowX)) return true;
      return false;
    };
    const wide = [...document.body.querySelectorAll("*")].filter((el) => visible(el) && rect(el).right > width + 0.5 && !clipped(el));
    const worst = wide.filter((el) => !wide.includes(el.parentElement)).slice(0, 3);
    add("no-sideways-scroll", `The page is ${root.scrollWidth}px wide in a ${width}px window. Too wide: ${worst.map(name).join(", ") || "unknown"}.`);
  }

  // 2 + 3. The content sits 16px from the edge on phones, is never wider than 72rem, and lines up with the header.
  const main = document.querySelector("main");
  const contentLeft = (el) => rect(el).left + parseFloat(style(el).paddingLeft);
  const left = contentLeft(main);
  if (phone && Math.abs(left - rules.gutter) > 0.5) add("side-gutter", `Content starts ${px(left)} from the left edge, not ${rules.gutter}px.`);
  if (rect(main).width > rules.maxWidth + 0.5) add("max-width", `Content area is ${px(rect(main).width)} wide, more than ${rules.maxWidth}px.`);
  const header = document.querySelector("header");
  const headerRow = header?.querySelector(":scope > div") ?? header;
  if (headerRow && Math.abs(contentLeft(headerRow) - left) > 0.5) {
    add("header-lines-up", `The header starts at ${px(contentLeft(headerRow))}, the content at ${px(left)}.`);
  }

  // 4. Everything you tap is at least 44px tall on a phone.
  // Links inside a sentence are allowed to be smaller (they are part of the text).
  if (phone) {
    const targets = document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="checkbox"], [role="tab"]');
    for (const el of targets) {
      if (!visible(el)) continue;
      if (el.tagName === "A" && style(el).display === "inline") continue;
      const box = el.matches('input[type="checkbox"], input[type="radio"]') && el.closest("label") ? el.closest("label") : el;
      const h = rect(box).height;
      if (h < rules.tap - 0.5) add("tap-size", `${name(el)} is ${px(h)} tall (needs ${rules.tap}px).`);
    }
  }

  // 5. Nothing is hidden under the bottom tab bar (phones, signed-in screens).
  const bar = [...document.querySelectorAll("nav")].find((n) => style(n).position === "fixed" && visible(n));
  if (bar) {
    const floating = [...document.body.querySelectorAll("*")].filter(
      (el) => el !== bar && !bar.contains(el) && el.tagName !== "HEADER" && ["fixed", "sticky"].includes(style(el).position) && visible(el),
    );
    for (const [where, y] of [["top", 0], ["bottom", root.scrollHeight]]) {
      window.scrollTo(0, y);
      const barTop = rect(bar).top;
      for (const el of floating) {
        if (rect(el).bottom > barTop + 0.5) add("tab-bar-clearance", `${name(el)} is covered by the bottom tabs by ${px(rect(el).bottom - barTop)} (page scrolled to the ${where}).`);
      }
      if (where === "bottom") {
        const end = Math.max(...[...main.querySelectorAll("*")].filter((el) => visible(el) && !floating.includes(el)).map((el) => rect(el).bottom));
        if (end > barTop + 0.5) add("tab-bar-clearance", `The end of the content is covered by the bottom tabs by ${px(end - barTop)}.`);
      }
    }
    window.scrollTo(0, 0);
  }

  // The same problem can be found twice (two scroll positions): keep one of each.
  return problems.filter((p, i) => problems.findIndex((q) => q.message === p.message) === i);
}

// ---------- the report ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function report(results) {
  const total = results.reduce((n, r) => n + r.views.reduce((m, v) => m + v.shots.reduce((k, s) => k + s.problems.length, 0), 0), 0);
  const count = (screen) => screen.views.reduce((m, v) => m + v.shots.reduce((k, s) => k + s.problems.length, 0), 0);
  const tabs = results
    .map((r, i) => {
      const n = count(r);
      return `      <button role="tab" id="tab-${r.id}" aria-controls="panel-${r.id}" aria-selected="${i === 0}">${esc(r.name)} <span class="badge ${n ? "bad" : "ok"}">${n || "✓"}</span></button>`;
    })
    .join("\n");
  const panels = results
    .map((r, i) => {
      const views = r.views
        .map((v) => {
          const shots = v.shots
            .map(
              (s) => `          <figure class="shot">
            <figcaption><strong>${esc(s.name)}</strong> ${s.width}px · ${s.problems.length ? `<span class="bad">${s.problems.length} to fix</span>` : '<span class="ok">all rules pass</span>'}</figcaption>
            ${s.problems.length ? `<ul class="problems">${s.problems.map((p) => `<li><code>${esc(p.rule)}</code> ${esc(p.message)}</li>`).join("")}</ul>` : ""}
            <a href="${esc(s.file)}"><img src="${esc(s.file)}" alt="${esc(`${r.name}, ${s.name}`)}" loading="lazy"></a>
          </figure>`,
            )
            .join("\n");
          return `        <h2>${esc(v.label ?? r.name)} <code>${esc(v.path)}</code></h2>
        <div class="shots">
${shots}
        </div>`;
        })
        .join("\n");
      return `      <section class="panel" role="tabpanel" id="panel-${r.id}" aria-labelledby="tab-${r.id}"${i === 0 ? "" : " hidden"}>
${views}
      </section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Layout report</title>
  <link rel="stylesheet" href="../../docs/layout-board.css">
  <script defer src="../../docs/layout-board.js"></script>
</head>
<body>
  <header class="top">
    <h1>Layout report <span class="badge ${total ? "bad" : "ok"}">${total ? `${total} to fix` : "all rules pass"}</span></h1>
    <p>Measured from the real app on ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC. The plan for each screen is in <a href="../../docs/layout-board.html">the layout board</a>.</p>
  </header>
  <main>
    <nav class="tabs" role="tablist" aria-label="Screens">
${tabs}
    </nav>
${panels}
  </main>
</body>
</html>
`;
}

// ---------- run ----------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const server = await preview({ configFile: "app/vite.config.ts", logLevel: "error", preview: { port: PORT, host: "127.0.0.1", strictPort: true } });
const browser = await chromium.launch({ executablePath });
const results = [];
let failures = 0;

try {
  for (const screen of SCREENS) {
    const result = { id: screen.id, name: screen.name, views: [] };
    for (const [vi, view] of screen.views.entries()) {
      const shots = [];
      for (const w of WIDTHS) {
        // Service workers are blocked so every request reaches the fake answers below.
        const context = await browser.newContext({ viewport: { width: w.width, height: w.height }, serviceWorkers: "block" });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/api/**", (route) => {
          const { status, json } = answer(route.request().method(), new URL(route.request().url()).pathname, view);
          return route.fulfill({ status, json });
        });
        await page.goto(BASE + view.path);
        for (const step of view.steps ?? []) await step(page);
        await page.locator(view.ready).first().waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.evaluate(measure, { rules: RULES, phone: w.id === "phone" });
        for (const e of errors) problems.push({ rule: "no-errors", message: `The page crashed: ${e}` });
        const file = `${screen.id}-${vi + 1}-${w.id}.png`;
        await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
        shots.push({ ...w, file, problems });
        failures += problems.length;
        for (const p of problems) console.log(`✗ ${screen.name}${view.label ? ` (${view.label})` : ""} · ${w.name}: [${p.rule}] ${p.message}`);
        await context.close();
      }
      result.views.push({ label: view.label, path: view.path, shots });
    }
    results.push(result);
    const n = result.views.reduce((m, v) => m + v.shots.reduce((k, s) => k + s.problems.length, 0), 0);
    if (!n) console.log(`✓ ${screen.name}`);
  }
} finally {
  writeFileSync(`${OUT}/report.html`, report(results));
  await browser.close();
  await server.close();
}

const checked = results.reduce((n, r) => n + r.views.length * WIDTHS.length, 0);
console.log(`\n${checked} screen views checked. ${failures ? `${failures} problem(s) to fix.` : "All layout rules pass."} Report: ${OUT}/report.html`);
process.exit(failures ? 1 : 0);
