import { parseCardText, type ParsedCard } from "../../shared/cardParse";

export interface ScanProgress {
  label: string;
  progress: number;
}

/** Phone photos run 3-12 MB; shrink to a size that reads well and uploads fast. */
async function shrink(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process the photo."))), "image/jpeg", 0.88),
  );
}

/**
 * Reads a business card photo on the device with tesseract.js, then a rule-based parser
 * picks out the fields. The photo never leaves the phone or laptop.
 */
export async function readCard(file: File, onProgress: (p: ScanProgress) => void): Promise<ParsedCard> {
  onProgress({ label: "Preparing photo…", progress: 0.05 });
  const image = await shrink(file);
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
    const { data } = await worker.recognize(image);
    return parseCardText(data.text);
  } finally {
    await worker.terminate();
  }
}
