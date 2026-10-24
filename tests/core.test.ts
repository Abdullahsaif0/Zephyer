import { describe, it, expect } from "vitest";
import {
  archiveFits,
  ARCHIVE_LIMIT,
  absolute,
  candidates,
  filename,
  filterRecords,
  hash,
  mergeVariants,
  resized,
  safeUrl,
  sanitize,
  variant,
  type ImageRecord,
} from "../src/shared";
import { parseSrcset } from "../src/adapters";
const record = (values: Partial<ImageRecord> = {}): ImageRecord => ({
  id: "1",
  tabId: 1,
  documentId: "document",
  frameId: 0,
  pageUrl: "https://example.com",
  source: "image",
  name: "Photo",
  displayed: "https://cdn.example.com/thumb.jpg",
  variants: [
    variant("https://cdn.example.com/thumb.jpg", "displayed", 200, 100, true),
    variant(
      "https://cdn.example.com/full.jpg?signature=a%2Fb&width=2400",
      "srcset",
      2400,
      1200,
    ),
  ],
  width: 200,
  height: 100,
  selected: false,
  status: "ready",
  anchored: true,
  updated: 0,
  ...values,
});
describe("URL and variant integrity", () => {
  it("preserves signatures and meaningful query parameters", () =>
    expect(
      absolute("/photo.jpg?sig=a%2Fb&w=900#fragment", "https://cdn.test"),
    ).toBe("https://cdn.test/photo.jpg?sig=a%2Fb&w=900"));
  it("rejects script, file and extension URLs", () => {
    for (const u of [
      "javascript:alert(1)",
      "file:///secret",
      "chrome-extension://abc/panel.html",
    ])
      expect(safeUrl(u)).toBe(false);
  });
  it("deduplicates identical URLs without losing verified dimensions", () => {
    const v = mergeVariants(
      [variant("https://x/a.png", "displayed", 400, 200, true)],
      [variant("https://x/a.png", "src")],
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ width: 400, height: 200, verified: true });
  });
  it("keeps differently signed resources separate", () =>
    expect(
      mergeVariants(
        [variant("https://x/a?sig=1", "src")],
        [variant("https://x/a?sig=2", "src")],
      ),
    ).toHaveLength(2));
  it("sorts best, displayed and explicitly selected variants", () => {
    const r = record();
    expect(candidates(r, "best")[0].width).toBe(2400);
    expect(candidates(r, "displayed")[0].width).toBe(200);
    expect(candidates(r, r.displayed)[0].url).toBe(r.displayed);
  });
  it("parses responsive width and density lists without rewriting URLs", () => {
    expect(
      parseSrcset("/a.png?w=400 400w, /a.png?w=800 800w", "https://x.test"),
    ).toMatchObject([{ width: 400 }, { width: 800 }]);
    expect(parseSrcset("/a.png 1x, /b.png 2x", "https://x.test")).toHaveLength(
      2,
    );
  });
});
describe("output behavior", () => {
  it("preserves aspect ratio and does not upscale by default", () => {
    expect(resized(800, 400, 200, 200)).toEqual({ width: 200, height: 100 });
    expect(resized(800, 400, 1600, 0)).toEqual({ width: 800, height: 400 });
    expect(resized(800, 400, 1600, 0, true)).toEqual({
      width: 1600,
      height: 800,
    });
  });
  it("retains original bounds with no resize", () =>
    expect(resized(640, 480, 0, 0)).toEqual({ width: 640, height: 480 }));
  it("sanitizes Windows reserved names and path injection", () => {
    expect(sanitize("CON")).toBe("_CON");
    expect(sanitize("../private:image?")).not.toMatch(/[\\/:?]/);
    expect(filename(record(), 3, "jpeg")).toBe("0004-thumb.jpg");
  });
  it("filters collection snapshots without mutating selected records", () => {
    const a = record({ selected: true }),
      b = record({
        id: "2",
        name: "Logo",
        variants: [variant("https://x/logo.png", "src", 64, 64)],
      });
    expect(filterRecords([a, b], "photo", 1000, "jpeg")).toEqual([a]);
    expect(b.selected).toBe(false);
  });
  it("splits archives before the 250 MB input boundary", () => {
    expect(archiveFits(ARCHIVE_LIMIT - 10, 10)).toBe(true);
    expect(archiveFits(ARCHIVE_LIMIT - 10, 11)).toBe(false);
  });
  it("ranks responsive width-only descriptors against measured candidates", () => {
    const r = record({
      variants: [
        variant("https://x/small", "displayed", 640, 480),
        variant("https://x/large", "srcset", 2400),
      ],
    });
    expect(candidates(r, "best")[0].width).toBe(2400);
  });
  it("uses stable distinct URL identities", () => {
    expect(hash("https://a?a=1")).toBe(hash("https://a?a=1"));
    expect(hash("https://a?a=1")).not.toBe(hash("https://a?a=2"));
  });
});
