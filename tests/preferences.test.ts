import { describe, it, expect } from "vitest";
import { defaults } from "../src/shared";
import { preferenceError, validHostname } from "../src/preferences";

describe("preference boundaries", () => {
  it("accepts exact hostnames, localhost, IP and punycode", () => {
    for (const host of [
      "example.com",
      "www.example.com",
      "localhost",
      "127.0.0.1",
      "xn--bcher-kva.de",
    ])
      expect(validHostname(host)).toBe(true);
  });
  it("rejects URLs, credentials, ports and paths instead of silently disabling the wrong site", () => {
    for (const host of [
      "",
      "https://example.com",
      "example.com/path",
      "user@example.com",
      "example.com:443",
      "example.com?x=1",
      "Example.com",
      null,
    ])
      expect(validHostname(host)).toBe(false);
  });
  it("reports field-specific path and naming failures", () => {
    expect(
      preferenceError("downloadFolder", {
        ...defaults,
        downloadFolder: "../private",
      }),
    ).toContain("invalid");
    expect(
      preferenceError("sequencePrefix", { ...defaults, sequencePrefix: "a/b" }),
    ).toContain("filename-safe");
    expect(
      preferenceError("downloadFolder", {
        ...defaults,
        downloadFolder: "Pictures/My collection",
      }),
    ).toBe("");
  });
  it("rejects invalid numeric limits and retains supported fractional scan time", () => {
    expect(
      preferenceError("concurrency", { ...defaults, concurrency: 1.5 }),
    ).toContain("whole");
    expect(
      preferenceError("concurrency", { ...defaults, concurrency: 9 }),
    ).toContain("1 to 8");
    expect(
      preferenceError("scanImages", { ...defaults, scanImages: Infinity }),
    ).toContain("finite");
    expect(
      preferenceError("scanMinutes", { ...defaults, scanMinutes: 0.5 }),
    ).toBe("");
  });
});
