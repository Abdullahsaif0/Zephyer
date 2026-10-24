import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve("test-results/power");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  errors = [];
const profile = await mkdtemp(resolve("test-results/power-profile-"));
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    viewport: { width: 1100, height: 850 },
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
  });
let context, worker, page, control, panel, cdp, tabId;
async function wait(fn, timeout = 25000) {
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
const rpc = (m) => control.evaluate((m) => chrome.runtime.sendMessage(m), m);
const snap = (id = tabId) => rpc({ type: "SNAPSHOT", tabId: id });
const toggle = (enabled, id = tabId) =>
  rpc({ type: "SITE_POWER", tabId: id, enabled });
async function node(selector) {
  const { root } = await cdp.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  function find(n) {
    if (n.nodeName === "ZEPHYER-TOOLS") return n;
    for (const child of n.children || []) {
      const r = find(child);
      if (r) return r;
    }
  }
  const host = find(root);
  if (!host?.shadowRoots?.[0]) return null;
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: host.shadowRoots[0].nodeId,
    selector,
  });
  if (!nodeId) return null;
  const { object } = await cdp.send("DOM.resolveNode", { nodeId });
  return object.objectId;
}
async function read(selector) {
  const id = await node(selector);
  if (!id) return null;
  try {
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: id,
      functionDeclaration: `function(){const r=this.getBoundingClientRect(),s=getComputedStyle(this);return {x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,text:this.textContent,power:this.dataset.power,state:this.dataset.state,orientation:this.dataset.orientation,disabled:this.disabled,focus:this.getRootNode().activeElement===this};}`,
      returnByValue: true,
    });
    return result.value;
  } finally {
    await cdp.send("Runtime.releaseObject", { objectId: id });
  }
}
async function click(action) {
  let previous;
  const r = await wait(async () => {
    const r = await read(`[data-action="${action}"]`);
    const stable =
      r?.w &&
      r?.h &&
      previous &&
      ["x", "y", "w", "h"].every((k) => Math.abs(r[k] - previous[k]) < 0.3);
    previous = r;
    return stable ? r : false;
  }).catch(async (error) => {
    await page.screenshot({ path: resolve(dir, "interaction-failure.png") });
    await writeFile(
      resolve(dir, "interaction-failure.json"),
      JSON.stringify(
        {
          action,
          dock: await read(".z-dock"),
          enable: await read('[data-action="enable"]'),
          power: (await snap()).power,
        },
        null,
        2,
      ),
    );
    throw error;
  });
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(250);
}
async function addImage(p, name) {
  await p.evaluate((name) => {
    const image = new Image();
    image.src = `/${name}.png`;
    image.width = 220;
    image.height = 160;
    document.body.prepend(image);
  }, name);
}
try {
  context = await launch();
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await activateFixtures(context, worker);
  worker.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const id = new URL(worker.url()).hostname;
  page = await context.newPage();
  await page.goto(fixture.origin);
  control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  panel = await context.newPage();
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await page.bringToFront();
  cdp = await context.newCDPSession(page);
  tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  await wait(async () =>
    (await snap()).records.some((r) => r.displayed.endsWith("/static.png")),
  );
  const first = (await snap()).records.find((r) =>
    r.displayed.endsWith("/static.png"),
  );
  await test("activated visit is On with a visible dock and library switch", async () => {
    assert.equal((await snap()).power.effectiveEnabled, true);
    await wait(async () => (await read(".z-dock"))?.power === "on");
    await wait(
      async () =>
        (await panel
          .getByRole("switch", { name: "Enable Zephyer on this website" })
          .getAttribute("aria-checked")) === "true",
    );
    await page.screenshot({ path: resolve(dir, "on-dock.png") });
  });
  await test("dock Off leaves a compact activation pill and preserves collection and selection", async () => {
    await rpc({ type: "SELECT", tabId, ids: [first.id], value: true });
    await rpc({ type: "MODE", tabId, value: true });
    await click("power");
    await wait(async () => (await read(".z-dock"))?.power === "off");
    const s = await snap();
    assert.equal(s.power.reason, "site-off");
    assert.equal(s.selectMode, false);
    assert(s.records.find((r) => r.id === first.id).selected);
    assert((await read(".z-dock")).w <= 210);
    assert.equal((await read(".z-dock-actions")).display, "none");
    assert.match((await read(".z-off-copy")).text, /Zephyer off/);
    assert.equal(await read(".box"), null);
    await page.screenshot({ path: resolve(dir, "off-pill.png") });
    await addImage(page, "off-inserted");
    await page.waitForTimeout(600);
    assert(
      !(await snap()).records.some((r) =>
        r.displayed.endsWith("/off-inserted.png"),
      ),
    );
    await page.evaluate(() => {
      window.offClicks = 0;
      document.querySelector("#static").onclick = () => window.offClicks++;
    });
    await page.locator("#static").click();
    assert.equal(await page.evaluate(() => window.offClicks), 1);
  });
  await test("keyboard activation restores discovery in normal mode without losing selection", async () => {
    const target = await node('[data-action="enable"]');
    await cdp.send("Runtime.callFunctionOn", {
      objectId: target,
      functionDeclaration: "function(){this.focus()}",
    });
    await cdp.send("Runtime.releaseObject", { objectId: target });
    await page.keyboard.press("Enter");
    await wait(async () => (await snap()).power.effectiveEnabled);
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/off-inserted.png"),
      ),
    );
    assert.equal((await snap()).selectMode, false);
    assert((await snap()).records.find((r) => r.id === first.id).selected);
    await wait(async () => (await read('[data-action="power"]'))?.focus);
  });
  await test("library switch controls the same website preference", async () => {
    const button = panel.getByRole("switch", {
      name: "Enable Zephyer on this website",
    });
    await button.click();
    await wait(async () => (await read(".z-dock"))?.power === "off");
    await wait(
      async () =>
        (await button.getAttribute("aria-checked")) === "false" &&
        (await button.getAttribute("aria-disabled")) === "false",
    );
    await panel.screenshot({
      path: resolve(dir, "library-off.png"),
      animations: "disabled",
    });
    await button.click();
    await wait(async () => (await snap()).power.effectiveEnabled);
  });
  await test("Off pill remains draggable and saved expanded/vertical layout restores", async () => {
    await rpc({
      type: "APPEARANCE",
      appearance: { dockOrientation: "vertical" },
    });
    await click("expand");
    await toggle(false);
    await wait(async () => (await read(".z-dock"))?.power === "off");
    const before = await read('[data-action="grip"]');
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 170, before.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const pill = await read(".z-dock");
    assert(pill.w <= 210 && pill.h < 60, JSON.stringify(pill));
    assert(pill.x >= 11 && pill.y >= 11);
    await click("enable");
    await wait(async () => (await read(".z-dock"))?.power === "on");
    assert.equal((await read(".z-dock")).state, "expanded");
    assert.equal((await read(".z-dock")).orientation, "vertical");
    await click("expand");
    await rpc({
      type: "APPEARANCE",
      appearance: { dockOrientation: "horizontal" },
    });
  });
  await test("same-host tabs synchronize while another hostname stays independent", async () => {
    const sibling = await context.newPage();
    await sibling.goto(fixture.origin + "/empty");
    const other = await context.newPage();
    await other.goto(
      fixture.origin.replace("127.0.0.1", "localhost") + "/empty",
    );
    const ids = await worker.evaluate(async () =>
      (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url })),
    );
    const siblingId = ids.find((t) => t.url === fixture.origin + "/empty").id,
      otherId = ids.find(
        (t) => t.url?.includes("localhost") && t.url.endsWith("/empty"),
      ).id;
    await page.bringToFront();
    await toggle(false);
    assert.equal((await snap(siblingId)).power.effectiveEnabled, false);
    assert.equal((await snap(otherId)).power.effectiveEnabled, true);
    await addImage(sibling, "sibling-off");
    await page.waitForTimeout(400);
    assert(
      !(await snap(siblingId)).records.some((r) =>
        r.displayed.endsWith("/sibling-off.png"),
      ),
    );
    await toggle(true, siblingId);
    await wait(async () =>
      (await snap(siblingId)).records.some((r) =>
        r.displayed.endsWith("/sibling-off.png"),
      ),
    );
    assert((await snap()).power.effectiveEnabled);
    await sibling.close();
    await other.close();
    await page.bringToFront();
  });
  await test("cross-origin and newly added frames follow the top-level Off rule", async () => {
    const url =
      fixture.origin.replace("127.0.0.1", "localhost") + "/frame?power=1";
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      document.body.append(frame);
    }, url);
    await wait(async () =>
      (await snap()).records.some(
        (r) =>
          r.pageUrl.includes("localhost") && r.displayed.endsWith("/frame.png"),
      ),
    );
    const rejected = await control.evaluate(
      async (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () =>
            chrome.runtime.sendMessage({ type: "SITE_POWER", enabled: false }),
        }),
      tabId,
    );
    assert(
      rejected.filter((r) => r.frameId !== 0).every((r) => r.result?.error),
    );
    await toggle(true);
    await toggle(false);
    const frame = await wait(async () =>
      page.frames().find((f) => f.url() === url),
    );
    await addImage(frame, "frame-off");
    const late = url.replace("power=1", "power=2");
    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = url;
      document.body.append(frame);
    }, late);
    const lateFrame = await wait(async () =>
      page.frames().find((f) => f.url() === late),
    );
    await lateFrame.waitForLoadState();
    await addImage(lateFrame, "late-frame-off");
    await page.waitForTimeout(650);
    assert(
      !(await snap()).records.some((r) => /frame-off\.png$/.test(r.displayed)),
    );
    await toggle(true);
    await wait(async () => {
      const s = await snap();
      return ["/frame-off.png", "/late-frame-off.png"].every((name) =>
        s.records.some((r) => r.displayed.endsWith(name)),
      );
    });
  });
  await test("automatic probes abort on Off and late results do not publish", async () => {
    await page.evaluate(() => {
      const image = new Image();
      image.src = "/power-probe";
      image.width = 220;
      image.height = 160;
      document.body.prepend(image);
    });
    await wait(
      async () => (fixture.requests.get("HEAD /power-probe") || 0) > 0,
    );
    await toggle(false);
    await page.waitForTimeout(1300);
    const record = (await snap()).records.find((r) =>
      r.displayed.endsWith("/power-probe"),
    );
    assert(record);
    assert(record.variants.every((v) => !v.method.includes("verified MIME")));
    const heads = fixture.requests.get("HEAD /power-probe");
    await page.waitForTimeout(350);
    assert.equal(fixture.requests.get("HEAD /power-probe"), heads);
    await toggle(true);
    await wait(async () =>
      (await snap()).records
        .find((r) => r.id === record.id)
        ?.variants.some((v) => v.method.includes("verified MIME")),
    );
  });
  await test("scan pauses on Off and needs explicit Resume after On", async () => {
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.id = "scan-power-spacer";
      spacer.style.height = "5000px";
      document.body.append(spacer);
    });
    await control.evaluate(() => {
      window.frameProgress = [];
      chrome.runtime.onMessage.addListener((m, sender) => {
        if (m.type === "SCAN_PROGRESS")
          window.frameProgress.push({
            frame: sender.frameId,
            state: m.scan.state,
          });
      });
    });
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () =>
      control.evaluate(() =>
        window.frameProgress.some(
          (p) => p.frame !== 0 && p.state === "complete",
        ),
      ),
    );
    assert.equal((await snap()).scan.state, "running");
    await wait(async () => (await snap()).scan.state === "running");
    await toggle(false);
    await wait(async () => (await snap()).scan.state === "paused");
    const y = await page.evaluate(() => scrollY);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => scrollY), y);
    assert.match(
      (await rpc({ type: "SCAN", tabId, command: "resume" })).error,
      /Enable image detection/,
    );
    await toggle(true);
    assert.equal((await snap()).scan.state, "paused");
    await rpc({ type: "SCAN", tabId, command: "resume" });
    await wait(async () => (await snap()).scan.state === "running");
    await wait(async () => (await snap()).scan.state === "complete", 40000);
    await page.evaluate(() =>
      document.querySelector("#scan-power-spacer").remove(),
    );
  });
  await test("queued downloads continue while the website is Off", async () => {
    await worker.evaluate(() => {
      globalThis.originalDownload = chrome.downloads.download;
      chrome.downloads.download = async (options) => {
        await new Promise((r) => setTimeout(r, 500));
        return globalThis.originalDownload(options);
      };
    });
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
    const { id: jobId } = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [first.id],
      output,
    });
    assert(jobId);
    await toggle(false);
    await wait(
      async () =>
        (await snap()).jobs.find((j) => j.id === jobId)?.items[0].state ===
        "done",
    );
    assert.equal((await snap()).power.effectiveEnabled, false);
    await worker.evaluate(
      () => (chrome.downloads.download = globalThis.originalDownload),
    );
    await toggle(true);
  });
  await test("unsaved rule edits preserve unrelated website toggles", async () => {
    const editor = control.locator("textarea");
    await editor.fill("editor.example");
    await toggle(false);
    await editor.blur();
    await wait(async () => {
      const s = (await snap()).settings.disabledSites;
      return s.includes("editor.example") && s.includes("127.0.0.1");
    });
    await toggle(true);
  });
  await test("rapid explicit commands serialize and concurrent host rules are retained", async () => {
    const replies = await Promise.all([
      toggle(false),
      toggle(true),
      toggle(false),
    ]);
    assert(replies.every((r) => !r.error));
    assert.equal((await snap()).power.effectiveEnabled, false);
    await rpc({
      type: "PREFERENCES",
      patch: {
        disabledSites: [
          ...(await snap()).settings.disabledSites,
          "other.example",
        ],
      },
    });
    await toggle(true);
    assert((await snap()).settings.disabledSites.includes("other.example"));
  });
  await test("global pause cannot be silently overridden by the website switch", async () => {
    await rpc({ type: "PREFERENCES", patch: { enabled: false } });
    await wait(
      async () => (await read(".z-off-copy"))?.text === "Globally paused",
    );
    assert.match((await toggle(true)).error, /Globally paused/);
    await wait(async () =>
      panel
        .getByRole("switch", { name: "Enable Zephyer on this website" })
        .isDisabled(),
    );
    await rpc({ type: "PREFERENCES", patch: { enabled: true } });
    await wait(async () => (await snap()).power.effectiveEnabled);
  });
  await test("a failed preference write keeps committed power and offers Retry", async () => {
    await worker.evaluate(() => {
      globalThis.originalSet = chrome.storage.local.set;
      chrome.storage.local.set = async (value) => {
        if (value.settings) throw Error("Fixture: storage write rejected");
        return globalThis.originalSet(value);
      };
    });
    await click("power");
    await wait(async () =>
      (await read(".error"))?.text.includes("storage write rejected"),
    );
    assert.equal((await snap()).power.effectiveEnabled, true);
    assert.equal((await read('[data-action="power"]')).disabled, false);
    assert.match((await read(".error")).text, /Retry/);
    await worker.evaluate(
      () => (chrome.storage.local.set = globalThis.originalSet),
    );
  });
  await test("an interrupted dock layout read falls back and retries without refresh", async () => {
    await toggle(false);
    await worker.evaluate(() => {
      globalThis.originalGet = chrome.storage.local.get;
      globalThis.layoutReads = 0;
      chrome.storage.local.get = async (keys) => {
        if (keys === "dockLayouts" && ++globalThis.layoutReads === 1)
          throw Error("Fixture: interrupted layout read");
        return globalThis.originalGet(keys);
      };
    });
    await page.reload();
    await wait(async () => (await read('[data-action="enable"]'))?.w > 0);
    await wait(async () => worker.evaluate(() => globalThis.layoutReads >= 2));
    assert.equal((await snap()).power.effectiveEnabled, false);
    await worker.evaluate(
      () => (chrome.storage.local.get = globalThis.originalGet),
    );
    await click("enable");
    await wait(async () => (await snap()).power.effectiveEnabled);
  });
  await test("Off survives refresh and worker termination without becoming stuck", async () => {
    await toggle(false);
    await page.reload();
    await wait(async () => (await read(".z-dock"))?.power === "off");
    const browserCDP = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCDP.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(id),
    );
    await browserCDP.send("Target.closeTarget", { targetId: target.targetId });
    await page.waitForTimeout(250);
    assert.equal((await snap()).power.effectiveEnabled, false);
    worker =
      context.serviceWorkers().find((w) => !w.isClosed?.()) ||
      (await context.waitForEvent("serviceworker"));
    await click("enable");
    await wait(async () =>
      (await snap()).records.some((r) => r.displayed.endsWith("/static.png")),
    );
    await browserCDP.detach();
  });
  await test("narrow dock keeps Power accessible with Expand in overflow", async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await wait(async () => (await read('[data-action="power"]'))?.w >= 32);
    assert.equal((await read('[data-action="expand"]')).display, "none");
    await click("more");
    assert((await read('[data-action="expand-menu"]')).w >= 32);
    await click("expand-menu");
    await click("expand");
    await page.setViewportSize({ width: 1100, height: 850 });
  });
  await test("website preference survives a complete browser restart", async () => {
    await toggle(false);
    await context.close();
    context = await launch();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await activateFixtures(context, worker);
    page = await context.newPage();
    await page.goto(fixture.origin);
    control = await context.newPage();
    await control.goto(`chrome-extension://${id}/options.html`);
    await page.bringToFront();
    cdp = await context.newCDPSession(page);
    tabId = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
      fixture.origin,
    );
    await wait(async () => (await read(".z-dock"))?.power === "off");
    assert.equal((await snap()).power.effectiveEnabled, false);
    await click("enable");
    await wait(async () =>
      (await snap()).records.some((r) => r.displayed.endsWith("/static.png")),
    );
  });
  await test("repeated toggles on 5000 images preserve one dock and bounded page work", async () => {
    await page.goto(fixture.origin + "/perf");
    await wait(async () => (await snap()).records.length >= 5000, 90000);
    await page.waitForTimeout(500);
    await page.evaluate(() => (window.longs = []));
    for (let i = 0; i < 6; i++) {
      await toggle(false);
      await toggle(true);
    }
    await toggle(false);
    await addImage(page, "stress-off");
    await page.waitForTimeout(350);
    assert(
      !(await snap()).records.some((r) =>
        r.displayed.endsWith("/stress-off.png"),
      ),
    );
    await toggle(true);
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/stress-off.png"),
      ),
    );
    const tasks = await page.evaluate(() => window.longs || []);
    await writeFile(
      resolve(dir, "performance.json"),
      JSON.stringify(
        {
          records: (await snap()).records.length,
          toggleCycles: 7,
          longTasks: tasks,
        },
        null,
        2,
      ),
    );
    assert(tasks.filter((n) => n > 100).length <= 1, JSON.stringify(tasks));
    assert((await read(".z-dock")).w <= 360);
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(resolve(dir, "errors.json"), JSON.stringify(errors, null, 2));
  await context?.close();
  fixture.server.close();
}
