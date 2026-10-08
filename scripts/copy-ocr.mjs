// Copies the on-device OCR engine and English model into public/ so card scanning works
// without reaching a CDN (many organization networks block those). Runs before dev/build.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("public/tesseract");
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

copy("node_modules/tesseract.js/dist/worker.min.js", path.join(out, "worker.min.js"));
for (const f of fs.readdirSync("node_modules/tesseract.js-core")) {
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copy(path.join("node_modules/tesseract.js-core", f), path.join(out, "core", f));
}
copy("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", path.join(out, "lang", "eng.traineddata.gz"));
console.log("OCR files copied to public/tesseract");
