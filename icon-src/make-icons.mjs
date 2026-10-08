// Renders the app icons from icon-src/logo.svg (the Frontier Security Institute mark).
// Run: node icon-src/make-icons.mjs   Outputs go to public/icons.
// Uses the Playwright Chromium already in devDependencies; set CHROMIUM_PATH to use another.
import fs from "node:fs";
import { chromium } from "playwright";

const logo = fs.readFileSync(new URL("./logo.svg", import.meta.url), "utf8");
const LOGO_W = 103;
const LOGO_H = 93;
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The logo centered on a 512 x 512 canvas, `width` pixels wide. */
const placed = (width, body = inner) => {
  const s = width / LOGO_W;
  const x = (512 - width) / 2;
  const y = (512 - LOGO_H * s) / 2;
  return `<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`;
};
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

// One-color version for Android themed icons: every mark white, no white panel behind it.
const mono = inner
  .replace(/<rect x="5" y="5" width="93" height="83" fill="#fff"\/>/, "")
  .replace(/#ED1C24|#1C1D5F/g, "#fff");

const drawings = {
  // Browsers and desktop installs: white rounded square with the logo.
  "icon.svg": svg(`<rect width="512" height="512" rx="96" fill="#fff"/>${placed(420)}`),
  // Android adaptive ("maskable"): white fills the square; the logo's corners stay inside
  // the central safe circle (40% of the width from the center), so no crop cuts the frame.
  "maskable.svg": svg(`<rect width="512" height="512" fill="#fff"/>${placed(290)}`),
  // Android 13+ themed icons: one color on transparent; Android tints it to the wallpaper.
  "monochrome.svg": svg(placed(290, mono)),
  // iPhone home screen: full square, iOS rounds the corners itself.
  "apple.svg": svg(`<rect width="512" height="512" fill="#fff"/>${placed(400)}`),
};

const out = "public/icons";
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(`${out}/icon.svg`, drawings["icon.svg"]);

const renders = [
  ["icon.svg", "icon-192.png", 192], ["icon.svg", "icon-512.png", 512],
  ["maskable.svg", "maskable-192.png", 192], ["maskable.svg", "maskable-512.png", 512],
  ["monochrome.svg", "monochrome-512.png", 512],
  ["apple.svg", "apple-touch-icon.png", 180],
];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [src, file, size] of renders) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const body = drawings[src].replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${body}`);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log(`Wrote ${renders.length} PNGs and icon.svg to ${out}`);
