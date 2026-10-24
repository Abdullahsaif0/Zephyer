import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { server } from "./server.mjs";
const dir = resolve("test-results/selection-downloads");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  errors = [];
let context;
const profile = await mkdtemp(resolve("test-results/selection-profile-"));
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    viewport: { width: 1080, height: 820 },
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
try {
  context = await launch();
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await activateFixtures(context, worker);
  worker.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(fixture.origin);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 430, height: 960 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  const rpc = (m) =>
    control.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (r?.error && !r.records) throw Error(r.error);
      return r;
    }, m);
  const snap = () => rpc({ type: "SNAPSHOT", tabId });
  const settings = (patch) => rpc({ type: "PREFERENCES", patch });
  async function wait(fn, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = await fn();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out");
  }
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, status: "passed" });
      console.log("PASS", name);
    } catch (e) {
      results.push({ name, status: "failed", error: String(e) });
      throw e;
    }
  }
  const cdp = await context.newCDPSession(page);
  async function node(selector) {
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(n) {
      if (n.nodeName === "ZEPHYER-TOOLS") return n;
      for (const c of n.children || []) {
        const r = find(c);
        if (r) return r;
      }
    }
    const host = find(root);
    if (!host?.shadowRoots?.[0]) throw Error("Missing overlay");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: host.shadowRoots[0].nodeId,
      selector,
    });
    if (!nodeId) return null;
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    return object.objectId;
  }
  async function onNode(selector, fn) {
    const objectId = await node(selector);
    if (!objectId) return null;
    try {
      const { result } = await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: fn,
        returnByValue: true,
      });
      return result.value;
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId });
    }
  }
  const read = (selector) =>
    onNode(
      selector,
      `function(){const r=this.getBoundingClientRect(),s=getComputedStyle(this);return{x:r.x,y:r.y,w:r.width,h:r.height,text:this.textContent,label:this.getAttribute('aria-label'),display:s.display,state:this.dataset.state};}`,
    );
  async function click(selector) {
    const r = await wait(async () => {
      const r = await read(selector);
      return r?.w && r?.h && r.display !== "none" ? r : false;
    });
    assert(r.w && r.h && r.display !== "none", selector);
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await page.waitForTimeout(300);
  }
  const output = {
    quality: "best",
    format: "original",
    width: 0,
    height: 0,
    qualityValue: 0.92,
    upscale: false,
    background: "#ffffff",
    firstFrame: false,
    zip: false,
  };
  async function download(ids, patch = {}) {
    const { id } = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids,
      output: { ...output, ...patch },
    });
    return wait(async () => {
      const j = (await snap()).jobs.find((j) => j.id === id);
      return j.state === "done" ? j : false;
    }, 60000);
  }
  const nativeDownloads = () =>
    worker.evaluate(() => chrome.downloads.search({}));
  await worker.evaluate(() => {
    globalThis.downloadRequests = [];
    const original = chrome.downloads.download;
    chrome.downloads.download = (options) => {
      globalThis.downloadRequests.push(options);
      return original(options);
    };
  });
  let image;
  await wait(async () => {
    const s = await snap();
    image = s.records.find((r) => r.displayed.endsWith("/static.png"));
    return image;
  });
  await test("small displayed images cannot overlap Select with Download", async () => {
    await settings({ alwaysVisible: true });
    await page.evaluate(() => {
      const i = document.querySelector("#static");
      i.style.width = "36px";
      i.style.height = "36px";
      dispatchEvent(new Event("resize"));
    });
    const selector = `.box[data-image-id="${image.id}"] .check`;
    await wait(async () => {
      const r = await read(selector);
      return r?.w;
    });
    assert.equal(
      await read(`.box[data-image-id="${image.id}"] .z-inline-download`),
      null,
    );
    const before = (await snap()).jobs.length;
    await click(selector);
    await wait(
      async () =>
        (await snap()).records.find((r) => r.id === image.id).selected,
    );
    await page.waitForTimeout(400);
    assert.equal((await snap()).jobs.length, before);
    assert.equal((await nativeDownloads()).length, 0);
  });
  await test("selection shields page pointer/click handlers and supports keyboard toggling", async () => {
    await page.evaluate(() => {
      window.siteSelectionEvents = 0;
      const i = document.querySelector("#static");
      for (const event of ["pointerdown", "mousedown", "click"])
        i.addEventListener(event, () => {
          window.siteSelectionEvents++;
          const a = document.createElement("a");
          a.href = "/static.png?site-handler";
          a.download = "site-download.png";
          a.click();
        });
    });
    await rpc({ type: "MODE", tabId, value: true });
    const surface = `.box .z-select-surface[data-image-id="${image.id}"]`;
    await wait(() => read(surface));
    await click(surface);
    await wait(
      async () =>
        !(await snap()).records.find((r) => r.id === image.id).selected,
    );
    await onNode(surface, "function(){this.focus();}");
    await page.keyboard.press("Space");
    await wait(
      async () =>
        (await snap()).records.find((r) => r.id === image.id).selected,
    );
    assert.equal(await page.evaluate(() => window.siteSelectionEvents), 0);
    assert.equal((await nativeDownloads()).length, 0);
    assert.equal((await snap()).jobs.length, 0);
    await page.evaluate(() => {
      const i = document.querySelector("#static");
      i.style.width = "220px";
      i.style.height = "160px";
      dispatchEvent(new Event("resize"));
    });
  });
  await test("selected count remains visible in compact, expanded, minimized and vertical dock", async () => {
    for (const orientation of ["horizontal", "vertical"]) {
      await settings({ dockOrientation: orientation });
      await wait(
        async () => (await read(".z-selected-count"))?.label === "1 selected",
      );
      assert.equal((await read(".z-selected-count")).display, "flex");
      await click("[data-action=expand]");
      await click("[data-action=minimize]");
      assert.equal((await read(".z-selected-count")).label, "1 selected");
      assert.equal((await read(".z-selected-count")).display, "flex");
      await click("[data-action=restore]");
      await click("[data-action=expand]");
    }
    await settings({ dockOrientation: "horizontal" });
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(dir, "selected-counter.png") });
  });
  await test("hover selection and stray click events cannot trigger downloading", async () => {
    await settings({ alwaysVisible: false });
    await rpc({ type: "MODE", tabId, value: false });
    const img = await page.locator("#static").boundingBox();
    await page.mouse.move(img.x + img.width / 2, img.y + img.height / 2);
    await wait(() => read(".tools button:last-child"));
    const count = (await snap()).jobs.length;
    await click(".tools button:last-child");
    await wait(
      async () =>
        !(await snap()).records.find((r) => r.id === image.id).selected,
    );
    await onNode(
      ".tools button:first-child",
      `function(){this.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true,detail:1}));}`,
    );
    await page.waitForTimeout(400);
    assert.equal((await snap()).jobs.length, count);
    await click(".tools button:first-child");
    await wait(async () => (await snap()).jobs.length === count + 1);
    await wait(async () => (await snap()).jobs.at(-1).state === "done", 60000);
  });
  await test("custom folder and prefix are snapshotted with continuous numbers across separate jobs", async () => {
    await settings({
      downloadFolder: "Pictures\\Zephyer test",
      groupDownloads: false,
      sequencePrefix: "photo",
      askWhereToSave: false,
    });
    const other = (await snap()).records.find((r) =>
      r.displayed.endsWith("/linked.png"),
    );
    const start = await control.evaluate(
      async () => (await chrome.storage.local.get("sequenceNext")).sequenceNext,
    );
    const a = await download([image.id]);
    const b = await download([other.id]);
    assert.equal(a.items[0].sequence, start);
    assert.equal(b.items[0].sequence, start + 1);
    assert.equal(a.folder, "Pictures/Zephyer test");
    assert(
      a.items[0].file.endsWith(`photo-${String(start).padStart(6, "0")}.png`),
    );
    assert(
      b.items[0].file.endsWith(
        `photo-${String(start + 1).padStart(6, "0")}.png`,
      ),
    );
    await settings({ downloadFolder: "Other", sequencePrefix: "changed" });
    const old = (await snap()).jobs.find((j) => j.id === a.id);
    assert.equal(old.folder, a.folder);
    assert.equal(old.delivery.prefix, "photo");
    // Playwright redirects physical files to UUID paths; assert the actual API destination argument.
    const requests = await worker.evaluate(() => globalThis.downloadRequests);
    assert(requests.some((options) => options.filename === a.items[0].file));
  });
  await test("ZIP contents use the same reserved image sequence and destination", async () => {
    await settings({
      downloadFolder: "Zip collection",
      sequencePrefix: "zip",
      groupDownloads: false,
    });
    const other = (await snap()).records.find((r) =>
      r.displayed.endsWith("/linked.png"),
    );
    const j = await download([image.id, other.id], { zip: true });
    assert(
      j.items.every((i) => i.state === "done"),
      JSON.stringify(j.items),
    );
    const d = (await nativeDownloads()).find((d) => d.id === j.archiveIds[0]);
    const files = Object.keys(
      unzipSync(new Uint8Array(await readFile(d.filename))),
    );
    assert.deepEqual(
      files.sort(),
      j.items
        .map((i) => `zip-${String(i.sequence).padStart(6, "0")}.png`)
        .sort(),
    );
    assert(
      (await worker.evaluate(() => globalThis.downloadRequests)).some(
        (o) => o.filename === "Zip collection/images-part-001.zip",
      ),
    );
  });
  await test("Save as requests the Chrome picker and cancellation never retries or reopens it", async () => {
    await settings({
      askWhereToSave: true,
      downloadFolder: "Chosen",
      sequencePrefix: "picker",
    });
    await worker.evaluate(() => {
      globalThis.originalDownload = chrome.downloads.download;
      globalThis.originalSend = chrome.runtime.sendMessage;
      globalThis.revocations = [];
      chrome.runtime.sendMessage = (...args) => {
        if (args[0]?.operation === "REVOKE")
          globalThis.revocations.push(args[0].url);
        return globalThis.originalSend(...args);
      };
      globalThis.pickerCalls = [];
      chrome.downloads.download = async (options) => {
        globalThis.pickerCalls.push(options);
        throw Error("Download canceled");
      };
    });
    const other = (await snap()).records.find((r) =>
      r.displayed.endsWith("/linked.png"),
    );
    const { id } = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [image.id, other.id],
      output,
    });
    const j = await wait(async () => {
      const j = (await snap()).jobs.find((j) => j.id === id);
      return j.state === "paused" ? j : false;
    });
    assert.equal(j.items.filter((i) => i.state === "cancelled").length, 1);
    assert.equal(j.items.filter((i) => i.state === "queued").length, 1);
    await page.waitForTimeout(2500);
    const calls = await worker.evaluate(() => globalThis.pickerCalls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].saveAs, true);
    assert(calls[0].filename.startsWith("Chosen/picker-"));
    await rpc({ type: "JOB", id, command: "cancel" });
    const converted = await download([image.id], { format: "png", width: 160 });
    assert.equal(converted.items[0].state, "cancelled");
    const archive = await download([image.id], { zip: true });
    assert.equal(archive.items[0].state, "cancelled");
    assert(
      (await worker.evaluate(() => globalThis.revocations.length)) >= 2,
      "Cancelled conversion/archive URLs must be released",
    );
    await worker.evaluate(() => {
      chrome.downloads.download = globalThis.originalDownload;
      chrome.runtime.sendMessage = globalThis.originalSend;
    });
    await settings({ askWhereToSave: false });
  });
  await test("counter and reserved filenames survive worker termination; retries keep their number", async () => {
    const next = await control.evaluate(
      async () => (await chrome.storage.local.get("sequenceNext")).sequenceNext,
    );
    const browser = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browser.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    await browser.send("Target.closeTarget", { targetId: target.targetId });
    await page.waitForTimeout(500);
    await snap();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    const j = await download([image.id]);
    assert.equal(j.items[0].sequence, next);
    await page.evaluate(() => {
      const i = new Image();
      i.src = "/fail.png";
      i.dataset.src = "/fail.png";
      i.alt = "Always fails";
      document.body.append(i);
    });
    const failed = await wait(async () =>
      (await snap()).records.find((r) => r.name === "Always fails"),
    );
    const bad = await download([failed.id]);
    const number = bad.items[0].sequence;
    assert.equal(bad.items[0].state, "failed");
    await rpc({ type: "JOB", id: bad.id, command: "retry" });
    const retried = await wait(async () => {
      const j = (await snap()).jobs.find((j) => j.id === bad.id);
      return j.state === "done" ? j : false;
    }, 60000);
    assert.equal(retried.items[0].sequence, number);
    await browser.detach();
  });
  await test("settings validate folders and persist chosen delivery options", async () => {
    await assert.rejects(
      settings({ downloadFolder: "C:\\Private" }),
      /subfolder/,
    );
    await control.reload();
    await control
      .getByRole("textbox", { name: "Download subfolder", exact: true })
      .fill("My collection");
    await control
      .getByRole("textbox", { name: "Filename prefix", exact: true })
      .click();
    await wait(
      async () => (await snap()).settings.downloadFolder === "My collection",
    );
    await control
      .getByRole("textbox", { name: "Filename prefix", exact: true })
      .fill("shot");
    await control
      .getByRole("heading", { name: "Downloads", exact: true })
      .click();
    await wait(async () => (await snap()).settings.sequencePrefix === "shot");
    await control.screenshot({
      path: resolve(dir, "download-preferences.png"),
      fullPage: true,
    });
    const button = control.getByRole("button", {
      name: "Choose Chrome Downloads location",
      exact: true,
    });
    assert(await button.isVisible());
    const opening = context.waitForEvent("page");
    await button.click();
    const chromeSettings = await opening;
    await chromeSettings.waitForURL("chrome://settings/downloads");
    await chromeSettings.close();
  });
  await test("sequence and chosen folder persist across a complete browser restart", async () => {
    const next = await control.evaluate(
      async () => (await chrome.storage.local.get("sequenceNext")).sequenceNext,
    );
    await context.close();
    context = await launch();
    const nextWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await activateFixtures(context, nextWorker);
    const saved = await nextWorker.evaluate(() =>
      chrome.storage.local.get(["settings", "sequenceNext"]),
    );
    assert.equal(saved.sequenceNext, next);
    assert.equal(saved.settings.downloadFolder, "My collection");
    assert.equal(saved.settings.sequencePrefix, "shot");
    const fresh = await context.newPage();
    await fresh.goto(fixture.origin);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const newTabId = await nextWorker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
      fixture.origin,
    );
    const request = (m) =>
      options.evaluate(async (m) => {
        const r = await chrome.runtime.sendMessage(m);
        if (r?.error) throw Error(r.error);
        return r;
      }, m);
    const source = await wait(async () =>
      (await request({ type: "SNAPSHOT", tabId: newTabId })).records.find((r) =>
        r.displayed.endsWith("/static.png"),
      ),
    );
    const { id } = await request({
      type: "DOWNLOAD",
      tabId: newTabId,
      ids: [source.id],
      output,
    });
    const job = await wait(async () => {
      const j = (
        await request({ type: "SNAPSHOT", tabId: newTabId })
      ).jobs.find((j) => j.id === id);
      return j.state === "done" ? j : false;
    }, 60000);
    assert.equal(job.items[0].sequence, next);
    assert.equal(job.folder, "My collection");
    assert.equal(job.items[0].state, "done");
    assert(
      job.items[0].file.endsWith(`shot-${String(next).padStart(6, "0")}.png`),
    );
  });
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(resolve(dir, "errors.json"), JSON.stringify(errors, null, 2));
  await context?.close();
  await new Promise((r) => fixture.server.close(r));
}
