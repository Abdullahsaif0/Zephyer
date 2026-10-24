import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  absolute,
  filename,
  formatOf,
  mergeVariants,
  networkUrl,
  safeUrl,
  sanitize,
  variant,
  type ImageRecord,
} from "../src/shared";
import { parseSrcset } from "../src/adapters";
import { normalizeDownloadFolder } from "../src/download-settings";
import { validHostname } from "../src/preferences";

// eslint-disable-next-line no-control-regex -- the parsers deliberately strip these
const illegal = /[<>:"/\\|?*\u0000-\u001f]/;
const arbitraryText = fc.string({ maxLength: 300 });

describe("sanitize properties", () => {
  it("never emits Windows-illegal characters, trailing dots/spaces, or empty output", () => {
    fc.assert(
      fc.property(arbitraryText, (s) => {
        const out = sanitize(s);
        expect(out).not.toMatch(illegal);
        expect(out).not.toMatch(/[. ]$/);
        expect(out.length).toBeGreaterThan(0);
        expect(out.length).toBeLessThanOrEqual(110);
      }),
    );
  });
  it("never returns a Windows reserved device name", () => {
    fc.assert(
      fc.property(arbitraryText, (s) => {
        expect(sanitize(s)).not.toMatch(
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i,
        );
      }),
    );
  });
});

describe("filename properties", () => {
  const record = (displayed: string) => ({ displayed }) as ImageRecord;
  it("always matches the NNNNN-name.ext shape with a known extension", () => {
    fc.assert(
      fc.property(arbitraryText, fc.nat(100000), (s, i) => {
        const out = filename(record(s), i);
        expect(out).toMatch(/^\d{4,}-/);
        expect(out).not.toMatch(illegal);
        expect(out).toMatch(/\.(jpg|png|webp|gif|svg|avif|bmp|ico|tiff|img)$/);
      }),
    );
  });
});

describe("parseSrcset properties", () => {
  it("never throws on arbitrary input and only yields non-negative widths", () => {
    fc.assert(
      fc.property(arbitraryText, (raw) => {
        const out = parseSrcset(raw, "https://x.test/page");
        for (const v of out) expect(v.width).toBeGreaterThanOrEqual(0);
      }),
    );
  });
  it("parses every well-formed candidate", () => {
    fc.assert(
      fc.property(
        fc
          .webUrl({ withQueryParameters: false, withFragments: false })
          // Trailing commas are srcset separators, so comma-bearing URLs
          // would not round-trip byte-for-byte (spec behavior, not a bug).
          .filter((u) => !u.includes(",")),
        fc.integer({ min: 1, max: 8000 }),
        (url, width) => {
          const raw = `${url} ${String(width)}w`;
          const out = parseSrcset(raw, "https://x.test/page");
          expect(out.map((v) => v.url)).toContain(new URL(url).href);
          const found = out.find((v) => v.url === new URL(url).href);
          expect(found?.width).toBe(width);
        },
      ),
    );
  });
});

describe("normalizeDownloadFolder properties", () => {
  it("either throws or returns a safe relative path", () => {
    fc.assert(
      fc.property(arbitraryText, (s) => {
        let out: string;
        try {
          out = normalizeDownloadFolder(s);
        } catch {
          return;
        }
        if (!out) return;
        expect(out.startsWith("/")).toBe(false);
        expect(out).not.toMatch(/^[a-z]:/i);
        expect(out.length).toBeLessThanOrEqual(200);
        for (const p of out.split("/"))
          expect(p).not.toMatch(/^[. ]|[. ]$|^\.{1,2}$|^$/);
      }),
    );
  });
  it("is idempotent on its own output", () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc
              .string({ minLength: 1, maxLength: 20 })
              .filter(
                (p) =>
                  !illegal.test(p) &&
                  !p.includes("/") &&
                  !/^[. ]|[. ]$/.test(p) &&
                  p !== "." &&
                  p !== "..",
              ),
            { maxLength: 5 },
          )
          .map((parts) => parts.join("/")),
        (folder) => {
          let once: string;
          try {
            once = normalizeDownloadFolder(folder);
          } catch {
            return;
          }
          expect(normalizeDownloadFolder(once)).toBe(once);
        },
      ),
    );
  });
});

describe("mergeVariants properties", () => {
  it("caps results at 80 and keeps URLs unique", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { maxLength: 120 }),
        fc.array(fc.webUrl(), { maxLength: 120 }),
        (a, b) => {
          const out = mergeVariants(
            a.map((u) => variant(u, "src")),
            b.map((u) => variant(u, "src")),
          );
          expect(out.length).toBeLessThanOrEqual(80);
          expect(new Set(out.map((v) => v.url)).size).toBe(out.length);
        },
      ),
    );
  });
});

describe("URL helper properties", () => {
  it("absolute/safeUrl/networkUrl/formatOf never throw on arbitrary input", () => {
    fc.assert(
      fc.property(arbitraryText, fc.webUrl(), (raw, base) => {
        expect(() => formatOf(raw)).not.toThrow();
        expect(() => safeUrl(raw)).not.toThrow();
        expect(() => networkUrl(raw)).not.toThrow();
        expect(() => absolute(raw, base)).not.toThrow();
        const fmt = formatOf(raw);
        expect(typeof fmt).toBe("string");
        expect(fmt.length).toBeGreaterThan(0);
      }),
    );
  });
  it("safeUrl only returns http(s) URLs", () => {
    fc.assert(
      fc.property(arbitraryText, (raw) => {
        const out = safeUrl(raw);
        if (out) expect(out).toMatch(/^https?:\/\//);
      }),
    );
  });
});

describe("validHostname properties", () => {
  it("never throws and rejects obvious non-hostnames", () => {
    fc.assert(
      fc.property(arbitraryText, (s) => {
        const out = validHostname(s);
        expect(typeof out).toBe("boolean");
        if (out) {
          expect(s).not.toMatch(/[/\\?#@\s]/);
          expect(s.length).toBeLessThanOrEqual(253);
        }
      }),
    );
  });
  it("accepts well-formed hostnames", () => {
    for (const host of [
      "example.com",
      "www.example.com",
      "sub.domain.example.co.uk",
      "localhost",
    ])
      expect(validHostname(host)).toBe(true);
    for (const bad of [
      "https://example.com",
      "example.com/path",
      "example.com:8080",
      "",
      "bad example",
    ])
      expect(validHostname(bad)).toBe(false);
  });
});
