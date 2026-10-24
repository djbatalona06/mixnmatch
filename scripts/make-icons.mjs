// Draws the app icons (PNG) from one SVG, using the Chromium that Playwright already has.
// Run: npm run icons   -> writes app/public/icons/*.png
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const OUT = new URL("../app/public/icons/", import.meta.url).pathname;
const executablePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

// Two records: a dark one with a white rim, and an amber one in front.
// `scale` shrinks the records so maskable icons keep them inside the safe circle (80%).
const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0a0a0a"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="200" cy="200" r="150" fill="#1a1a1a" stroke="#f5f5f5" stroke-width="18"/>
    <circle cx="200" cy="200" r="34" fill="#f5f5f5"/>
    <circle cx="312" cy="312" r="150" fill="#f59e0b"/>
    <circle cx="312" cy="312" r="34" fill="#0a0a0a"/>
  </g>
</svg>`;

const ICONS = [
  { file: "icon-192x192.png", size: 192, scale: 0.9 },
  { file: "icon-512x512.png", size: 512, scale: 0.9 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.86 },
  { file: "maskable-icon.png", size: 512, scale: 0.7 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath });
for (const { file, size, scale } of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg(scale)}`);
  await page.screenshot({ path: OUT + file, omitBackground: false });
  await page.close();
  console.log(`wrote icons/${file}`);
}
await browser.close();
