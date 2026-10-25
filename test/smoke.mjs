// End-to-end smoke test: drives a real browser through the whole app against `vercel dev`.
// Needs: vercel dev running with DEV_MODE=1 and ENABLE_MOCK=1 (see .env.example).
// Run:   npm run dev   (in one terminal)   then   npm run smoke
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "test-results";
const executablePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// The login page checks "am I signed in?" first; a 401 there is expected.
page.on("console", (m) => {
  const expected401 = m.text().includes("401") && page.url().includes("/login");
  if (m.type() === "error" && !m.text().includes("fonts.g") && !expected401) errors.push(`${page.url()}: ${m.text()}`);
});

const step = (name) => console.log(`• ${name}`);
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

try {
  step("landing page");
  await page.goto(BASE);
  await page.getByText("Take your music").waitFor();
  await shot("1-landing");

  step("sign in with a magic link (dev mode shows it on screen)");
  await page.goto(`${BASE}/login`);
  await page.fill("#email", `smoke-${Date.now()}@example.com`);
  await page.click("#send");
  await page.locator("#dev-link-a").click();
  await page.click("#confirm-btn");
  await page.waitForURL(/\/dashboard/);

  step("connect the demo service through the real OAuth callback");
  await page.getByRole("link", { name: "Connect Demo Music" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.getByText("Demo Music is connected.").waitFor();
  await shot("2-dashboard");

  step("transfer wizard: from Demo -> to Demo, pick Liked Songs + Road Trip (1,000 songs)");
  await page.click("#start-transfer");
  await page.locator('#source-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.locator('#dest-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.getByText("Road Trip").waitFor();
  await page.locator(".cover-card", { hasText: "Road Trip" }).getByRole("button", { name: "Peek" }).click();
  await page.locator("#peek-list li .pos").first().waitFor();
  if ((await page.locator("#peek-list li").count()) < 10) throw new Error("preview should list songs");
  await page.click("#peek-close");
  await page.locator(".cover-card", { hasText: "Road Trip" }).click();
  await page.locator(".cover-card", { hasText: "Liked Songs" }).click();
  await shot("3-pick");
  await page.click("#next");
  await page.getByText("Ready?").waitFor();
  await page.click("#next");
  await page.waitForURL(/\/results\?job=/);

  step("watch it finish");
  await page.getByText("All done!").waitFor({ timeout: 120_000 });
  const total = Number((await page.textContent("#n-total")).replace(/,/g, ""));
  const matched = Number((await page.textContent("#n-matched")).replace(/,/g, ""));
  const low = Number(await page.textContent("#n-low"));
  const failed = Number(await page.textContent("#n-failed"));
  console.log(`  total=${total} matched=${matched} needs-a-look=${low} not-found=${failed}`);
  if (total !== 1060) throw new Error(`expected 1060 songs, got ${total}`);
  if (matched / total < 0.9) throw new Error("match rate below 90%");
  await page.locator('#tabs button[data-status="LOW_CONFIDENCE"]').click();
  await page.locator("#items tr").first().waitFor();
  await shot("4-results");
  const resultsUrl = page.url();

  step("v1.1 fix a 'need a look' song by hand (search, then Use this)");
  await page.locator("#items .fix-btn").first().click();
  await page.locator("#fix[open]").waitFor();
  if ((await page.inputValue("#fix-q")).length < 3) throw new Error("search box should be pre-filled");
  await page.locator("#fix-results .pick").first().waitFor();
  await shot("4a-fix-dialog");
  await page.locator("#fix-results .pick").first().click();
  await page.locator("#fix:not([open])").waitFor({ state: "attached" });
  await page.waitForFunction((before) => Number(document.querySelector("#n-low").textContent) === before - 1, low);
  await shot("4b-fixed");

  step("v1.1 skip a song");
  await page.locator("#items .fix-btn").first().click();
  await page.click("#fix-skip");
  await page.locator('#items .pill:text-is("Skipped")').first().waitFor();

  step("v1.1 try again (also the 'need a look' songs) — no songs read twice");
  await page.check("#include-unsure");
  await page.click("#retry");
  await page.getByText("All done!").waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector("#status-pill").textContent === "Done");
  const totalAfter = Number((await page.textContent("#n-total")).replace(/,/g, ""));
  if (totalAfter !== 1060) throw new Error(`retry should not read songs again (total ${totalAfter})`);

  step("v1.2 keep Road Trip in sync");
  await page.getByRole("button", { name: /Keep “Road Trip” in sync/ }).click();
  await page.getByRole("button", { name: /is kept in sync/ }).waitFor();
  await page.goto(`${BASE}/dashboard`);
  await page.locator("#syncs td", { hasText: "Road Trip" }).waitFor();
  await page.locator("#syncs").getByRole("button", { name: "Pause" }).click();
  await page.locator("#syncs").getByRole("button", { name: "Resume" }).waitFor();
  await shot("4c-dashboard-syncs");

  step("v1.1 add to an existing playlist (wizard Review step)");
  await page.goto(`${BASE}/transfer`);
  await page.locator('#source-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.locator('#dest-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.locator(".cover-card", { hasText: "Chill Evenings" }).click();
  await page.click("#next");
  const picker = page.locator("#summary select");
  await picker.locator("option", { hasText: "Add to: Gym Mix" }).waitFor({ state: "attached" });
  await picker.selectOption({ label: "Add to: Gym Mix" });
  await shot("4d-review-add-to");
  await page.click("#next");
  await page.waitForURL(/\/results\?job=/);
  await page.getByText("All done!").waitFor({ timeout: 60_000 });
  await page.locator("#n-already").waitFor();

  step("v1.1 stop a running transfer");
  await page.goto(`${BASE}/transfer`);
  await page.locator('#source-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.locator('#dest-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.locator(".cover-card", { hasText: "Road Trip" }).click();
  await page.click("#next");
  await page.click("#next");
  await page.waitForURL(/\/results\?job=/);
  await page.locator("#stop:not(.hidden)").waitFor();
  page.once("dialog", (d) => d.accept());
  await page.click("#stop");
  await page.waitForFunction(() => document.querySelector("#status-pill").textContent === "Stopped");
  await page.getByText(/already added will stay|Stopped before any songs/).waitFor();
  await page.locator("#retry-box:not(.hidden)").waitFor();
  await shot("4e-stopped");
  await page.goto(resultsUrl);

  step("upload a CSV file as the source");
  await page.goto(`${BASE}/transfer`);
  await page.locator('#source-tiles [data-id="file"]').click();
  await page.setInputFiles("#file", {
    name: "mix.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("title,artist\nBohemian Rhapsody,Queen\nBlinding Lights,The Weeknd\nNot A Real Song,Nobody\n"),
  });
  await page.getByText("Found 1 playlist with 3 songs").waitFor();
  await page.click("#next");
  await page.locator('#dest-tiles [data-id="mock"]').click();
  await page.click("#next");
  await page.click("#next");
  await page.click("#next");
  await page.waitForURL(/\/results\?job=/);
  await page.getByText("All done!").waitFor({ timeout: 60_000 });
  if ((await page.textContent("#n-matched")) !== "2") throw new Error("expected 2 matched from the file");

  step("back up to a file");
  await page.goto(`${BASE}/export`);
  await page.locator(".cover-card", { hasText: "Chill Evenings" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
  console.log(`  downloaded ${download.suggestedFilename()}`);
  if (!download.suggestedFilename().endsWith(".jspf")) throw new Error("expected a .jspf file");

  step("phone-width layout has no sideways scrolling");
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ["/", "/dashboard", "/transfer", "/export", new URL(resultsUrl).pathname + new URL(resultsUrl).search]) {
    await page.goto(BASE + path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`${path} scrolls sideways by ${overflow}px on a phone`);
  }
  await shot("5-mobile-export");

  step("delete account");
  await page.goto(`${BASE}/dashboard`);
  page.once("dialog", (d) => d.accept());
  await page.click("#delete-account");
  await page.waitForURL(BASE + "/");
  const me = await page.request.get(`${BASE}/api/me`);
  if (me.status() !== 401) throw new Error("account should be gone");

  if (errors.length) throw new Error(`browser errors:\n${errors.join("\n")}`);
  console.log("SMOKE TEST PASSED");
} catch (err) {
  await shot("failure").catch(() => {});
  console.error("SMOKE TEST FAILED:", err.message);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
