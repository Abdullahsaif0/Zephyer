import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve("test-results/dock");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [];
let context;
const profile = await mkdtemp(resolve("test-results/dock-profile-"));
const launch = () =>
  chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1080, height: 820 },
    executablePath: process.env.CHROMIUM_PATH || undefined,
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
  const extensionId = new URL(worker.url()).hostname;
  let page = await context.newPage();
  await page.goto(fixture.origin);
  let control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  let panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.setViewportSize({ width: 430, height: 960 });
  await control.setViewportSize({ width: 840, height: 1100 });
  await page.bringToFront();
  let cdp = await context.newCDPSession(page);
  const rpc = (m) =>
    control.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (r?.error && !r.records) throw Error(r.error);
      return r;
    }, m);
  let tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/")?.id,
    fixture.origin,
  );
  const snap = () => rpc({ type: "SNAPSHOT", tabId });
  async function wait(fn, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        const r = await fn();
        if (r) return r;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out waiting for dock state");
  }
  async function scope() {
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(n) {
      if (n.nodeName === "ZEPHYER-TOOLS") return n;
      for (const c of n.children || []) {
        const f = find(c);
        if (f) return f;
      }
    }
    const host = find(root);
    if (!host?.shadowRoots?.[0]) {
      await page.waitForSelector("zephyer-tools",{state:"attached",timeout:20000});
      return scope();
    }
    return host.shadowRoots[0].nodeId;
  }
  async function read(selector) {
    const root = await scope();
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root,
      selector,
    });
    if (!nodeId) return null;
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    const r = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(){const r=this.getBoundingClientRect(),s=getComputedStyle(this);return {x:r.x,y:r.y,w:r.width,h:r.height,state:this.dataset.state,orientation:this.dataset.orientation,theme:this.getRootNode().host.dataset.theme,display:s.display,blur:s.backdropFilter,transition:s.transitionDuration,focused:this.getRootNode().activeElement===this,value:this.value,disabled:this.disabled,label:this.getAttribute('aria-label'),pressed:this.getAttribute('aria-pressed'),text:this.textContent};}`,
      returnByValue: true,
    });
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    return r.result.value;
  }
  async function click(action) {
    const r = await read(`[data-action="${action}"]`);
    assert(r && r.w && r.h, action + " not visible");
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await page.waitForTimeout(300);
  }
  async function drag(dx, dy) {
    const r = await read("[data-action=grip]");
    await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(300);
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
  async function settings(patch) {
    const s = (await snap()).settings;
    await rpc({ type: "SETTINGS", settings: { ...s, ...patch } });
    await page.waitForTimeout(500);
  }
  await wait(async () => {
    const s = await snap();
    return s.records.length > 10;
  });
  await test("fresh install defaults to a compact horizontal dock under 360px", async () => {
    const r = await read(".z-dock");
    assert.equal(r.state, "compact");
    assert.equal(r.orientation, "horizontal");
    assert(r.w <= 360 && r.h <= 64, JSON.stringify(r));
    assert(r.x >= 12 && r.y >= 12);
    await page.screenshot({ path: resolve(dir, "horizontal-compact.png") });
  });
  await test("mouse dragging moves the dock and only saves on release", async () => {
    const before = await read(".z-dock"),
      grip = await read("[data-action=grip]");
    const old = await control.evaluate(() =>
      chrome.storage.local.get("dockLayouts"),
    );
    await page.mouse.move(grip.x + grip.w / 2, grip.y + grip.h / 2);
    await page.mouse.down();
    await page.mouse.move(
      grip.x + grip.w / 2 - 210,
      grip.y + grip.h / 2 - 250,
      { steps: 10 },
    );
    const during = await control.evaluate(() =>
      chrome.storage.local.get("dockLayouts"),
    );
    assert.deepEqual(during, old);
    await page.mouse.up();
    await wait(async () => !!(await rpc({ type: "DOCK_GET", tabId })).layout);
    const after = await read(".z-dock");
    assert(
      Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 100,
    );
  });
  await test("action clicks do not drag; counts and discovery retain keyboard focus", async () => {
    const before = await read(".z-dock");
    await click("select");
    await wait(async () => (await snap()).selectMode);
    const after = await read(".z-dock");
    assert(
      Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1,
    );
    assert((await read("[data-action=select]")).focused);
    await page.evaluate(() => {
      const i = new Image();
      i.src = "/dock-dynamic.png";
      document.body.append(i);
    });
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/dock-dynamic.png"),
      ),
    );
    assert((await read("[data-action=select]")).focused);
    await click("select");
  });
  await test("expand, minimize and restore preserve active scanning and selections", async () => {
    const first = (await snap()).records.find((r) => r.variants.length);
    await rpc({ type: "SELECT", tabId, ids: [first.id], value: true });
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () => (await snap()).scan.state === "running");
    await click("expand");
    assert.equal((await read(".z-dock")).state, "expanded");
    await click("minimize");
    assert.equal((await read(".z-dock")).state, "minimized");
    const s = await snap();
    assert.equal(s.scan.state, "running");
    assert(s.records.find((r) => r.id === first.id).selected);
    await click("restore");
    assert.equal((await read(".z-dock")).state, "expanded");
    await rpc({ type: "SCAN", tabId, command: "stop" });
    await wait(async () => (await snap()).scan.state === "stopped");
    await click("expand");
  });
  await test("refresh restores per-website position and minimized state", async () => {
    await click("minimize");
    const before = await read(".z-dock");
    await page.reload();
    await wait(async () => !!(await read(".z-dock")));
    await wait(async () => (await read(".z-dock")).state === "minimized");
    await page.waitForTimeout(350);
    const after = await read(".z-dock");
    assert(
      Math.abs(before.x - after.x) < 3 && Math.abs(before.y - after.y) < 3,
      JSON.stringify({ before, after }),
    );
    await click("restore");
  });
  await test("keyboard movement, Escape cancellation and viewport clamping", async () => {
    await click("grip");
    const initial = await read(".z-dock");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);
    assert((await read(".z-dock")).y < initial.y);
    const g = await read("[data-action=grip]"),
      before = await read(".z-dock");
    await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.w / 2 + 100, g.y + g.h / 2 + 80, {
      steps: 5,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    const cancelled = await read(".z-dock");
    assert(
      Math.abs(cancelled.x - before.x) < 1 &&
        Math.abs(cancelled.y - before.y) < 1,
    );
    await drag(-2000, -2000);
    const edge = await read(".z-dock");
    assert.equal(Math.round(edge.x), 12);
    assert.equal(Math.round(edge.y), 12);
    await page.setViewportSize({ width: 390, height: 680 });
    await page.waitForTimeout(350);
    const small = await read(".z-dock");
    assert(small.x >= 11 && small.x + small.w <= 379);
    await page.setViewportSize({ width: 1080, height: 820 });
  });
  await test("vertical layout supports drag and expansion without clipping", async () => {
    await settings({ dockOrientation: "vertical" });
    let r = await read(".z-dock");
    assert.equal(r.orientation, "vertical");
    assert.equal(Math.round(r.w), 64);
    await drag(600, 130);
    r = await read(".z-dock");
    assert(r.x > 500);
    await click("expand");
    r = await read(".z-dock");
    assert.equal(Math.round(r.w), 240);
    assert(r.x + r.w <= 1068 && r.y + r.h <= 808, JSON.stringify(r));
    await page.screenshot({ path: resolve(dir, "vertical-expanded.png") });
    await click("expand");
  });
  await test("overflow reset restores orientation default placement", async () => {
    await click("more");
    await click("reset");
    const r = await read(".z-dock");
    assert(Math.abs(r.x + r.w - 1068) < 3);
    assert(Math.abs(r.y + r.h / 2 - 410) < 3);
    assert.equal((await rpc({ type: "DOCK_GET", tabId })).layout, null);
  });
  await test("theme and orientation selections save immediately without a form save", async () => {
    await control
      .getByRole("button", { name: "Dusk theme", exact: true })
      .click();
    await wait(async () => (await snap()).settings.theme === "dusk");
    await control.reload();
    await control
      .getByRole("button", { name: "Dusk theme", exact: true })
      .waitFor();
    assert.equal(
      await control
        .getByRole("button", { name: "Dusk theme", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await control
      .getByLabel("Dock orientation", { exact: true })
      .selectOption("horizontal");
    await wait(
      async () => (await read(".z-dock")).orientation === "horizontal",
    );
    await page.bringToFront();
  });
  await test("themes apply to dock, gallery and preferences and ignore OS appearance", async () => {
    for (const theme of [
      "graphite",
      "porcelain",
      "midnight",
      "forest",
      "dusk",
      "sand",
    ]) {
      await settings({ theme, dockOrientation: "horizontal" });
      assert.equal((await read(".z-dock")).theme, theme);
      assert.equal(
        await control.locator("html").getAttribute("data-theme"),
        theme,
      );
      assert.equal(
        await panel.locator("html").getAttribute("data-theme"),
        theme,
      );
      await page.emulateMedia({
        colorScheme: theme === "porcelain" ? "dark" : "light",
      });
      assert.equal((await read(".z-dock")).theme, theme);
      await page.screenshot({ path: resolve(dir, `theme-${theme}.png`) });
      await panel.screenshot({ path: resolve(dir, `gallery-${theme}.png`) });
    }
    await settings({ theme: "midnight" });
    await control.reload();
    await control.locator("html[data-theme=midnight]").waitFor();
    await control.screenshot({
      path: resolve(dir, "preferences.png"),
      fullPage: true,
    });
  });
  await test("a different hostname receives an independent default layout", async () => {
    await drag(-200, -150);
    const saved = (await rpc({ type: "DOCK_GET", tabId })).layout;
    assert(saved);
    await page.goto(fixture.origin.replace("127.0.0.1", "localhost"));
    await wait(async () => !!(await read(".z-dock")));
    await wait(async () => (await read(".z-dock")).theme === "midnight");
    assert.equal((await rpc({ type: "DOCK_GET", tabId })).layout, null);
    assert.equal((await read(".z-dock")).state, "compact");
    await page.goto(fixture.origin);
    await wait(async () => {
      const r = await rpc({ type: "DOCK_GET", tabId });
      return r.layout?.x === saved.x;
    });
  });
  await test("reduced motion and unavailable blur have readable fallbacks", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal((await read(".z-dock")).transition, "0s");
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await page.screenshot({ path: resolve(dir, "reduced-motion.png") });
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: await scope(),
      selector: ".z-dock",
    });
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(){this.style.backdropFilter='none';}`,
    });
    assert.equal((await read(".z-dock")).blur, "none");
    await page.screenshot({ path: resolve(dir, "opaque-fallback.png") });
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
  });
  await test("narrow layouts keep 32px targets and remain readable over dark pages", async () => {
    await page.setViewportSize({ width: 320, height: 680 });
    await page.waitForTimeout(400);
    let r = await read(".z-dock");
    assert(r.x >= 11 && r.x + r.w <= 309);
    for (const action of [
      "grip",
      "select",
      "scan",
      "library",
      "power",
      "minimize",
      "more",
    ])
      assert((await read(`[data-action=${action}]`)).w >= 32, action);
    await page.addStyleTag({
      content: "body{background:#0b1015!important;color:#e9f0f5!important}",
    });
    await page.screenshot({ path: resolve(dir, "narrow-dark-page.png") });
    assert.equal((await read("[data-action=expand]")).w, 0);
    await click("more");
    await click("expand-menu");
    await page.screenshot({ path: resolve(dir, "narrow-expanded.png") });
    await click("expand");
    await page.setViewportSize({ width: 1080, height: 820 });
  });
  await test("global pause leaves a restore pill and re-enabling restores the dock", async () => {
    await settings({ enabled: false });
    assert((await read(".z-dock")).w > 0);
    assert.equal((await read(".z-dock-actions")).display, "none");
    await settings({ enabled: true });
    await wait(async () => (await read(".z-dock")).w > 0);
  });
  await test("preferences reset all saved positions", async () => {
    await control
      .getByRole("button", { name: "Reset saved dock positions" })
      .click();
    await page.bringToFront();
    await wait(
      async () =>
        Object.keys(
          (
            await control.evaluate(() =>
              chrome.storage.local.get("dockLayouts"),
            )
          ).dockLayouts || {},
        ).length === 0,
    );
    await wait(async () => {
      const r = await read(".z-dock");
      return r.state === "compact" && Math.abs(r.x + r.w / 2 - 540) < 3;
    });
  });
  await test("focused image quality controls survive discovery updates", async () => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator("#static").hover();
    await wait(async () => (await read(".tools"))?.display !== "none");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: await scope(),
      selector: ".tools select",
    });
    await cdp.send("DOM.focus", { nodeId });
    await page.keyboard.press("ArrowDown");
    const before = await read(".tools select");
    assert(before.focused);
    await page.evaluate(() => {
      const im = new Image();
      im.src = "/quality-discovery.png";
      document.body.append(im);
    });
    await page.waitForTimeout(700);
    const after = await read(".tools select");
    assert(after.focused);
    assert.equal(after.value, before.value);
  });
  await test("zoom keeps the dock inside the visual viewport", async () => {
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await page.waitForTimeout(350);
    const r = await read(".z-dock");
    const v = await page.evaluate(() => ({
      w: visualViewport.width,
      h: visualViewport.height,
    }));
    assert(
      r.x >= 11 && r.y >= 11 && r.x + r.w <= v.w - 11 && r.y + r.h <= v.h - 11,
      JSON.stringify({ r, v }),
    );
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  });
  await test("chosen theme survives a complete browser restart", async () => {
    await context.close();
    context = await launch();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await activateFixtures(context, worker);
    page = await context.newPage();
    await page.goto(fixture.origin);
    cdp = await context.newCDPSession(page);
    await wait(async () => (await read(".z-dock"))?.theme === "midnight");
  });
  await test("legacy stored settings migrate to Graphite and horizontal defaults", async () => {
    control = await context.newPage();
    await control.goto(`chrome-extension://${extensionId}/options.html`);
    await page.bringToFront();
    tabId = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/")?.id,
      fixture.origin,
    );
    const legacy = { ...(await snap()).settings };
    delete legacy.theme;
    delete legacy.dockOrientation;
    await control.evaluate(
      (settings) => chrome.storage.local.set({ settings }),
      legacy,
    );
    const browserCDP = await context.browser().newBrowserCDPSession();
    const targets = await browserCDP.send("Target.getTargets");
    const target = targets.targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    await browserCDP.send("Target.closeTarget", { targetId: target.targetId });
    await page.waitForTimeout(500);
    const s = await snap();
    assert.equal(s.settings.theme, "graphite");
    assert.equal(s.settings.dockOrientation, "horizontal");
    await page.reload();
    await wait(async () => {
      const r = await read(".z-dock");
      return r.theme === "graphite" && r.orientation === "horizontal";
    });
    await browserCDP.detach();
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  fixture.server.close();
}
