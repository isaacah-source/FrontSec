/**
 * Reads the date a photo was taken from its EXIF data, as "YYYY-MM-DD".
 *
 * Phone cameras write DateTimeOriginal ("2026:10:08 14:14:27") in the phone's local time,
 * which is the date the person means. Falls back to the file's DateTime tag. Returns null
 * for files without EXIF (screenshots, some edited or converted images).
 */
export function readPhotoDate(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null; // not a JPEG
  let pos = 2;
  while (pos + 4 <= v.byteLength) {
    const marker = v.getUint16(pos);
    const size = v.getUint16(pos + 2);
    if ((marker & 0xff00) !== 0xff00) return null;
    // APP1 segment holding "Exif\0\0" followed by a TIFF block.
    if (marker === 0xffe1 && pos + 10 <= v.byteLength && v.getUint32(pos + 4) === 0x45786966) {
      return fromTiff(v, pos + 10);
    }
    if (marker === 0xffda) return null; // start of image data: no EXIF before it
    pos += 2 + size;
  }
  return null;
}

function fromTiff(v: DataView, tiff: number): string | null {
  const little = v.getUint16(tiff) === 0x4949; // "II" = little-endian, "MM" = big-endian
  const u16 = (o: number) => v.getUint16(o, little);
  const u32 = (o: number) => v.getUint32(o, little);
  const ascii = (o: number, n: number) => {
    let s = "";
    for (let i = 0; i < n && o + i < v.byteLength; i++) {
      const c = v.getUint8(o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  /** Reads the given tags from one directory (IFD); values are offsets into the TIFF block. */
  const readIfd = (ifd: number) => {
    const tags = new Map<number, { count: number; value: number }>();
    if (ifd + 2 > v.byteLength) return tags;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      tags.set(u16(e), { count: u32(e + 4), value: u32(e + 8) });
    }
    return tags;
  };
  const toIso = (raw: string) => {
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
    if (!m || m[1] === "0000") return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  };

  const ifd0 = readIfd(tiff + u32(tiff + 4));
  const exifPtr = ifd0.get(0x8769);
  if (exifPtr) {
    const original = readIfd(tiff + exifPtr.value).get(0x9003);
    const date = original && toIso(ascii(tiff + original.value, original.count));
    if (date) return date;
  }
  const modified = ifd0.get(0x0132);
  return modified ? toIso(ascii(tiff + modified.value, modified.count)) : null;
}
