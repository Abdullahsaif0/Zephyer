import { describe, it, expect } from "vitest";
import {
  defaults,
  variant,
  mergeVariants,
  type ImageRecord,
} from "../src/shared";
import {
  eligibility,
  allowedVariants,
  sniffImage,
  validDiscoverySettings,
} from "../src/discovery";
const record = (patch: Partial<ImageRecord> = {}): ImageRecord => ({
  id: "1",
  tabId: 1,
  documentId: "d",
  frameId: 0,
  pageUrl: "https://example.com",
  source: "image",
  name: "Photo",
  variants: [variant("https://example.com/photo.png", "src", 640, 480, true)],
  displayed: "https://example.com/photo.png",
  width: 640,
  height: 480,
  selected: false,
  status: "ready",
  anchored: true,
  updated: 0,
  ...patch,
});
describe("discovery policy", () => {
  it("defaults to JPEG/PNG and validates settings", () => {
    expect(defaults.allowedFormats).toEqual(["jpeg", "png"]);
    expect(validDiscoverySettings(defaults)).toBe(true);
    expect(validDiscoverySettings({ ...defaults, allowedFormats: [] })).toBe(
      false,
    );
    expect(validDiscoverySettings({ ...defaults, minImageSize: NaN })).toBe(
      false,
    );
  });
  it("retains content and does not reject a logo filename alone", () =>
    expect(
      eligibility(record({ name: "A logo design study" }), defaults).state,
    ).toBe("accepted"));
  it("excludes formats until opted in", () => {
    const r = record({
      variants: [variant("https://x.test/photo.webp", "src", 640, 480)],
    });
    expect(eligibility(r, defaults).state).toBe("excluded");
    expect(
      eligibility(r, { ...defaults, allowedFormats: ["webp"] }).state,
    ).toBe("accepted");
  });
  it("hides small assets using both natural dimensions", () => {
    expect(
      eligibility(
        record({
          width: 24,
          height: 24,
          variants: [variant("https://x.test/i.png", "src", 24, 24)],
        }),
        defaults,
      ).reasons,
    ).toContain("Small decorative asset");
    expect(
      eligibility(
        record({
          width: 32,
          height: 200,
          variants: [variant("https://x.test/i.png", "src", 32, 200)],
        }),
        defaults,
      ).state,
    ).toBe("accepted");
  });
  it("keeps a small thumbnail with a large original", () =>
    expect(
      eligibility(
        record({
          width: 24,
          height: 24,
          variants: [
            variant("https://x.test/s.png", "src", 24, 24),
            variant("https://x.test/full.png", "linked original", 1000, 800),
          ],
        }),
        defaults,
      ).state,
    ).toBe("accepted"));
  it("rejects tracking strips independently of small-asset setting", () =>
    expect(
      eligibility(
        record({
          width: 1,
          height: 200,
          variants: [variant("https://x.test/t.png", "src", 1, 200)],
        }),
        { ...defaults, hideSmall: false },
      ).reasons,
    ).toContain("Tracking pixel / spacer"));
  it("retains unknown dimensions", () =>
    expect(
      eligibility(
        record({
          width: 0,
          height: 0,
          variants: [variant("https://x.test/photo.png", "src")],
        }),
        defaults,
      ).state,
    ).toBe("accepted"));
  it("requires review for unresolved formats", () =>
    expect(
      eligibility(
        record({ variants: [variant("https://x.test/image?sig=abc", "src")] }),
        defaults,
      ).state,
    ).toBe("pending"));
  it("requires opt-in even after include override", () =>
    expect(
      eligibility(
        record({
          userIncluded: true,
          variants: [variant("https://x.test/a.svg", "src")],
        }),
        defaults,
      ).state,
    ).toBe("excluded"));
  it("supports content inclusion and optional avatar filtering", () => {
    const r = record({ signals: { interfaceAsset: true, avatar: true } });
    expect(eligibility(r, defaults).state).toBe("excluded");
    expect(eligibility({ ...r, userIncluded: true }, defaults).state).toBe(
      "accepted",
    );
    expect(
      eligibility(
        record({ signals: { interfaceAsset: false, avatar: true } }),
        defaults,
      ).state,
    ).toBe("accepted");
  });
  it("only allows eligible fallback variants and preserves signatures", () => {
    const r = record({
      variants: [
        variant("https://x.test/a.webp", "src"),
        variant("https://x.test/a.png?sig=abc&width=99", "src"),
      ],
    });
    expect(allowedVariants(r, defaults).map((v) => v.url)).toEqual([
      "https://x.test/a.png?sig=abc&width=99",
    ]);
  });
  it("preserves verified MIME through rediscovery", () =>
    expect(
      mergeVariants(
        [
          {
            ...variant("https://x.test/a.jpg", "verified MIME"),
            format: "png",
          },
        ],
        [variant("https://x.test/a.jpg", "src")],
      )[0].format,
    ).toBe("png"));
  it("sniffs actual PNG, JPEG, WebP and SVG signatures", () => {
    expect(sniffImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      "png",
    );
    expect(sniffImage(new Uint8Array([255, 216, 255]))).toBe("jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF0000WEBP"))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="test">'))).toBe(
      "svg",
    );
    expect(sniffImage(new TextEncoder().encode("<html>not image"))).toBe(
      "unknown",
    );
  });
});
