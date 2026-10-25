// Smoke test for a live deployment. Run it after every Vercel deploy.
// Usage:  npm run smoke:deploy -- https://your-site.vercel.app
// It only reads: no sign-in, no changes. Exits with 1 if any check fails.
const base = (process.argv[2] ?? process.env.DEPLOY_URL ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Give the site address, e.g.  npm run smoke:deploy -- https://your-site.vercel.app");
  process.exit(2);
}

let failures = 0;
const get = (path) => fetch(base + path, { redirect: "manual" });

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`✗ ${name}: ${err.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await check("home page loads", async () => {
  const res = await get("/");
  expect(res.status === 200, `status ${res.status}`);
  expect((await res.text()).includes("Take your music"), "the home page text is missing");
});

await check("the API answers with JSON", async () => {
  const res = await get("/api/platforms");
  expect(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  expect(Array.isArray(body.platforms), "no platform list");
});

await check("account details need a sign-in", async () => {
  const res = await get("/api/me");
  expect(res.status === 401, `expected 401, got ${res.status}`);
});

await check("the cron refuses callers without the secret", async () => {
  const res = await get("/api/cron/tick");
  expect(res.status === 401, `expected 401, got ${res.status}`);
});

await check("security headers are set", async () => {
  const res = await get("/");
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp.includes("script-src 'self'"), "Content-Security-Policy is missing or weaker");
  expect(res.headers.get("x-frame-options") === "DENY", "X-Frame-Options is not DENY");
  expect(res.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is missing");
});

await check("Vercel Web Analytics script is served", async () => {
  const res = await get("/_vercel/insights/script.js");
  expect(res.status === 200, `status ${res.status}: turn on Web Analytics in the Vercel project settings`);
});

await check("Speed Insights script is served", async () => {
  const res = await get("/_vercel/speed-insights/script.js");
  expect(res.status === 200, `status ${res.status}: turn on Speed Insights in the Vercel project settings`);
});

await check("the sign-in page does not load analytics", async () => {
  const html = await (await get("/login")).text();
  expect(!html.includes("/_vercel/insights/"), "analytics found on the sign-in page");
});

await check("unknown pages get the 404 page", async () => {
  const res = await get("/this-page-does-not-exist");
  expect(res.status === 404, `expected 404, got ${res.status}`);
});

console.log(failures ? `\n${failures} check(s) failed on ${base}` : `\nAll checks passed on ${base}`);
process.exit(failures ? 1 : 0);
