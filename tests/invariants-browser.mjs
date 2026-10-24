import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";

/**
 * Invariant suites: properties that must hold under ANY queue interleaving
 * or worker lifetime, not just in the happy path. See docs/adr/0002 and the
 * Phase 1 plan — failures here are architectural, not cosmetic.
 */
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
  await page.goto(fixture.origin + "/empty");
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url?.startsWith(origin))?.id,
    fixture.origin,
  );
  assert(tabId);
  const panel = await context.newPage();
  // The troubleshoot page is the rpc channel precisely because it renders no
  // image previews: every GET this fixture sees belongs to the pipeline under
  // test, never to UI thumbnail loads.
  await panel.goto(`chrome-extension://${extensionId}/troubleshoot.html`);
  await page.bringToFront();
  const rpc = (m) =>
    panel.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (r?.error && !Array.isArray(r.records)) throw Error(r.error);
      return r;
    }, m);
  const snapshot = (id = tabId) => rpc({ type: "SNAPSHOT", tabId: id });
  await rpc({
    type: "SETTINGS",
    settings: {
      ...(await snapshot()).settings,
      concurrency: 4,
      showUpcoming: false,
    },
  });
  async function waitFor(fn, timeout = 30000) {
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
  const inject = (i, j) =>
    page.evaluate(
      ([i, j]) => {
        let well = document.getElementById("inv-well");
        if (!well) {
          const spacer = document.createElement("div");
          spacer.style.height = "4000px";
          document.body.append(spacer);
          well = document.createElement("div");
          well.id = "inv-well";
          document.body.append(well);
        }
        for (const n of [i, j]) {
          if (n === undefined) continue;
          const im = document.createElement("img");
          im.src = `/serial.png?i=${n}`;
          im.width = 220;
          im.height = 160;
          im.alt = `serial ${n}`;
          // Lazy below the viewport: the page never fetches these URLs, so
          // every request the fixture sees belongs to the pipeline under test.
          im.loading = "lazy";
          well.append(im);
        }
      },
      [i, j],
    );
  const output = {
    quality: "displayed",
    format: "original",
    width: 0,
    height: 0,
    qualityValue: 0.92,
    upscale: false,
    background: "#ffffff",
    firstFrame: false,
    zip: false,
  };

  await test("the download queue never issues two concurrent requests to one host", async () => {
    const want = 4;
    for (let i = 0; i < want; i++) await inject(i);
    const ids = await waitFor(async () => {
      const rs = (await snapshot()).records.filter((r) =>
        r.variants.some((v) => v.url.includes("/serial.png")),
      );
      return rs.length >= want ? rs.map((r) => r.id) : false;
    });
    // The panel renders its own preview <img> fetches for these URLs, which
    // would pollute the concurrency measurement; move the rpc channel to the
    // image-free troubleshoot page first.
    await panel.goto(`chrome-extension://${extensionId}/troubleshoot.html`);
    const r = await rpc({ type: "DOWNLOAD", tabId, ids, output });
    await waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j?.state === "done" ? j : false;
    }, 90000);
    // Each item is ~350 ms on the wire; with default concurrency 4 a broken
    // per-host gate would overlap the GETs and push get-max above 1. HEAD
    // probes are exempt: verification is deliberately a global 2-slot pool.
    await new Promise((r) => setTimeout(r, 500));
    assert(
      fixture.serial.total >= want,
      `fixture saw ${fixture.serial.total} requests`,
    );
    assert.equal(
      fixture.serial.max,
      1,
      `host saw ${fixture.serial.max} concurrent download GETs\n` +
        fixture.serial.log
          .map((e) => `${e.kind} i=${e.i} ${e.start % 100000}..${e.end ?? "?"}`)
          .join("\n"),
    );
    assert.ok(fixture.serial.headMax >= 1, "probe HEADs expected");
  });

  await test("sequence numbers stay unique and gapless across a worker restart", async () => {
    const settings = (await snapshot()).settings;
    await rpc({
      type: "SETTINGS",
      settings: { ...settings, sequencePrefix: "inv-" },
    });
    const before = (await snapshot()).jobs
      .flatMap((j) => j.items)
      .map((i) => i.file)
      .filter(Boolean);
    const want = 4;
    for (let i = 10; i < 10 + want; i++) await inject(i);
    const ids = await waitFor(async () => {
      const rs = (await snapshot()).records.filter((r) =>
        r.variants.some((v) => v.url.includes("serial.png?i=1")),
      );
      return rs.length >= want ? rs.slice(0, want).map((r) => r.id) : false;
    });
    const r = await rpc({ type: "DOWNLOAD", tabId, ids, output });
    await waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j && j.items.every((i) => i.state !== "queued") ? j : false;
    }, 30000);
    await rpc({ type: "JOB", id: r.id, command: "pause" });
    // Kill the worker mid-job, exactly like the durability suite does.
    const cdp = await context.browser().newBrowserCDPSession();
    const targets = await cdp.send("Target.getTargets");
    const target = targets.targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    if (target)
      await cdp.send("Target.closeTarget", { targetId: target.targetId });
    await new Promise((r) => setTimeout(r, 500));
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const j = (await snapshot()).jobs.find((j) => j.id === r.id);
    assert.equal(j.state, "paused");
    await rpc({ type: "JOB", id: r.id, command: "resume" });
    const done = await waitFor(async () => {
      const j = (await snapshot()).jobs.find((j) => j.id === r.id);
      return j.state === "done" ? j : false;
    }, 90000);
    assert(done.items.every((i) => i.state === "done"), JSON.stringify(done.items));
    const numbers = done.items
      .map((i) => /-(\d+)\.[a-z0-9]+$/.exec(i.file || "")?.[1])
      .filter(Boolean)
      .map(Number);
    assert.equal(numbers.length, want, JSON.stringify(done.items.map((i) => i.file)));
    // No reuse across jobs, no gaps: every reservation survives restarts.
    const duplicates = before
      .map((f) => /-(\d+)\.[a-z0-9]+$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number);
    assert.equal(
      new Set([...duplicates, ...numbers]).size,
      duplicates.length + numbers.length,
      "a sequence number was reused",
    );
    const sorted = [...numbers].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      assert.equal(sorted[i] - sorted[i - 1], 1, `gap in ${JSON.stringify(sorted)}`);
    await cdp.detach();
  });

  await writeFile(
    resolve(dir, "invariants-errors.json"),
    JSON.stringify(errors, null, 2),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "invariants-results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  fixture.server.close();
}
