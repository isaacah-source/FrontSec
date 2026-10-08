// Renders the app icons from the SVG drawings below. Run: node icon-src/make-icons.mjs
// Outputs go to public/icons. Uses the Playwright Chromium already in devDependencies.
import fs from "node:fs";
import { chromium } from "playwright";

const NAVY = "#1f3a5f";
// Three people and the links between them, drawn on a 512 x 512 canvas.
const glyph = (scale, mono = false) => {
  const c = (hex) => (mono ? "#fff" : hex);
  // translate(0 15) centers the three nodes vertically (their midpoint sits at y = 241).
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -241)">
    <g stroke="${c("#9fc0ff")}" stroke-width="18" stroke-linecap="round">
      <line x1="176" y1="200" x2="342" y2="184"/>
      <line x1="176" y1="200" x2="252" y2="338"/>
      <line x1="342" y1="184" x2="252" y2="338"/>
    </g>
    <circle cx="176" cy="200" r="50" fill="${c("#ffffff")}"/>
    <circle cx="342" cy="184" r="42" fill="${c("#ffd27a")}"/>
    <circle cx="252" cy="338" r="50" fill="${c("#7fb0ff")}"/>
  </g>`;
};
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

const drawings = {
  // Standard icon: rounded square, used by browsers and desktop installs.
  "icon.svg": svg(`<rect width="512" height="512" rx="112" fill="${NAVY}"/>${glyph(1.3)}`),
  // Android adaptive ("maskable"): background fills the square and the drawing stays inside
  // the central safe circle (40% radius), so any crop Android applies keeps it whole.
  "maskable.svg": svg(`<rect width="512" height="512" fill="${NAVY}"/>${glyph(1.15)}`),
  // Android 13+ themed icons: one color on transparent; Android tints it to the wallpaper.
  "monochrome.svg": svg(glyph(1.15, true)),
  // iPhone home screen: full square, iOS rounds the corners itself.
  "apple.svg": svg(`<rect width="512" height="512" fill="${NAVY}"/>${glyph(1.3)}`),
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
