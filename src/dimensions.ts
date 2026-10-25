/**
 * Image dimensions parsed from container headers alone. Lets the probe
 * resolve sizes from the 4 KB ranged GET instead of downloading whole files
 * for decode. Returns undefined for formats without a cheap header layout
 * (AVIF's ISOBMFF boxes, TIFF's IFDs, SVG) — callers then fall back.
 *
 * All signature checks are raw byte comparisons: TextDecoder treats "latin1"
 * as windows-1252 (0x89 decodes to U+2030, not U+0089), so decoded strings
 * are not reliable signatures. Every read is bounds-safe via .at(); out-of-
 * range reads yield 0 and the format guards decide validity.
 */
export function sniffDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const u8 = (o: number) => bytes.at(o) ?? 0;
  const u16 = (o: number) => u8(o) | (u8(o + 1) << 8);
  const be32 = (o: number) =>
    ((u8(o) << 24) | (u8(o + 1) << 16) | (u8(o + 2) << 8) | u8(o + 3)) >>> 0;
  const le32 = (o: number) =>
    u8(o) | (u8(o + 1) << 8) | (u8(o + 2) << 16) | (u8(o + 3) << 24);
  const word = (o: number, s: string) =>
    u8(o) === s.charCodeAt(0) &&
    u8(o + 1) === s.charCodeAt(1) &&
    u8(o + 2) === s.charCodeAt(2) &&
    u8(o + 3) === s.charCodeAt(3);
  if (
    u8(0) === 0x89 &&
    u8(1) === 0x50 &&
    u8(2) === 0x4e &&
    u8(3) === 0x47 &&
    bytes.length >= 24
  ) {
    // IHDR: width/height are fixed 32-bit BE at offsets 16/20.
    return { width: be32(16), height: be32(20) };
  }
  if (word(0, "GIF8") && bytes.length >= 10) {
    return { width: u16(6), height: u16(8) };
  }
  if (u8(0) === 0xff && u8(1) === 0xd8) {
    // JPEG: walk the marker segments; dimensions live in the first SOFn.
    let o = 2;
    while (o + 9 < bytes.length) {
      if (u8(o) !== 0xff) {
        o++;
        continue;
      }
      const marker = u8(o + 1);
      if (marker === 0xff) {
        o++;
        continue;
      }
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof)
        return {
          width: (u8(o + 7) << 8) | u8(o + 8),
          height: (u8(o + 5) << 8) | u8(o + 6),
        };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const length = (u8(o + 2) << 8) | u8(o + 3);
      if (length < 2) return undefined;
      o += 2 + length;
    }
    return undefined;
  }
  if (word(0, "RIFF") && word(8, "WEBP") && bytes.length >= 30) {
    if (word(12, "VP8X")) {
      // 24-bit LE canvas-minus-one at offsets 24/27.
      const width = 1 + (u8(24) | (u8(25) << 8) | (u8(26) << 16));
      const height = 1 + (u8(27) | (u8(28) << 8) | (u8(29) << 16));
      return { width, height };
    }
    if (word(12, "VP8 ")) {
      // Lossy keyframe: 3-byte frame tag, 0x9d 0x01 0x2a sync, then 14-bit dims.
      if (u8(26) !== 0x9d || u8(27) !== 0x01 || u8(28) !== 0x2a)
        return undefined;
      return { width: u16(29) & 0x3fff, height: u16(31) & 0x3fff };
    }
    if (word(12, "VP8L")) {
      if (u8(21) !== 0x2f) return undefined;
      const width = 1 + ((u8(22) | (u8(23) << 8)) & 0x3fff);
      const height =
        1 + (((u8(23) >> 6) | (u8(24) << 2) | (u8(25) << 10)) & 0x3fff);
      return { width, height };
    }
    return undefined;
  }
  if (u8(0) === 0x42 && u8(1) === 0x4d && bytes.length >= 26) {
    // BITMAPINFOHEADER: signed LE width/height at 18/22; height may be negative (top-down).
    return { width: le32(18), height: Math.abs(le32(22)) };
  }
  if (u8(0) === 0 && u8(1) === 0 && u8(2) === 1 && bytes.length >= 22) {
    // ICONDIR (reserved 0, type 1 = icon, count ≥ 1) + first 16-byte entry.
    // 0 in an entry means 256.
    const width = u8(6) || 256;
    const height = u8(7) || 256;
    return { width, height };
  }
  return undefined;
}
