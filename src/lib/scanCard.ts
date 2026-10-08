import { cleanOcrLines, parseCardText, type ParsedCard } from "../../shared/cardParse";
import { findCardBox } from "../../shared/cardImage";

export interface ScanProgress {
  label: string;
  progress: number;
}

/**
 * Prepares the photo for reading: undo the camera's rotation tag, shrink it (phone photos
 * run 3-12 MB), and crop to the card itself, since busy backgrounds such as leather or wood
 * grain otherwise come back as lines of junk text.
 */
async function prepare(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const full = document.createElement("canvas");
  full.width = Math.round(bitmap.width * scale);
  full.height = Math.round(bitmap.height * scale);
  const ctx = full.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, full.width, full.height);
  bitmap.close();

  const rgba = ctx.getImageData(0, 0, full.width, full.height).data;
  const gray = new Uint8Array(full.width * full.height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  const box = findCardBox(gray, full.width, full.height);
  let out = full;
  if (box) {
    out = document.createElement("canvas");
    out.width = box.w;
    out.height = box.h;
    out.getContext("2d")!.drawImage(full, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  }
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the photo."))), "image/png"),
  );
}

/**
 * Reads a business card photo on the device with tesseract.js, then a rule-based parser
 * picks out the fields, using the email and web address to tell the person's name and
 * organization from other text. The photo never leaves the phone or laptop.
 */
export async function readCard(file: File, onProgress: (p: ScanProgress) => void): Promise<ParsedCard> {
  onProgress({ label: "Preparing photo…", progress: 0.05 });
  const image = await prepare(file);
  const { createWorker } = await import("tesseract.js");
  const base = import.meta.env.BASE_URL;
  const worker = await createWorker("eng", 1, {
    // Served by this app (see scripts/copy-ocr.mjs) rather than a public CDN.
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/core`,
    langPath: `${base}tesseract/lang`,
    logger: (m: { status: string; progress: number }) => {
      const label = m.status === "recognizing text" ? "Reading text…" : "Loading reader (first time only)…";
      onProgress({ label, progress: m.status === "recognizing text" ? 0.3 + m.progress * 0.7 : 0.1 + m.progress * 0.2 });
    },
  });
  try {
    // Ask for word positions and confidence so two-column cards can be split and logo
    // scraps dropped before guessing which line is which field.
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return parseCardText(lines.length ? cleanOcrLines(lines).join("\n") : data.text);
  } finally {
    await worker.terminate();
  }
}
