import { describe, expect, it } from "vitest";
import { defaults } from "../src/shared";
import { pagePower, mergeSiteRules } from "../src/power";

describe("website power", () => {
  it("defaults on and scopes exact hostnames independently of ports and subdomains", () => {
    expect(pagePower(defaults, "https://example.com/a").effectiveEnabled).toBe(
      true,
    );
    const settings = { ...defaults, disabledSites: ["example.com"] };
    expect(pagePower(settings, "http://example.com:9000/b").reason).toBe(
      "site-off",
    );
    expect(
      pagePower(settings, "https://www.example.com").effectiveEnabled,
    ).toBe(true);
  });
  it("global pause overrides an enabled site without changing its preference", () => {
    const power = pagePower(
      { ...defaults, enabled: false },
      "https://example.com",
    );
    expect(power.siteEnabled).toBe(true);
    expect(power.effectiveEnabled).toBe(false);
    expect(power.reason).toBe("global-off");
  });
  it("restricted and malformed pages cannot be activated", () => {
    for (const url of ["chrome://settings", "file:///image.png", "invalid", ""])
      expect(pagePower(defaults, url).reason).toBe("restricted");
  });
  it("merges edited rules without losing unrelated concurrent changes", () => {
    expect(
      mergeSiteRules(["a.com", "new.com"], ["a.com"], ["b.com"]).sort(),
    ).toEqual(["b.com", "new.com"]);
    expect(mergeSiteRules([], ["a.com"], ["a.com", "b.com"])).toEqual([
      "b.com",
    ]);
  });
  it("deduplicates and supports removing all rules from the editor baseline", () => {
    expect(mergeSiteRules(["a.com", "b.com"], ["a.com"], [])).toEqual([
      "b.com",
    ]);
    expect(mergeSiteRules(["a.com"], [], ["a.com", "a.com"])).toEqual([
      "a.com",
    ]);
  });
});
