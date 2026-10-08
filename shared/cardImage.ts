/**
 * Finds the business card in a photo so the text reader only sees the card.
 *
 * Cards are almost always lighter than what they sit on (a desk, a notebook, a hand), and
 * busy backgrounds such as leather or wood grain otherwise turn into lines of junk text.
 * Rows where most pixels are light, and columns where a fair share are, mark the card.
 *
 * Returns null when no clear card stands out (a close-up that fills the frame, or a dark
 * card on a light table); the caller then reads the whole photo as before.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function findCardBox(gray: ArrayLike<number>, width: number, height: number): Box | null {
  const LIGHT = 170;
  const step = 4;
  const rowLight = (y: number) => {
    let n = 0;
    for (let x = 0; x < width; x += step) if (gray[y * width + x] > LIGHT) n++;
    return n / Math.ceil(width / step);
  };
  const colLight = (x: number) => {
    let n = 0;
    for (let y = 0; y < height; y += step) if (gray[y * width + x] > LIGHT) n++;
    return n / Math.ceil(height / step);
  };
  const rows: number[] = [];
  for (let y = 0; y < height; y++) if (rowLight(y) > 0.5) rows.push(y);
  const cols: number[] = [];
  for (let x = 0; x < width; x++) if (colLight(x) > 0.2) cols.push(x);
  if (!rows.length || !cols.length) return null;

  const box = { x: cols[0], y: rows[0], w: cols[cols.length - 1] - cols[0] + 1, h: rows[rows.length - 1] - rows[0] + 1 };
  const share = (box.w * box.h) / (width * height);
  // Too small is probably a glare spot; nearly the whole frame means there is nothing to crop.
  if (share < 0.12 || share > 0.92) return null;
  // Keep a small margin so text at the card's edge is not clipped.
  const m = Math.round(Math.min(width, height) * 0.01);
  const x = Math.max(0, box.x - m);
  const y = Math.max(0, box.y - m);
  return { x, y, w: Math.min(width - x, box.w + 2 * m), h: Math.min(height - y, box.h + 2 * m) };
}
