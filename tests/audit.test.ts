import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSrcset } from "../src/adapters";
import { boundedBlob } from "../src/shared";
import { normalizedFormat, eligibility } from "../src/discovery";
import { defaults, type ImageRecord } from "../src/shared";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("audit regressions", () => {
  it("reports an inaccessible canvas as unsupported rather than a disabled format", () => {
    const r = {
      variants: [],
      status: "unsupported: tainted canvas",
    } as unknown as ImageRecord;
    expect(eligibility(r, defaults)).toEqual({
      state: "excluded",
      reasons: ["unsupported: tainted canvas"],
    });
  });
  it("normalizes MIME parameters from page-owned Blob sources", () => {
    expect(normalizedFormat("image/png; charset=utf-8")).toBe("png");
  });
  it("cancels oversized streams without buffering their remaining bytes", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(boundedBlob(new Response(stream), 48)).rejects.toThrow(
      "transfer exceeds",
    );
    expect(cancelled).toBe(true);
  });
  it("preserves streamed bytes and MIME within the transfer bound", async () => {
    const blob = await boundedBlob(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      }),
      3,
    );
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it("collects descriptorless responsive candidates alongside width candidates", () => {
    expect(
      parseSrcset(
        " /first.png, /second.png 1200w, /third.png, ",
        "https://site.test",
      ).map((v) => [v.url, v.width]),
    ).toEqual([
      ["https://site.test/first.png", 0],
      ["https://site.test/second.png", 1200],
      ["https://site.test/third.png", 0],
    ]);
  });
  it("retains data commas and signed queries while rejecting invalid descriptors", () => {
    const rows = parseSrcset(
      "data:image/png;base64,AAAA 1x, /photo.png?sig=a%2Bb 2x, /invalid.png -1w",
      "https://site.test",
    );
    expect(rows.map((v) => v.url)).toEqual([
      "data:image/png;base64,AAAA",
      "https://site.test/photo.png?sig=a%2Bb",
    ]);
  });
  it("rejects an explicitly aborted record transaction rather than waiting forever", async () => {
    const transaction: any = {
      objectStore: () => ({
        get: () => {
          const r: any = {};
          queueMicrotask(() => r.onsuccess());
          return r;
        },
      }),
      abort: () => queueMicrotask(() => transaction.onabort?.()),
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        const r: any = { result: { transaction: () => transaction } };
        queueMicrotask(() => r.onsuccess());
        return r;
      },
    });
    const { put } = await import("../src/db");
    await expect(
      put("records", [{ id: "orphan", collectionId: "missing" }]),
    ).rejects.toThrow("Database transaction aborted");
  });
  it("can reopen IndexedDB after a failed connection attempt", async () => {
    let attempts = 0;
    vi.stubGlobal("indexedDB", {
      open: () => {
        const fail = attempts++ === 0;
        const r: any = {
          error: new Error("temporary open failure"),
          result: {
            transaction: () => ({
              objectStore: () => ({
                getAll: () => {
                  const read: any = { result: [] };
                  queueMicrotask(() => read.onsuccess());
                  return read;
                },
              }),
            }),
          },
        };
        queueMicrotask(() => (fail ? r.onerror() : r.onsuccess()));
        return r;
      },
    });
    const { all } = await import("../src/db");
    await expect(all("jobs")).rejects.toThrow("temporary open failure");
    await expect(all("jobs")).resolves.toEqual([]);
  });
});
