import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve(
  process.env.GALLERY_ONLY
    ? "test-results/gallery-audit"
    : "test-results/gallery",
);
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  errors = [];
const profile = await mkdtemp(resolve("test-results/gallery-profile-"));
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    executablePath: process.env.CHROMIUM_PATH,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
let context, worker, page, control, gallery, tabId, id, collectionId;
const rpc = (m) => control.evaluate((m) => chrome.runtime.sendMessage(m), m);
const snap = () => rpc({ type: "SNAPSHOT", tabId });
const activate = async (target) =>
  worker.evaluate(async (id) => globalThis.activateZephyerTab(id), target);
async function wait(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out");
}
async function test(name, fn) {
  if (
    process.env.GALLERY_ONLY &&
    !new RegExp(process.env.GALLERY_ONLY).test(name)
  )
    return;
  try {
    await fn();
    results.push({ name, status: "passed" });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, status: "failed", error: String(e) });
    throw e;
  }
}
async function add(name) {
  await page.evaluate((name) => {
    const im = new Image();
    im.src = `/${name}.png`;
    im.alt = name;
    im.width = 220;
    document.body.prepend(im);
  }, name);
}
try {
  context = await launch();
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  worker.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  id = new URL(worker.url()).hostname;
  page = await context.newPage();
  await page.goto(fixture.origin);
  control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  await page.bringToFront();
  tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  await test("fresh page stays completely inactive before toolbar activation", async () => {
    await page.waitForTimeout(1000);
    const s = await snap();
    assert.equal(s.power.activated, false);
    assert.equal(s.power.reason, "inactive");
    assert.equal(s.records.length, 0);
    assert.equal(await page.locator("zephyer-tools").count(), 0);
    const behavior = await worker.evaluate(() =>
      chrome.sidePanel.getPanelBehavior(),
    );
    assert.equal(behavior.openPanelOnActionClick, false);
  });
  await test("toolbar activation reveals the dock and collects accessible frames", async () => {
    await activate(tabId);
    await wait(async () => (await snap()).records.some((r) => r.frameId !== 0));
    assert(
      (await snap()).records.some((r) => r.displayed.endsWith("/static.png")),
    );
    assert.equal(await page.locator("zephyer-tools").count(), 1);
  });
  await test("compact dock keeps new expanded controls hidden and narrow primary actions in bounds", async () => {
    await activate(tabId);
    await wait(async () => (await snap()).records.length > 0);
    await page.setViewportSize({ width: 320, height: 780 });
    await page.waitForTimeout(300);
    const cdp = await context.newCDPSession(page),
      { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (node) =>
      node.nodeName === "ZEPHYER-TOOLS"
        ? node
        : (node.children || []).map(find).find(Boolean);
    const host = find(root);
    assert(host?.shadowRoots?.[0]);
    async function geometry(action) {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: host.shadowRoots[0].nodeId,
        selector: `[data-action="${action}"]`,
      });
      const { object } = await cdp.send("DOM.resolveNode", { nodeId });
      const { result } = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration:
          "function(){const r=this.getBoundingClientRect();return {x:r.x,w:r.width,display:getComputedStyle(this).display};}",
        returnByValue: true,
      });
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
      return result.value;
    }
    for (const action of [
      "gallery-expanded",
      "scan-now-expanded",
      "automatic-expanded",
    ])
      assert.equal((await geometry(action)).display, "none");
    for (const action of ["power", "download", "library", "more"]) {
      const r = await geometry(action);
      assert(
        r.w >= 32 && r.x >= 11 && r.x + r.w <= 309,
        JSON.stringify({ action, ...r }),
      );
    }
    await page.screenshot({
      path: resolve(dir, "compact-320.png"),
      animations: "disabled",
    });
    await cdp.detach();
    await page.setViewportSize({ width: 1280, height: 900 });
  });
  await test("automatic collection Off retains records and ignores new images", async () => {
    await rpc({ type: "PREFERENCES", patch: { automaticCollection: false } });
    await add("manual-only");
    await page.evaluate(() => {
      const image = new Image();
      image.src = "/power-probe?manual=1";
      image.width = 220;
      document.body.prepend(image);
    });
    await page.waitForTimeout(700);
    assert(
      !(await snap()).records.some((r) =>
        r.displayed.endsWith("/manual-only.png"),
      ),
    );
    assert((await snap()).records.length > 0);
  });
  await test("recycled images cannot select stale families while automatic collection is Off", async () => {
    await rpc({ type: "MODE", tabId, value: true });
    await page.waitForTimeout(200);
    await page
      .locator("#static")
      .evaluate((el) => (el.src = "/unscanned-replacement.png"));
    await page.locator("#static").click({ force: true });
    await page.waitForTimeout(200);
    assert((await snap()).records.every((r) => !r.selected));
    await rpc({ type: "MODE", tabId, value: false });
    await page.locator("#static").evaluate((el) => (el.src = "/static.png"));
  });
  await test("explicit Scan now runs without enabling automatic collection", async () => {
    const result = await rpc({ type: "SCAN_NOW", tabId });
    assert(!result?.error, JSON.stringify(result));
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/manual-only.png"),
      ),
    );
    assert.equal((await snap()).settings.automaticCollection, false);
    assert(
      (await snap()).records
        .find((r) => r.displayed.includes("/power-probe?manual=1"))
        ?.variants.some((v) => v.format === "png"),
      "manual scan must settle MIME verification before disabling collection",
    );
    await add("after-one-pass");
    await page.waitForTimeout(600);
    assert(
      !(await snap()).records.some((r) =>
        r.displayed.endsWith("/after-one-pass.png"),
      ),
    );
  });
  await test("full-page manual scanning works while automatic collection is Off", async () => {
    assert(!(await rpc({ type: "SCAN", tabId, command: "start" })).error);
    await wait(async () => (await snap()).scan.state === "complete", 45000);
    assert.equal((await snap()).settings.automaticCollection, false);
    await wait(async () => !(await snap()).power.collecting);
    await add("after-manual-scan");
    await page.waitForTimeout(500);
    assert(
      !(await snap()).records.some((r) =>
        r.displayed.endsWith("/after-manual-scan.png"),
      ),
    );
  });
  await test("Open Gallery creates a source-bound extension tab and reuses it", async () => {
    await rpc({ type: "PREFERENCES", patch: { automaticCollection: true } });
    const opened = await rpc({ type: "OPEN_GALLERY", tabId });
    assert(!opened.error, JSON.stringify(opened));
    gallery = await wait(() =>
      context.pages().find((p) => p.url().includes("gallery.html?collection=")),
    );
    await gallery.waitForSelector(".photo-tile");
    collectionId = new URL(gallery.url()).searchParams.get("collection");
    assert(collectionId && !gallery.url().includes(fixture.origin));
    assert.equal((await rpc({ type: "OPEN_GALLERY", tabId })).id, opened.id);
    assert.equal(
      context.pages().filter((p) => p.url().includes("gallery.html")).length,
      1,
    );
    await gallery.screenshot({
      path: resolve(dir, "photos-grid.png"),
      animations: "disabled",
    });
  });
  await test("normal image click opens a full viewer without downloading", async () => {
    const before = (await snap()).jobs.length;
    await gallery.locator(".photo-open").first().click();
    await gallery.getByRole("dialog", { name: "Full image viewer" }).waitFor();
    await gallery.locator(".viewer-stage img").waitFor({ timeout: 30000 });
    assert.equal((await snap()).jobs.length, before);
    await gallery.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.equal(
      await gallery.locator(".viewer-stage").getAttribute("data-zoomed"),
      "true",
    );
    await gallery.screenshot({
      path: resolve(dir, "full-viewer.png"),
      animations: "disabled",
    });
    await gallery.keyboard.press("Escape");
    await gallery.getByRole("dialog").waitFor({ state: "hidden" });
  });
  await test("selection is distinct from preview and synchronized with source records", async () => {
    await gallery.getByRole("button", { name: "Select", exact: true }).click();
    await gallery.locator(".photo-open").first().click();
    await wait(
      async () => (await snap()).records.filter((r) => r.selected).length === 1,
    );
    assert.equal(await gallery.getByRole("dialog").count(), 0);
    await wait(async () =>
      (await gallery.locator(".photos-footer strong").textContent()).includes(
        "1 selected",
      ),
    );
  });
  await test("all grid tiles including a partial final row remain square", async () => {
    const boxes = await gallery.locator(".photo-tile").evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );
    assert(boxes.length > 0);
    assert(
      boxes.every((b) => Math.abs(b.w - b.h) < 1),
      JSON.stringify(boxes),
    );
  });
  await test("Select all snapshots the shown collection and new images stay unselected", async () => {
    await gallery
      .getByRole("button", { name: "Select all shown", exact: true })
      .click();
    await wait(async () => {
      const rs = (await snap()).records.filter(
        (r) => r.eligibility.state === "accepted",
      );
      return rs.length && rs.every((r) => r.selected);
    });
    await add("live-gallery-addition");
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/live-gallery-addition.png"),
      ),
    );
    assert.equal(
      (await snap()).records.find((r) =>
        r.displayed.endsWith("/live-gallery-addition.png"),
      ).selected,
      false,
    );
    await gallery.getByRole("button", { name: "Clear", exact: true }).click();
    await wait(async () => (await snap()).records.every((r) => !r.selected));
  });
  await test("viewer keyboard navigation, snapshot order and focus restoration work", async () => {
    await gallery.getByRole("button", { name: "Done", exact: true }).click();
    const first = gallery.locator(".photo-open").first();
    await first.click();
    await gallery.getByRole("dialog").waitFor();
    await gallery.keyboard.press("ArrowRight");
    await wait(async () =>
      (await gallery.locator(".viewer-top>span").textContent()).startsWith(
        "2 /",
      ),
    );
    await add("viewer-snapshot-addition");
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/viewer-snapshot-addition.png"),
      ),
    );
    const counter = await gallery.locator(".viewer-top>span").textContent();
    await gallery.waitForTimeout(300);
    assert.equal(
      await gallery.locator(".viewer-top>span").textContent(),
      counter,
    );
    await gallery.keyboard.press("Escape");
    await gallery.getByRole("dialog").waitFor({ state: "hidden" });
    assert(
      await gallery
        .locator(".photo-open")
        .evaluateAll((nodes) => nodes.includes(document.activeElement)),
    );
  });
  await test("search filters selection and clears scrolled virtual bounds", async () => {
    await gallery.getByRole("button", { name: "Filters", exact: true }).click();
    await gallery.getByRole("searchbox").fill("live-gallery-addition");
    await wait(
      async () => (await gallery.locator(".photo-tile").count()) === 1,
    );
    await gallery
      .getByRole("button", { name: "Select all shown", exact: true })
      .click();
    await wait(
      async () => (await snap()).records.filter((r) => r.selected).length === 1,
    );
    assert(
      (await snap()).records
        .find((r) => r.selected)
        .displayed.endsWith("/live-gallery-addition.png"),
    );
    await gallery.getByRole("searchbox").fill("");
    await gallery.getByRole("button", { name: "Filters", exact: true }).click();
  });
  await test("gallery ZIP button uses an immutable selection and guards duplicate submissions", async () => {
    const before = (await snap()).jobs.length;
    await gallery
      .getByRole("button", { name: "Download ZIP", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    const job = await wait(async () => {
      const jobs = (await snap()).jobs;
      return jobs.length > before ? jobs.at(-1) : false;
    });
    assert.equal((await snap()).jobs.length, before + 1);
    assert.equal(job.items.length, 1);
    assert(job.output.zip);
    await wait(
      async () =>
        (await snap()).jobs.find((j) => j.id === job.id)?.state === "done",
      45000,
    );
  });
  await test("content frames cannot invoke gallery metadata or arbitrary preview fetches", async () => {
    const [result] = await worker.evaluate(
      async ({ tabId, collectionId }) =>
        chrome.scripting.executeScript({
          target: { tabId },
          func: (collectionId) =>
            chrome.runtime.sendMessage({
              type: "COLLECTION_META",
              collectionId,
            }),
          args: [collectionId],
        }),
      { tabId, collectionId },
    );
    assert.match(result.result.error, /extension page/);
    const row = (await rpc({ type: "COLLECTION_META", collectionId })).ids[0];
    const rejected = await rpc({
      type: "COLLECTION_PREVIEW",
      collectionId,
      id: row,
      url: fixture.origin + "/unregistered.png",
      requestId: crypto.randomUUID(),
    });
    assert.match(rejected.error, /Invalid preview/);
  });
  await test("source navigation detaches the original collection without replacing its list", async () => {
    const before = await rpc({ type: "COLLECTION_META", collectionId });
    await page.goto(fixture.origin + "/empty");
    await add("new-document-photo");
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/new-document-photo.png"),
      ),
    );
    await wait(
      async () =>
        (await rpc({ type: "COLLECTION_META", collectionId })).collection
          .state === "detached",
    );
    const after = await rpc({ type: "COLLECTION_META", collectionId });
    assert.deepEqual(after.ids, before.ids);
    await gallery.reload();
    await gallery.waitForSelector(".photo-tile");
    assert.match(
      await gallery.locator(".photos-context").textContent(),
      /retained/,
    );
  });
  let secondGallery, secondCollection;
  await test("gallery data does not follow the active tab and rejects cross-collection actions", async () => {
    const result = await rpc({ type: "OPEN_GALLERY", tabId });
    assert(!result.error, JSON.stringify(result));
    secondGallery = await wait(() =>
      context
        .pages()
        .find((p) => p.url().includes("gallery.html") && p !== gallery),
    );
    await secondGallery.waitForSelector(".photo-tile");
    secondCollection = new URL(secondGallery.url()).searchParams.get(
      "collection",
    );
    assert.notEqual(secondCollection, collectionId);
    const old = (await rpc({ type: "COLLECTION_META", collectionId })).ids;
    const rejected = await rpc({
      type: "COLLECTION_SELECT",
      collectionId: secondCollection,
      ids: [old[0]],
      value: true,
    });
    assert.match(rejected.error, /belong/);
    const batch = await rpc({
      type: "COLLECTION_BATCH",
      collectionId: secondCollection,
      ids: [old[0]],
    });
    assert.equal(batch.records.length, 0);
    await page.bringToFront();
    await gallery.bringToFront();
    assert.deepEqual(
      (await rpc({ type: "COLLECTION_META", collectionId })).ids,
      old,
    );
  });
  await test("source closure keeps temporary collections and detached downloads work", async () => {
    await page.close();
    await wait(
      async () =>
        (await rpc({ type: "COLLECTION_META", collectionId: secondCollection }))
          .collection.state === "detached",
    );
    const metadata = await rpc({ type: "COLLECTION_META", collectionId });
    const batch = await rpc({
      type: "COLLECTION_BATCH",
      collectionId,
      ids: metadata.ids,
    });
    const image = batch.records.find((r) =>
      r.displayed.endsWith("/static.png"),
    );
    assert(image);
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
    const requestId = crypto.randomUUID(),
      request = {
        type: "COLLECTION_DOWNLOAD",
        collectionId,
        ids: [image.id],
        output,
        requestId,
      };
    const job = await rpc(request);
    assert(job.id, JSON.stringify(job));
    assert.equal((await rpc(request)).id, job.id);
    const done = await wait(async () => {
      const j = (
        await rpc({ type: "COLLECTION_META", collectionId })
      ).jobs.find((j) => j.id === job.id);
      return j?.state === "done" ? j : false;
    }, 45000);
    assert.equal(done.items[0].state, "done");
    const [file] = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      done.items[0].downloadId,
    );
    assert.equal(
      Buffer.from(await readFile(file.filename))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
    output.zip = true;
    const zip = await rpc({
      ...request,
      requestId: crypto.randomUUID(),
      output,
    });
    assert(zip.id, JSON.stringify(zip));
    const archived = await wait(async () => {
      const j = (
        await rpc({ type: "COLLECTION_META", collectionId })
      ).jobs.find((j) => j.id === zip.id);
      return j?.state === "done" ? j : false;
    }, 45000);
    const [archive] = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      archived.archiveIds[0],
    );
    assert.equal(
      Object.keys(unzipSync(new Uint8Array(await readFile(archive.filename))))
        .length,
      1,
    );
  });
  await test("worker restart preserves gallery collection, selection and detached state", async () => {
    const before = await rpc({ type: "COLLECTION_META", collectionId });
    const cdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(id),
    );
    await cdp.send("Target.closeTarget", { targetId: target.targetId });
    const after = await rpc({ type: "COLLECTION_META", collectionId });
    assert.deepEqual(after.ids, before.ids);
    assert.equal(after.collection.state, "detached");
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await cdp.detach();
    await gallery.reload();
    await gallery.waitForSelector(".photo-tile");
  });
  await test("last gallery close cleans its detached metadata without deleting jobs", async () => {
    await secondGallery.close();
    await wait(async () =>
      Boolean(
        (await rpc({ type: "COLLECTION_META", collectionId: secondCollection }))
          .error,
      ),
    );
    assert(
      (await rpc({ type: "COLLECTION_META", collectionId })).jobs.length >= 2,
    );
  });
  await test("activation is tab-local and survives refresh and navigation", async () => {
    page = await context.newPage();
    await page.goto(fixture.origin);
    tabId = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
      fixture.origin,
    );
    assert.equal((await snap()).power.activated, false);
    await activate(tabId);
    await page.reload();
    await wait(async () =>
      (await snap()).records.some((r) => r.displayed.endsWith("/static.png")),
    );
    assert((await snap()).power.activated);
    await page.goto(fixture.origin + "/empty");
    assert((await snap()).power.activated);
    await add("persisted-activation");
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/persisted-activation.png"),
      ),
    );
  });
  await test("global and website rules are not overridden by activation", async () => {
    await rpc({ type: "SITE_POWER", tabId, enabled: false });
    await activate(tabId);
    assert.equal((await snap()).power.reason, "site-off");
    await rpc({ type: "SITE_POWER", tabId, enabled: true });
    await rpc({ type: "PREFERENCES", patch: { enabled: false } });
    await activate(tabId);
    assert.equal((await snap()).power.reason, "global-off");
    await rpc({ type: "PREFERENCES", patch: { enabled: true } });
  });
  await test("balanced cleanup hides declared favicons and interface emoji while retaining content", async () => {
    await page.evaluate(() => {
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = "/declared-site-icon.png";
      document.head.append(link);
      const icon = new Image();
      icon.src = link.href;
      icon.width = 640;
      document.body.append(icon);
      const button = document.createElement("button");
      const emoji = new Image();
      emoji.src = "/toolbar-emoji.png";
      emoji.alt = "emoji";
      emoji.width = 32;
      button.append(emoji);
      document.body.append(button);
      const content = new Image();
      content.src = "/logo-design-essay.png";
      content.alt = "A study of logo design";
      content.width = 640;
      document.body.append(content);
    });
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/logo-design-essay.png"),
      ),
    );
    await rpc({ type: "SCAN_NOW", tabId });
    const rs = (await snap()).records;
    assert.equal(
      rs.find((r) => r.displayed.endsWith("/declared-site-icon.png"))
        .eligibility.state,
      "excluded",
    );
    assert.equal(
      rs.find((r) => r.displayed.endsWith("/toolbar-emoji.png")).eligibility
        .state,
      "excluded",
    );
    assert.equal(
      rs.find((r) => r.displayed.endsWith("/logo-design-essay.png")).eligibility
        .state,
      "accepted",
    );
  });
  await test("browser restart clears activation and ends temporary gallery sessions", async () => {
    const oldURL = gallery.url();
    await context.close();
    context = await launch();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    control = await context.newPage();
    await control.goto(`chrome-extension://${id}/options.html`);
    page = await context.newPage();
    await page.goto(fixture.origin);
    tabId = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
      fixture.origin,
    );
    assert.equal((await snap()).power.activated, false);
    assert.equal((await snap()).records.length, 0);
    gallery = await context.newPage();
    await gallery.goto(oldURL);
    await gallery
      .getByRole("alert")
      .filter({ hasText: "Session ended" })
      .waitFor();
  });
  await test("Photos gallery renders all six themes at desktop and narrow widths", async () => {
    await page.goto(fixture.origin + "/empty");
    await activate(tabId);
    await page.evaluate(() => {
      document.title = "Light studies · illustration fixtures";
      for (let i = 0; i < 18; i++) {
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 480;
        const x = c.getContext("2d"),
          hue = (i * 29 + 185) % 360,
          sky = x.createLinearGradient(0, 0, 0, 480);
        sky.addColorStop(0, `hsl(${hue},45%,${i % 3 === 0 ? 25 : 58}%)`);
        sky.addColorStop(1, `hsl(${(hue + 45) % 360},55%,85%)`);
        x.fillStyle = sky;
        x.fillRect(0, 0, 640, 480);
        x.fillStyle = `hsla(${(hue + 80) % 360},75%,90%,.8)`;
        x.beginPath();
        x.arc(110 + (i % 5) * 80, 105, 38 + (i % 3) * 12, 0, Math.PI * 2);
        x.fill();
        for (let layer = 0; layer < 4; layer++) {
          x.fillStyle = `hsl(${(hue + layer * 12) % 360},${25 + layer * 6}%,${48 - layer * 9}%)`;
          x.beginPath();
          x.moveTo(0, 480);
          x.lineTo(0, 250 + layer * 40);
          for (let step = 0; step <= 8; step++)
            x.lineTo(
              step * 100,
              220 + layer * 55 + Math.sin(step * 1.8 + i + layer) * 65,
            );
          x.lineTo(640, 480);
          x.closePath();
          x.fill();
        }
        const image = new Image();
        image.src = c.toDataURL("image/png");
        image.alt = `Light study ${String(i + 1).padStart(2, "0")}`;
        image.width = 260;
        document.body.append(image);
      }
    });
    await wait(
      async () =>
        (await snap()).records.filter((r) => r.name.startsWith("Light study"))
          .length === 18,
    );
    const old = gallery;
    await rpc({ type: "OPEN_GALLERY", tabId });
    gallery = await wait(() =>
      context
        .pages()
        .find((p) => p !== old && p.url().includes("gallery.html")),
    );
    await gallery.waitForSelector(".photo-tile img");
    assert.match(await gallery.title(), /Light studies/);
    for (const theme of [
      "graphite",
      "porcelain",
      "midnight",
      "forest",
      "dusk",
      "sand",
    ]) {
      await rpc({ type: "APPEARANCE", appearance: { theme } });
      for (const width of [1280, 320]) {
        await gallery.setViewportSize({ width, height: 900 });
        await gallery.waitForTimeout(200);
        assert(
          await gallery.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await gallery.screenshot({
          path: resolve(dir, `${theme}-${width}.png`),
          animations: "disabled",
        });
      }
    }
    await rpc({ type: "APPEARANCE", appearance: { theme: "graphite" } });
    await gallery.setViewportSize({ width: 1280, height: 900 });
    await gallery.locator(".photo-open").first().click();
    await gallery.locator(".viewer-stage img").waitFor();
    await gallery.screenshot({
      path: resolve(dir, "photos-viewer.png"),
      animations: "disabled",
    });
    await gallery.keyboard.press("Escape");
  });
  await test("reduced motion, 200 percent zoom and keyboard focus remain usable", async () => {
    await gallery.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await gallery
        .locator(".photo-open img")
        .first()
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    await gallery.evaluate(() => (document.body.style.zoom = "2"));
    await gallery.waitForTimeout(150);
    assert(
      await gallery.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await gallery.screenshot({
      path: resolve(dir, "zoom-200.png"),
      animations: "disabled",
    });
    await gallery.evaluate(() => (document.body.style.zoom = "1"));
    await gallery.getByRole("button", { name: "Select", exact: true }).focus();
    assert(
      await gallery
        .getByRole("button", { name: "Select", exact: true })
        .evaluate((el) => document.activeElement === el),
    );
    await gallery.emulateMedia({ reducedMotion: "no-preference" });
  });
  await test("5000-image gallery stays virtualized with bounded previews and stable filtered scrolling", async () => {
    if (gallery && !gallery.isClosed()) await gallery.close();
    await activate(tabId);
    await rpc({
      type: "PREFERENCES",
      patch: { automaticCollection: true, smartCleanup: false },
    });
    const profiler = process.env.PROFILE_GALLERY
      ? await context.newCDPSession(page)
      : undefined;
    const tracer = process.env.TRACE_GALLERY
      ? await context.browser().newBrowserCDPSession()
      : undefined;
    if (tracer)
      await tracer.send("Tracing.start", {
        categories: "devtools.timeline,disabled-by-default-devtools.timeline",
        transferMode: "ReturnAsStream",
      });
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }
    await page.goto(fixture.origin + "/perf");
    await wait(async () => (await snap()).records.length >= 5000, 90000);
    await context.addInitScript(() => {
      window.galleryTasks = [];
      new PerformanceObserver((list) =>
        window.galleryTasks.push(...list.getEntries().map((e) => e.duration)),
      ).observe({ type: "longtask", buffered: true });
    });
    await worker.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      globalThis.previewActive = 0;
      globalThis.previewPeak = 0;
      chrome.runtime.sendMessage = (...args) => {
        const m = args[0];
        if (
          m?.target === "offscreen" &&
          m.operation === "IMAGE" &&
          m.requestId
        ) {
          globalThis.previewActive++;
          globalThis.previewPeak = Math.max(
            globalThis.previewPeak,
            globalThis.previewActive,
          );
          return original(...args).finally(() => globalThis.previewActive--);
        }
        return original(...args);
      };
    });
    const opened = await rpc({ type: "OPEN_GALLERY", tabId });
    gallery = await wait(() =>
      context
        .pages()
        .find(
          (p) =>
            p.url().includes(`collection=${opened.collectionId}`) &&
            !p.isClosed(),
        ),
    );
    await wait(
      async () =>
        (
          await gallery.locator(".photos-context strong").textContent()
        ).includes("5,000"),
      90000,
    );
    const mountedCardsBeforeFilter = await gallery
      .locator(".photo-tile")
      .count();
    assert(mountedCardsBeforeFilter < 150);
    await gallery
      .locator(".photos-scroll")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await gallery.waitForTimeout(300);
    await gallery.getByRole("button", { name: "Filters", exact: true }).click();
    await gallery.getByRole("searchbox").fill("4999");
    await wait(
      async () => (await gallery.locator(".photo-tile").count()) === 1,
    );
    assert(
      await gallery
        .locator(".photos-scroll")
        .evaluate((el) => el.scrollTop < 2),
    );
    const metrics = {
      mountedCardsBeforeFilter,
      records: (await snap()).records.length,
      mountedCards: await gallery.locator(".photo-tile").count(),
      previewPeak: await worker.evaluate(() => globalThis.previewPeak),
      galleryTasks: await gallery.evaluate(() => window.galleryTasks || []),
      pageTasks: await page.evaluate(() => window.longs || []),
      pageTaskDetails: await page.evaluate(() => window.longDetails || []),
    };
    if (profiler) {
      const result = await profiler.send("Profiler.stop");
      await writeFile(
        resolve(dir, "source-cpu-profile.json"),
        JSON.stringify(result.profile),
      );
      await profiler.detach();
    }
    if (tracer) {
      const done = new Promise((resolve) =>
        tracer.once("Tracing.tracingComplete", resolve),
      );
      await tracer.send("Tracing.end");
      const { stream } = await done;
      const chunks = [];
      while (true) {
        const r = await tracer.send("IO.read", { handle: stream });
        chunks.push(
          r.base64Encoded ? Buffer.from(r.data, "base64") : Buffer.from(r.data),
        );
        if (r.eof) break;
      }
      await tracer.send("IO.close", { handle: stream });
      await writeFile(resolve(dir, "source-trace.json"), Buffer.concat(chunks));
      await tracer.detach();
    }
    await writeFile(
      resolve(dir, "performance.json"),
      JSON.stringify(metrics, null, 2),
    );
    assert(metrics.previewPeak <= 2);
    assert(
      metrics.galleryTasks.filter((n) => n > 100).length <= 1,
      JSON.stringify(metrics.galleryTasks),
    );
    assert(
      metrics.pageTasks.filter((n) => n > 100).length <= 1,
      JSON.stringify(metrics.pageTasks),
    );
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  try {
    await writeFile(
      resolve(dir, "failure-state.json"),
      JSON.stringify(await snap(), null, 2),
    );
    await page.screenshot({ path: resolve(dir, "failure-source.png") });
  } catch {}
  if (gallery)
    await gallery
      .screenshot({ path: resolve(dir, "failure.png") })
      .catch(() => {});
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(resolve(dir, "errors.json"), JSON.stringify(errors, null, 2));
  await context?.close();
  fixture.server.close();
}
