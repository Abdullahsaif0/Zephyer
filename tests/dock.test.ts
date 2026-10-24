import { describe, it, expect } from "vitest";
import { clampPosition, validLayout } from "../src/dock";
import { themeIds, themes, validTheme } from "../src/appearance";
import { defaults } from "../src/shared";
describe("dock layout boundaries", () => {
  it("keeps every edge inside the viewport margin", () => {
    expect(clampPosition(-10, -10, 352, 50, 1000, 700)).toEqual({
      x: 12,
      y: 12,
    });
    expect(clampPosition(9999, 9999, 352, 50, 1000, 700)).toEqual({
      x: 636,
      y: 638,
    });
  });
  it("handles a viewport smaller than the requested panel", () =>
    expect(clampPosition(500, 500, 520, 400, 300, 200)).toEqual({
      x: 12,
      y: 12,
    }));
  it("validates normalized coordinates and restore states", () => {
    expect(
      validLayout({
        x: 0.25,
        y: 1,
        state: "minimized",
        restoreState: "expanded",
      }),
    ).toBe(true);
    for (const v of [
      { x: NaN, y: 0, state: "compact", restoreState: "compact" },
      { x: 2, y: 0, state: "compact", restoreState: "compact" },
      { x: 0, y: 0, state: "unknown", restoreState: "compact" },
      { x: 0, y: 0, state: "compact", restoreState: "minimized" },
    ])
      expect(validLayout(v)).toBe(false);
  });
  it("migrates missing appearance values using explicit defaults", () => {
    const legacy = { enabled: false, concurrency: 2 };
    expect({ ...defaults, ...legacy }).toMatchObject({
      enabled: false,
      concurrency: 2,
      theme: "graphite",
      dockOrientation: "horizontal",
    });
  });
});
function contrast(a: string, b: string) {
  const l = (hex: string) => {
    const c = hex
      .match(/[a-f\d]{2}/gi)!
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  return (Math.max(l(a), l(b)) + 0.05) / (Math.min(l(a), l(b)) + 0.05);
}
describe("curated palettes", () => {
  it("has exactly six explicit theme choices", () => {
    expect(themeIds).toHaveLength(6);
    expect(validTheme("system")).toBe(false);
    expect(validTheme("graphite")).toBe(true);
  });
  it.each(themeIds)("%s keeps body, muted and accent text readable", (id) => {
    const t = themes[id];
    expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
