import { describe, it, expect } from "vitest";
import { defaults, type ImageRecord } from "../src/shared";
import { pagePower } from "../src/power";
import { eligibility } from "../src/discovery";
const image: ImageRecord = {
  id: "image",
  tabId: 1,
  documentId: "doc",
  frameId: 0,
  pageUrl: "https://example.com",
  source: "image",
  name: "Content",
  variants: [
    {
      url: "https://example.com/photo.png",
      format: "png",
      width: 640,
      height: 480,
      method: "src",
      verified: true,
    },
  ],
  displayed: "https://example.com/photo.png",
  width: 640,
  height: 480,
  selected: false,
  status: "ready",
  anchored: true,
  updated: 0,
};
describe("gallery activation and cleanup", () => {
  it("requires activation even when the website is enabled", () => {
    const p = pagePower(defaults, "https://example.com", 0, false);
    expect(p.reason).toBe("inactive");
    expect(p.effectiveEnabled).toBe(false);
    expect(p.collecting).toBe(false);
  });
  it("separates automatic collection from permission to use controls", () => {
    const s = { ...defaults, automaticCollection: false };
    expect(pagePower(s, "https://example.com").effectiveEnabled).toBe(true);
    expect(pagePower(s, "https://example.com").collecting).toBe(false);
    expect(pagePower(s, "https://example.com", 0, true, true).collecting).toBe(
      true,
    );
  });
  it("manual collection cannot bypass global or site rules", () => {
    expect(
      pagePower(
        { ...defaults, enabled: false },
        "https://example.com",
        0,
        true,
        true,
      ).collecting,
    ).toBe(false);
    expect(
      pagePower(
        { ...defaults, disabledSites: ["example.com"] },
        "https://example.com",
        0,
        true,
        true,
      ).collecting,
    ).toBe(false);
  });
  it("hides declared large PNG favicons and interface emoji without a size-only rule", () => {
    for (const signal of ["favicon", "emoji"]) {
      const r = {
        ...image,
        signals: { interfaceAsset: false, avatar: false, [signal]: true },
      };
      expect(eligibility(r, defaults).state).toBe("excluded");
      expect(eligibility({ ...r, userIncluded: true }, defaults).state).toBe(
        "accepted",
      );
    }
  });
  it("retains large logo-design content and unknown sizes without structured evidence", () => {
    expect(
      eligibility({ ...image, name: "Logo design essay" }, defaults).state,
    ).toBe("accepted");
    expect(
      eligibility(
        {
          ...image,
          width: 0,
          height: 0,
          variants: image.variants.map((v) => ({ ...v, width: 0, height: 0 })),
        },
        defaults,
      ).state,
    ).toBe("accepted");
  });
});
