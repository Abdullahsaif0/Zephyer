// Diagnostic control experiment, not a replacement for timing acceptance checks.
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve("test-results/code-audit/attribution");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  measurements = [];
let context;
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/attribution-profile-")),
    {
      channel: "chromium",
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname,
    control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const tracer = await context.browser().newBrowserCDPSession();
  for (const active of [false, true]) {
    const page = await context.newPage();
    await page.goto(fixture.origin + "/empty");
    const tabId = await worker.evaluate(
      async (url) =>
        (await chrome.tabs.query({})).find((t) => t.url === url).id,
      page.url(),
    );
    if (active)
      await worker.evaluate((id) => globalThis.activateZephyerTab(id), tabId);
    await page.bringToFront();
    await tracer.send("Tracing.start", {
      categories: "devtools.timeline,disabled-by-default-devtools.timeline",
      transferMode: "ReturnAsStream",
    });
    await page.goto(fixture.origin + "/perf");
    const count = () =>
      control.evaluate(
        async (tabId) =>
          (await chrome.runtime.sendMessage({ type: "LIBRARY_META", tabId }))
            .recordIds.length,
        tabId,
      );
    if (active) {
      const end = Date.now() + 90000;
      while ((await count()) < 5000 && Date.now() < end)
        await page.waitForTimeout(500);
      assert.equal(await count(), 5000);
    } else {
      await page.waitForTimeout(5000);
      assert.equal(await count(), 0);
    }
    await page.waitForTimeout(1000);
    const tasks = await page.evaluate(() => window.longDetails);
    const completed = new Promise((r) =>
      tracer.once("Tracing.tracingComplete", r),
    );
    await tracer.send("Tracing.end");
    const { stream } = await completed,
      chunks = [];
    while (true) {
      const r = await tracer.send("IO.read", { handle: stream });
      chunks.push(
        r.base64Encoded ? Buffer.from(r.data, "base64") : Buffer.from(r.data),
      );
      if (r.eof) break;
    }
    await tracer.send("IO.close", { handle: stream });
    const bytes = Buffer.concat(chunks);
    const phase = active ? "activated" : "inactive";
    await writeFile(resolve(dir, phase + "-trace.json"), bytes);
    const events = JSON.parse(bytes).traceEvents;
    const callbacks = events.filter(
      (e) =>
        e.ph === "X" &&
        /\/content\.js(?:$|\?)/.test(
          e.args?.data?.scriptName || e.args?.data?.url || "",
        ),
    );
    const result = {
      phase,
      records: await count(),
      pageTasks: tasks,
      extensionCallbacks: callbacks.length,
      maxExtensionCallbackMs:
        Math.max(0, ...callbacks.map((e) => e.dur || 0)) / 1000,
      extensionCallbacksOver100: callbacks
        .filter((e) => e.dur > 100000)
        .map((e) => ({
          name: e.name,
          durationMs: e.dur / 1000,
          data: e.args?.data,
        })),
    };
    measurements.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  await tracer.detach();
} finally {
  await writeFile(
    resolve(dir, "measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  await context?.close();
  await new Promise((r) => fixture.server.close(r));
}
