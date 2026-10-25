import { describe, expect, it } from "vitest";
import {
  defaults,
  effectiveSettingsFor,
  expandPreset,
} from "../src/shared";

describe("effectiveSettingsFor", () => {
  const base = { ...defaults, siteProfiles: {} };

  it("returns settings unchanged when no profile exists", () => {
    expect(effectiveSettingsFor(base, "example.com")).toBe(base);
  });

  it("applies only defined override fields", () => {
    const settings = {
      ...base,
      siteProfiles: {
        "example.com": {
          smartCleanup: false,
          minImageSize: 512,
          downloadFolder: "Example/Shots",
        },
      },
    };
    const eff = effectiveSettingsFor(settings, "example.com");
    expect(eff.smartCleanup).toBe(false);
    expect(eff.minImageSize).toBe(512);
    expect(eff.downloadFolder).toBe("Example/Shots");
    // Unspecified fields keep global values.
    expect(eff.allowedFormats).toEqual(["jpeg", "png"]);
    expect(eff.hideAvatars).toBe(false);
    // The global object is not mutated.
    expect(settings.smartCleanup).toBe(true);
  });

  it("ignores malformed profile values", () => {
    const settings = {
      ...base,
      siteProfiles: {
        "example.com": {
          minImageSize: -5,
          allowedFormats: [],
          smartCleanup: "yes",
        } as any,
      },
    };
    const eff = effectiveSettingsFor(settings, "example.com");
    expect(eff.minImageSize).toBe(defaults.minImageSize);
    expect(eff.allowedFormats).toEqual(["jpeg", "png"]);
    expect(eff.smartCleanup).toBe(true);
  });
});

describe("expandPreset", () => {
  const ctx = {
    index: 7,
    hostname: "photos.example.com",
    date: "2026-10-25",
    title: "Trip to the coast",
  };

  it("expands every token", () => {
    expect(expandPreset("{hostname}-{date}-{index}-{title}", ctx)).toBe(
      "photos.example.com-2026-10-25-7-Trip to the coast",
    );
  });

  it("leaves unknown tokens intact", () => {
    expect(expandPreset("album-{nope}-{index}", ctx)).toBe("album-{nope}-7");
  });

  it("is idempotent on already-expanded output", () => {
    const once = expandPreset("{hostname}-{date}", ctx);
    expect(expandPreset(once, ctx)).toBe(once);
  });
});
