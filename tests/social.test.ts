import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor, socialDocumentKey, validMedia } from "../src/social";
import { probeImage, clearProbe, fetchImageBytes } from "../src/retrieval";
import { defaults } from "../src/shared";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("social identity", () => {
  it.each([
    ["https://www.instagram.com/p/abc/?img_index=2", "instagram:post:abc"],
    ["https://www.facebook.com/photo/?fbid=123", "facebook:post:123"],
    ["https://x.com/name/status/123/photo/2", "x:post:123"],
    ["https://www.pinterest.com/pin/123/", "pinterest:post:123"],
    [
      "https://www.instagram.com/stories/person/123/",
      "instagram:stories:person",
    ],
  ])("scopes %s", (url, expected) => { expect(socialDocumentKey(url)).toBe(expected); },
  );
  it("rejects lookalike hosts and malformed media", () => {
    expect(
      adapterFor("https://instagram.com.attacker.com/p/1"),
    ).toBeUndefined();
    expect(adapterFor("not a url")).toBeUndefined();
    expect(
      validMedia({
        platform: "instagram",
        contentId: "x",
        slideId: "1",
        kind: "photo",
      }),
    ).toBe(true);
    expect(validMedia({ platform: "instagram", contentId: "x" })).toBe(false);
    expect(defaults.instagramStoriesEnabled).toBe(false);
    expect(defaults.allowedFormats).toEqual(["jpeg", "png"]);
  });
});
describe("bounded retrieval", () => {
  it("falls back from rejected HEAD to signature bytes and preserves signed URL", async () => {
    const url = "https://cdn.test/photo?sig=keep%2Bme&width=320";
    clearProbe(url);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          status: 206,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await probeImage(url)).format).toBe("png");
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([url, url]);
    expect((await probeImage(url)).format).toBe("png");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports HTTP restrictions without claiming CORS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );
    const result = await probeImage("https://cdn.test/forbidden");
    expect(result.error).toContain("HTTP 403");
    expect(result.error).not.toContain("CORS");
  });
  it("uses a fresh timeout budget for GET after HEAD times out", async () => {
    const firstTimeout = new AbortController(),
      nextTimeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(firstTimeout.signal)
      .mockReturnValue(nextTimeout.signal);
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener(
              "abort",
              () => { reject(new DOMException("Timed out", "AbortError")); },
              { once: true },
            ),
          ),
      )
      .mockImplementationOnce((_url, options) => {
        expect(options.signal.aborted).toBe(false);
        return Promise.resolve(
          new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
        );
      });
    vi.stubGlobal("fetch", fetcher);
    const pending = probeImage("https://timeout.test/image");
    firstTimeout.abort();
    expect((await pending).format).toBe("png");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps unrecognized HTML pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response("<html>Login</html>", {
            headers: { "Content-Type": "text/html" },
          }),
        ),
      ),
    );
    expect((await probeImage("https://cdn.test/login")).format).toBe("unknown");
  });
  it("bounds byte retrieval and keeps 401 actionable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(new Uint8Array(20))),
        ),
    );
    await expect(fetchImageBytes("https://cdn.test/big", 10)).rejects.toThrow(
      /exceeds/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await expect(
      fetchImageBytes("https://cdn.test/private", 100),
    ).rejects.toThrow(/HTTP 401/);
  });
});
