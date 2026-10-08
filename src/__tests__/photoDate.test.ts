import { describe, expect, it } from "vitest";
import { readPhotoDate } from "../../shared/photoDate";

/** Builds a minimal JPEG whose EXIF block holds the given date tags. */
function jpeg(tags: { original?: string; modified?: string }, little = true): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // TIFF block: header, IFD0 at 8, then the Exif IFD, then the strings.
  const ifd0Entries = (tags.modified ? 1 : 0) + 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifIfd = 8 + ifd0Size;
  const exifSize = 2 + (tags.original ? 1 : 0) * 12 + 4;
  let data = exifIfd + exifSize;
  const tiff: number[] = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)];
  const strings: number[] = [];
  const entry = (tag: number, value: string) => {
    const e = [...u16(tag), ...u16(2), ...u32(value.length + 1), ...u32(data)];
    strings.push(...str(value));
    data += value.length + 1;
    return e;
  };
  tiff.push(...u16(ifd0Entries));
  if (tags.modified) tiff.push(...entry(0x0132, tags.modified));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd), ...u32(0));
  tiff.push(...u16(tags.original ? 1 : 0));
  if (tags.original) tiff.push(...entry(0x9003, tags.original));
  tiff.push(...u32(0), ...strings);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  bytes.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2);
  return new Uint8Array(bytes).buffer;
}

describe("readPhotoDate", () => {
  it("reads the date the photo was taken", () => {
    expect(readPhotoDate(jpeg({ original: "2026:09:15 18:40:02", modified: "2026:10:01 09:00:00" }))).toBe("2026-09-15");
  });

  it("reads big-endian EXIF too", () => {
    expect(readPhotoDate(jpeg({ original: "2025:12:31 23:59:59" }, false))).toBe("2025-12-31");
  });

  it("falls back to the file's DateTime tag", () => {
    expect(readPhotoDate(jpeg({ modified: "2026:03:02 10:00:00" }))).toBe("2026-03-02");
  });

  it("returns null without a usable date", () => {
    expect(readPhotoDate(jpeg({}))).toBeNull();
    expect(readPhotoDate(jpeg({ original: "0000:00:00 00:00:00" }))).toBeNull();
    expect(readPhotoDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
  });
});
