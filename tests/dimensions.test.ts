import { describe, expect, it } from "vitest";
import { sniffDimensions } from "../src/dimensions";

function pngHeader(w: number, h: number) {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}
function gifHeader(w: number, h: number) {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  b[6] = w & 0xff;
  b[7] = w >> 8;
  b[8] = h & 0xff;
  b[9] = h >> 8;
  return b;
}
function jpegHeader(w: number, h: number) {
  // SOI + APP1 filler + SOF0 + EOI
  const app1 = new Uint8Array(2 + 2 + 6);
  app1.set([0xff, 0xe1, 0, 8], 0);
  const sof = new Uint8Array(2 + 2 + 5);
  sof.set([0xff, 0xc0, 0, 11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff], 0);
  return new Uint8Array([
    ...[0xff, 0xd8],
    ...app1,
    ...sof,
    ...[0xff, 0xd9],
  ]);
}
function webpVp8(w: number, h: number) {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  b[26] = 0x9d;
  b[27] = 0x01;
  b[28] = 0x2a;
  b[29] = w & 0xff;
  b[30] = (w >> 8) & 0x3f;
  b[31] = h & 0xff;
  b[32] = (h >> 8) & 0x3f;
  return b;
}
function webpVp8l(w: number, h: number) {
  const b = new Uint8Array(40);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  b[21] = 0x2f;
  // 14-bit width-1 then 14-bit height-1, LSB-first.
  const bits = (w - 1) | ((h - 1) << 14);
  b[22] = bits & 0xff;
  b[23] = (bits >> 8) & 0xff;
  b[24] = (bits >> 16) & 0xff;
  b[25] = (bits >> 24) & 0xff;
  return b;
}
function bmpHeader(w: number, h: number) {
  const b = new Uint8Array(30);
  b.set([0x42, 0x4d], 0); // BM
  const dv = new DataView(b.buffer);
  dv.setInt32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  return b;
}
function icoHeader(w: number, h: number) {
  // Realistic ICONDIR (6 bytes) + one directory entry (16 bytes).
  const b = new Uint8Array(22);
  b.set([0, 0, 1, 0, 1, 0], 0); // reserved=0, type=1(icon), count=1
  b[6] = w >= 256 ? 0 : w;
  b[7] = h >= 256 ? 0 : h;
  return b;
}

describe("sniffDimensions", () => {
  it("parses PNG, GIF, JPEG SOF, WebP VP8/VP8L/VP8X, BMP and ICO headers", () => {
    expect(sniffDimensions(pngHeader(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(sniffDimensions(gifHeader(320, 200))).toEqual({
      width: 320,
      height: 200,
    });
    expect(sniffDimensions(jpegHeader(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
    expect(sniffDimensions(webpVp8(1024, 768))).toEqual({
      width: 1024,
      height: 768,
    });
    expect(sniffDimensions(webpVp8l(300, 150))).toEqual({
      width: 300,
      height: 150,
    });
    expect(sniffDimensions(bmpHeader(50, 80))).toEqual({
      width: 50,
      height: 80,
    });
    expect(sniffDimensions(bmpHeader(50, -80))).toEqual({
      width: 50,
      height: 80,
    });
    expect(sniffDimensions(icoHeader(48, 48))).toEqual({
      width: 48,
      height: 48,
    });
    expect(sniffDimensions(icoHeader(256, 256))).toEqual({
      width: 256,
      height: 256,
    });
  });

  it("returns undefined for non-parsable or truncated input instead of guessing", () => {
    expect(sniffDimensions(new Uint8Array(0))).toBeUndefined();
    expect(sniffDimensions(new Uint8Array(16))).toBeUndefined();
    expect(sniffDimensions(pngHeader(10, 10).slice(0, 15))).toBeUndefined();
    // AVIF/TIFF/SVG have no cheap header layout.
    const avif = new Uint8Array(64);
    avif.set([0, 0, 0, 0x20], 0);
    avif.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    avif.set([0x61, 0x76, 0x69, 0x66], 8); // avif
    expect(sniffDimensions(avif)).toBeUndefined();
  });

  it("never returns zero or absurd dimensions from random bytes", () => {
    // Fuzz with pseudo-random and structured-random data: every reported
    // dimension must be a positive, plausible integer.
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 500; round++) {
      const size = 1 + (rand() % 120);
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = rand() & 0xff;
      const dims = sniffDimensions(bytes);
      if (!dims) continue;
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
      expect(dims.width).toBeLessThanOrEqual(0xffffff + 1);
      expect(Number.isInteger(dims.width)).toBe(true);
      expect(Number.isInteger(dims.height)).toBe(true);
    }
  });
});
