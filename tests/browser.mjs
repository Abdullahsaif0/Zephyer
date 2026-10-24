import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
import { unzipSync } from "fflate";
const dir = resolve("test-results");
await mkdir(dir, { recursive: true });
const fixture = await server();
const results = [];
let context;
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/profile-")),
    {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      viewport: { width: 430, height: 960 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  );
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await activateFixtures(context, worker);
  const extensionId = new URL(worker.url()).hostname;
  const errors = [];
  worker.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const page = await context.newPage();
  await page.goto(fixture.origin);
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url?.startsWith(origin))?.id,
    fixture.origin,
  );
  assert(tabId);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  const rpc = (m) =>
    panel.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (r?.error && !Array.isArray(r.records)) throw Error(r.error);
      return r;
    }, m);
  const snapshot = () => rpc({ type: "SNAPSHOT", tabId });
  // Legacy feature suite deliberately enables every format, including SVG conversion fixtures.
  await rpc({
    type: "SETTINGS",
    settings: {
      ...(await snapshot()).settings,
      allowedFormats: [
        "jpeg",
        "png",
        "webp",
        "avif",
        "gif",
        "svg",
        "bmp",
        "ico",
        "tiff",
      ],
      smartCleanup: false,
      showUpcoming: false,
    },
  });
  async function waitFor(fn, timeout = 25000) {
    const end = Date.now() + timeout;
    let value;
    while (Date.now() < end) {
      value = await fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Error(`Timed out after ${timeout}ms`);
  }
  async function test(name, fn) {
    if (
      process.env.TEST_FILTER &&
      !new RegExp(process.env.TEST_FILTER).test(name)
    )
      return;
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: "passed", ms: Date.now() - start });
      console.log("PASS", name);
    } catch (e) {
      results.push({ name, status: "failed", error: String(e) });
      console.error("FAIL", name, e);
      throw e;
    }
  }
  let state, forest, original;
  await test("detects layered sources, open shadow DOM and independent frame records", async () => {
    state = await waitFor(async () => {
      const s = await snapshot();
      return s.records.length >= 15 &&
        s.records.some((r) =>
          r.variants.some((v) => v.url.startsWith("blob:")),
        ) &&
        s.records.some((r) => r.frameId !== 0)
        ? s
        : false;
    });
    for (const src of [
      "static.png",
      "background.png",
      "pseudo.png",
      "shadow.png",
      "frame.png",
      "meta.png",
      "lazy.png",
    ])
      assert(
        state.records.some((r) => r.variants.some((v) => v.url.includes(src))),
        src,
      );
    assert(state.records.some((r) => r.source === "canvas"));
    assert(state.records.some((r) => r.source === "inline SVG"));
    assert(
      state.records.some((r) =>
        r.variants.some((v) => v.url.startsWith("blob:")),
      ),
    );
    forest = state.records.find((r) => r.displayed.endsWith("/static.png"));
    assert(forest);
    original = state.records.find((r) =>
      r.variants.some((v) => v.url.endsWith("/original.png")),
    );
    assert(original);
    assert(state.records.some((r) => r.frameId !== 0));
  });
  await test("selection is synchronized and a recycled DOM node keeps old selection off its replacement", async () => {
    const before = state.records.find((r) =>
      r.displayed.endsWith("/before.png"),
    );
    await rpc({
      type: "SELECT",
      tabId,
      ids: [forest.id, before.id],
      value: true,
    });
    await rpc({ type: "MODE", tabId, value: true });
    await page.evaluate(
      () => (document.querySelector("#recycled").src = "/after.png"),
    );
    const s = await waitFor(async () => {
      const s = await snapshot();
      return s.records.some((r) => r.displayed.endsWith("/after.png"))
        ? s
        : false;
    });
    assert(s.records.find((r) => r.id === before.id).selected);
    assert(!s.records.find((r) => r.displayed.endsWith("/after.png")).selected);
    assert(s.records.find((r) => r.id === forest.id).selected);
    await rpc({ type: "SELECT", tabId, ids: [before.id], value: false });
  });
  await test("dynamic discovery does not automatically select new records", async () => {
    await rpc({ type: "MODE", tabId, value: false });
    await page.locator("#add").click();
    const r = await waitFor(async () =>
      (await snapshot()).records.find((r) =>
        r.displayed.endsWith("/dynamic.png"),
      ),
    );
    assert.equal(r.selected, false);
  });
  await test("full-page scan reaches stable end and restores initial scroll position", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    await rpc({ type: "SCAN", tabId, command: "start" });
    const s = await waitFor(async () => {
      const s = await snapshot();
      return s.scan.state === "complete" ? s : false;
    }, 40000);
    assert(
      s.records.some((r) =>
        r.variants.some((v) => v.url.endsWith("/scroll-added.png")),
      ),
    );
    assert.equal(await page.evaluate(() => scrollY), 0);
  });
  async function download(ids, output = {}) {
    const r = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids,
      output: {
        quality: "best",
        format: "original",
        width: 0,
        height: 0,
        qualityValue: 0.92,
        upscale: false,
        background: "#ffffff",
        firstFrame: false,
        zip: false,
        ...output,
      },
    });
    return waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j?.state === "done" ? j : false;
    }, 60000);
  }
  await test("download uses an immutable selected snapshot and original bytes", async () => {
    const r = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [forest.id],
      output: {
        quality: "best",
        format: "original",
        width: 0,
        height: 0,
        qualityValue: 0.92,
        upscale: false,
        background: "#ffffff",
        firstFrame: false,
        zip: false,
      },
    });
    await rpc({ type: "SELECT", tabId, ids: [original.id], value: true });
    const j = await waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j?.state === "done" ? j : false;
    });
    assert.equal(j.items.length, 1);
    assert.equal(j.items[0].state, "done");
    const ds = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      j.items[0].downloadId,
    );
    assert(j.items[0].file.startsWith("Zephyer/"));
    assert(ds[0].state === "complete");
    assert.equal(
      (await readFile(ds[0].filename)).subarray(1, 4).toString(),
      "PNG",
    );
  });
  await test("local JPEG conversion resizes and flattens transparent pixels", async () => {
    const j = await download([forest.id], { format: "jpeg", width: 160 });
    assert.equal(j.items[0].state, "done", j.items[0].error);
    const ds = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      j.items[0].downloadId,
    );
    const buffer = await readFile(ds[0].filename);
    assert.equal(buffer[0], 255);
    assert.equal(buffer[1], 216);
    const dataUrl = "data:image/jpeg;base64," + buffer.toString("base64");
    const metrics = await page.evaluate(async (data) => {
      const im = new Image();
      im.src = data;
      await im.decode();
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = im.height;
      const x = c.getContext("2d");
      x.drawImage(im, 0, 0);
      return {
        w: im.width,
        h: im.height,
        pixel: [...x.getImageData(0, 0, 1, 1).data],
      };
    }, dataUrl);
    assert.equal(metrics.w, 160);
    assert.equal(metrics.h, 120);
    assert(metrics.pixel[0] > 240 && metrics.pixel[1] > 240);
  });
  await test("PNG and WebP conversion preserve requested bounds and actual encodings", async () => {
    for (const format of ["png", "webp"]) {
      const j = await download([forest.id], {
        format,
        width: 120,
        height: 120,
      });
      assert.equal(j.items[0].state, "done", j.items[0].error);
      const ds = await worker.evaluate(
        (id) => chrome.downloads.search({ id }),
        j.items[0].downloadId,
      );
      const b = await readFile(ds[0].filename);
      if (format === "png") assert.equal(b.subarray(1, 4).toString(), "PNG");
      else {
        assert.equal(b.subarray(0, 4).toString(), "RIFF");
        assert.equal(b.subarray(8, 12).toString(), "WEBP");
      }
    }
  });
  await test("animation/vector conversion requires explicit static-frame consent", async () => {
    const r = (await snapshot()).records.find((r) => r.source === "inline SVG");
    const blocked = await download([r.id], { format: "png" });
    assert.equal(blocked.items[0].state, "failed");
    assert(blocked.items[0].error.includes("requires"));
    const allowed = await download([r.id], {
      format: "png",
      firstFrame: true,
      width: 100,
    });
    assert.equal(allowed.items[0].state, "done", allowed.items[0].error);
  });
  await test("ZIP archive contains exactly the requested images", async () => {
    const j = await download([forest.id, original.id], { zip: true });
    assert(
      j.items.every((i) => i.state === "done"),
      JSON.stringify(j.items),
    );
    const ds = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      j.archiveIds[0],
    );
    const files = unzipSync(new Uint8Array(await readFile(ds[0].filename)));
    assert.equal(Object.keys(files).length, 2);
  });
  await test("blob image is retrieved from its owning page", async () => {
    const r = (await snapshot()).records.find((r) =>
      r.displayed.startsWith("blob:"),
    );
    const j = await download([r.id]);
    assert.equal(j.items[0].state, "done", j.items[0].error);
  });
  await test("gallery renders selected states and output controls", async () => {
    await page.bringToFront();
    await new Promise((r) => setTimeout(r, 400));
    await panel.getByRole("button", { name: /Library/ }).click();
    await panel.locator(".image-card").first().waitFor();
    const first = panel.locator(".image-card").first();
    if (!(await first.getAttribute("class")).includes("chosen"))
      await first.locator(".preview").click();
    await waitFor(
      async () => (await panel.locator(".image-card.chosen").count()) > 0,
    );
    assert((await snapshot()).records.some((r) => r.selected));
    await panel.screenshot({
      path: resolve(dir, "gallery.png"),
      fullPage: true,
    });
    await panel
      .locator("summary")
      .filter({ hasText: "Output settings" })
      .click();
    assert(await panel.getByLabel("File format", { exact: true }).isVisible());
  });
  await test("SPA navigation clears prior collection and rediscovery remains functional", async () => {
    await page.evaluate(() => history.pushState({}, "", "/next"));
    const s = await waitFor(async () => {
      const s = await snapshot();
      return s.records.length &&
        s.records.every((r) => !r.selected) &&
        s.records.some((r) => r.displayed.endsWith("/static.png"))
        ? s
        : false;
    });
    assert(s.records.every((r) => !r.selected));
  });
  await test("restricted browser pages report a clear limitation", async () => {
    const restricted = await context.newPage();
    await restricted.goto("chrome://version");
    await restricted.bringToFront();
    const id = await worker.evaluate(async () => {
      const ts = await chrome.tabs.query({ active: true, currentWindow: true });
      return ts[0]?.id;
    });
    const s = await rpc({ type: "SNAPSHOT", tabId: id });
    assert(s.error?.includes("restricts"));
    await restricted.close();
  });

  await test("failed best-quality URL falls back visibly to the accessible candidate", async () => {
    const r = (await snapshot()).records.find((r) =>
      r.variants.some((v) => v.url.endsWith("/fallback-thumb.png")),
    );
    const j = await download([r.id]);
    assert.equal(j.items[0].state, "done", j.items[0].error);
    assert.equal(j.items[0].fallback, true);
    assert(j.items[0].actualUrl.endsWith("/fallback-thumb.png"));
  });
  await test("best available probes a lazy original instead of saving its placeholder", async () => {
    await page.evaluate(() => {
      const im = document.createElement("img");
      im.src = "/placeholder.png";
      im.dataset.src = "/lazy-full.png";
      document.body.append(im);
    });
    const r = await waitFor(async () =>
      (await snapshot()).records.find((r) =>
        r.variants.some((v) => v.url.endsWith("/lazy-full.png")),
      ),
    );
    const j = await download([r.id]);
    assert.equal(j.items[0].state, "done", j.items[0].error);
    assert(
      j.items[0].actualUrl.endsWith("/lazy-full.png"),
      JSON.stringify(j.items[0]),
    );
  });
  await test("rate limiting retries with backoff and recovers", async () => {
    const unique = `/rate.png?job=${Date.now()}`;
    await page.evaluate((url) => {
      const image = document.createElement("img");
      image.dataset.src = url;
      document.body.append(image);
    }, unique);
    const r = await waitFor(async () =>
      (await snapshot()).records.find((r) =>
        r.variants.some((v) => v.url.endsWith(unique)),
      ),
    );
    const j = await download([r.id], { format: "png" });
    assert.equal(j.items[0].state, "done", j.items[0].error);
    assert(j.items[0].attempts >= 2);
  });
  await test("paused durable jobs survive a worker shutdown and resume without duplicate files", async () => {
    const ids = (await snapshot()).records
      .filter(
        (r) =>
          r.variants.length &&
          r.variants.every((v) => v.url.startsWith("http:")) &&
          !r.variants.some((v) => v.url.includes("/fail.png")),
      )
      .slice(0, 5)
      .map((r) => r.id);
    const r = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids,
      output: {
        quality: "displayed",
        format: "original",
        width: 0,
        height: 0,
        qualityValue: 0.92,
        upscale: false,
        background: "#ffffff",
        firstFrame: false,
        zip: false,
      },
    });
    await rpc({ type: "JOB", id: r.id, command: "pause" });
    const cdp = await context.browser().newBrowserCDPSession();
    const targets = await cdp.send("Target.getTargets");
    const target = targets.targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    if (target)
      await cdp.send("Target.closeTarget", { targetId: target.targetId });
    await new Promise((r) => setTimeout(r, 500));
    const s = await snapshot();
    const j = s.jobs.find((j) => j.id === r.id);
    assert.equal(j.state, "paused");
    assert.equal(j.items.length, ids.length);
    await rpc({ type: "JOB", id: r.id, command: "resume" });
    const done = await waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j.state === "done" ? j : false;
    }, 60000);
    assert(
      done.items.every((i) => i.state === "done"),
      JSON.stringify(done.items),
    );
    assert.equal(new Set(done.items.map((i) => i.downloadId)).size, ids.length);
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await cdp.detach();
  });
  await test("5000-image collection stays virtualized and observer work remains bounded", async () => {
    const perf = await context.newPage();
    await perf.goto(fixture.origin + "/perf");
    const id = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/perf")
          ?.id,
      fixture.origin,
    );
    const perfSnap = () => rpc({ type: "SNAPSHOT", tabId: id });
    await worker.evaluate((id) => globalThis.activateZephyerTab(id), id);
    await waitFor(async () => (await perfSnap()).records.length >= 5000, 90000);
    await perf.bringToFront();
    await waitFor(async () =>
      (await panel.locator(".selection-bar").textContent())?.includes("5000"),
    );
    assert(
      (await panel.locator(".image-card").count()) < 30,
      "gallery must only mount visible cards",
    );
    await perf.waitForTimeout(1000);
    const longs = await perf.evaluate(() => window.longs);
    await writeFile(
      resolve(dir, "performance.json"),
      JSON.stringify(
        {
          images: (await perfSnap()).records.length,
          mountedCards: await panel.locator(".image-card").count(),
          longTasks: longs,
        },
        null,
        2,
      ),
    );
    assert(
      longs.filter((n) => n > 100).length <= 1,
      "Repeated >100ms tasks: " + JSON.stringify(longs),
    );
    await perf.close();
    await page.bringToFront();
  });

  await writeFile(
    resolve(dir, "browser-errors.json"),
    JSON.stringify(errors, null, 2),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  fixture.server.close();
}
