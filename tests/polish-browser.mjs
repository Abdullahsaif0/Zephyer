import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve(
  process.env.POLISH_FILTER
    ? "test-results/performance-audit"
    : "test-results/polish",
);
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  errors = [];
let context;
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/polish-profile-")),
    {
      channel: "chromium",
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      viewport: { width: 1280, height: 850 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await activateFixtures(context, worker);
  worker.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(fixture.origin + "/noisy");
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  const panel = await context.newPage();
  await panel.addInitScript(() => {
    window.galleryLongs = [];
    new PerformanceObserver((list) =>
      window.galleryLongs.push(...list.getEntries().map((e) => e.duration)),
    ).observe({ type: "longtask", buffered: true });
  });
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.bringToFront();
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/noisy").id,
    fixture.origin,
  );
  const rpc = (m) =>
    control.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (r?.error && !r.records) throw Error(r.error);
      return r;
    }, m);
  const snap = () => rpc({ type: "SNAPSHOT", tabId });
  const settings = async (patch) =>
    rpc({
      type: "SETTINGS",
      settings: { ...(await snap()).settings, ...patch },
    });
  async function wait(fn, timeout = 20000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const r = await fn();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("Timed out");
  }
  async function test(name, fn) {
    if (
      process.env.POLISH_FILTER &&
      !new RegExp(process.env.POLISH_FILTER).test(name)
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
  const cdp = await context.newCDPSession(page);
  async function shadowRead(selector) {
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
    if (!host?.shadowRoots?.[0]) return null;
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: host.shadowRoots[0].nodeId,
      selector,
    });
    if (!nodeId) return null;
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(){const r=this.getBoundingClientRect(),s=getComputedStyle(this);return {x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,animation:s.animationName,play:s.animationPlayState,text:this.textContent,phase:this.dataset.phase};}`,
      returnByValue: true,
    });
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    return result.value;
  }
  async function click(action) {
    // Raw CDP coordinates need the same stability wait as Playwright locators.
    let previous;
    const r = await wait(async () => {
      const current = await shadowRead(`[data-action="${action}"]`);
      const stable =
        current?.display !== "none" &&
        current?.w &&
        previous &&
        ["x", "y", "w", "h"].every(
          (k) => Math.abs(previous[k] - current[k]) < 0.25,
        );
      previous = current;
      return stable ? current : false;
    });
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  }
  await test("JPEG/PNG defaults exclude tracking pixels, small assets, branding and SVG", async () => {
    const s = await wait(async () => {
      const s = await snap();
      return s.records.length >= 9 &&
        s.records.find((r) => r.displayed.endsWith("/noise-small.png"))?.width
        ? s
        : false;
    });
    assert.deepEqual(s.settings.allowedFormats, ["jpeg", "png"]);
    for (const file of [
      "noise-small.png",
      "noise-logo.png",
      "noise-tracker.png",
      "asset.svg",
    ])
      assert.equal(
        s.records.find((r) => r.displayed.endsWith("/" + file))?.eligibility
          .state,
        "excluded",
        file,
      );
    assert.equal(
      s.records.find((r) => r.displayed.endsWith("/noise-photo.png"))
        .eligibility.state,
      "accepted",
    );
  });
  await test("extensionless MIME and capped-byte verification preserve signed URLs", async () => {
    const s = await wait(async () => {
      const s = await snap();
      return ["/opaque?", "/opaque-bytes"].every((u) =>
        s.records.some(
          (r) => r.displayed.includes(u) && r.eligibility.state === "accepted",
        ),
      )
        ? s
        : false;
    });
    assert(
      s.records
        .find((r) => r.displayed.includes("/opaque?"))
        .displayed.includes("sig=keep%2Bme&width=640"),
    );
    assert.equal(fixture.requests.get("HEAD /opaque"), 1);
    assert.equal(fixture.requests.get("HEAD /opaque-bytes"), 1);
    assert.equal(fixture.requests.get("RANGE /opaque-bytes"), 1);
    assert((fixture.requests.get("GET /opaque-bytes") || 0) <= 3); // page, bounded verifier, and an optional gallery request
  });
  await test("excluded review loads no thumbnails until an explicit preview", async () => {
    await panel
      .locator(".collection-tabs button")
      .filter({ hasText: "Excluded" })
      .click();
    await wait(async () => (await panel.locator(".image-card").count()) > 0);
    assert.equal(await panel.locator(".gallery img").count(), 0);
    const before = fixture.requests.get("GET /noise-small.png");
    await panel.waitForTimeout(500);
    assert.equal(fixture.requests.get("GET /noise-small.png"), before);
    const card = panel
      .locator(".image-card")
      .filter({ hasText: "Small decoration" });
    await card.locator(".preview").click();
    assert.equal(await card.locator("img").count(), 1);
    await panel.screenshot({ path: resolve(dir, "excluded-review.png") });
  });
  await test("include overrides cleanup without enabling a disabled format", async () => {
    const s = await snap(),
      small = s.records.find((r) => r.displayed.endsWith("/noise-small.png")),
      svg = s.records.find((r) => r.displayed.endsWith("/asset.svg"));
    await rpc({ type: "INCLUDE", tabId, id: small.id });
    assert.equal(
      (await snap()).records.find((r) => r.id === small.id).eligibility.state,
      "accepted",
    );
    await assert.rejects(
      rpc({ type: "INCLUDE", tabId, id: svg.id }),
      /Enable this format/,
    );
    await settings({ allowedFormats: ["jpeg", "png", "svg"] });
    assert.equal(
      (await snap()).records.find((r) => r.id === svg.id).eligibility.state,
      "accepted",
    );
    await settings({ allowedFormats: ["jpeg", "png"] });
  });
  await test("format exclusions cannot be selected or downloaded", async () => {
    const svg = (await snap()).records.find((r) =>
      r.displayed.endsWith("/asset.svg"),
    );
    await rpc({ type: "SELECT", tabId, ids: [svg.id], value: true });
    assert.equal(
      (await snap()).records.find((r) => r.id === svg.id).selected,
      false,
    );
    await assert.rejects(
      rpc({
        type: "DOWNLOAD",
        tabId,
        ids: [svg.id],
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
      }),
      /No selected/,
    );
  });
  await test("mixed-format families preview only allowed sources and reject disabled displayed quality", async () => {
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/mixed-original.png";
      const i = new Image();
      i.alt = "Mixed format family";
      i.src = "/mixed.webp";
      i.width = 220;
      a.append(i);
      document.body.prepend(a);
    });
    const r = await wait(async () => {
      const s = await snap();
      return s.records.find(
        (r) =>
          r.name === "Mixed format family" &&
          r.eligibility.state === "accepted",
      );
    });
    await panel
      .locator(".collection-tabs button")
      .filter({ hasText: "Useful" })
      .click();
    await panel
      .getByRole("textbox", { name: "Search images", exact: true })
      .fill("Mixed format family");
    const image = panel.locator(".image-card img");
    await image.waitFor();
    assert((await image.getAttribute("src")).endsWith("/mixed-original.png"));
    await assert.rejects(
      rpc({
        type: "DOWNLOAD",
        tabId,
        ids: [r.id],
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
      }),
      /Selected quality format is disabled/,
    );
    await panel
      .getByRole("textbox", { name: "Search images", exact: true })
      .fill("");
  });
  await test("roadmap appears once, can be skipped and supports permanent hiding", async () => {
    await panel
      .locator(".collection-tabs button")
      .filter({ hasText: "Useful" })
      .click();
    await panel.locator(".roadmap").waitFor();
    await panel.getByRole("button", { name: "Skip", exact: true }).click();
    await panel.reload();
    await page.bringToFront();
    await panel.waitForTimeout(700);
    assert.equal(await panel.locator(".roadmap").count(), 0);
    await control.evaluate(() => chrome.storage.local.remove("roadmapSeen"));
    await panel.reload();
    await page.bringToFront();
    await panel.locator(".roadmap").waitFor();
    await panel
      .getByRole("button", { name: "Don’t show again", exact: true })
      .click();
    await wait(async () => !(await snap()).settings.showUpcoming);
    await panel.reload();
    await page.bringToFront();
    await panel.waitForTimeout(500);
    assert.equal(await panel.locator(".roadmap").count(), 0);
    await settings({ showUpcoming: true });
    await control.evaluate(() => chrome.storage.local.remove("roadmapSeen"));
    await panel.reload();
    await page.bringToFront();
    await panel.locator(".roadmap").waitFor();
    await panel.screenshot({ path: resolve(dir, "library-roadmap.png") });
    await panel.getByRole("button", { name: "Skip", exact: true }).click();
  });
  await test("scan HUD supports actual pause/resume, minimization and reduced motion", async () => {
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () => {
      const r = await shadowRead(".z-scan-hud");
      return r?.display !== "none" && r?.w ? r : false;
    });
    await page.screenshot({ path: resolve(dir, "scan-hud.png") });
    await click("hud-pause");
    await wait(async () => (await snap()).scan.state === "paused");
    await wait(
      async () => (await shadowRead(".z-scan-track i")).play === "paused",
    );
    await click("minimize");
    await wait(
      async () => (await shadowRead(".z-scan-hud")).display === "none",
    );
    assert.equal((await snap()).scan.state, "paused");
    await click("restore");
    await wait(
      async () => (await shadowRead(".z-scan-hud")).display !== "none",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal((await shadowRead(".z-scan-track i")).animation, "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await click("hud-pause");
    await wait(async () => (await snap()).scan.state === "running");
    await click("hud-stop");
    await wait(async () => (await snap()).scan.state === "stopped");
  });
  await test("mislabeled original is rejected with an explicit disabled-format error", async () => {
    const r = (await snap()).records.find((r) =>
      r.displayed.endsWith("/misleading.jpg"),
    );
    const job = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [r.id],
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
    const done = await wait(async () => {
      const j = (await snap()).jobs.find((j) => j.id === job.id);
      return j?.items[0].state === "failed" ? j : false;
    }, 30000);
    assert.match(done.items[0].error, /eligible format/);
    assert.equal(done.items[0].downloadId, undefined);
  });
  await test("preferences autosave validation and independent cleanup controls", async () => {
    await Promise.all([
      rpc({ type: "PREFERENCES", patch: { hideAvatars: false } }),
      rpc({ type: "APPEARANCE", appearance: { theme: "porcelain" } }),
      rpc({ type: "PREFERENCES", patch: { minImageSize: 96 } }),
    ]);
    assert.equal((await snap()).settings.theme, "porcelain");
    await assert.rejects(
      rpc({ type: "PREFERENCES", patch: { unexpected: true } }),
      /Invalid preference patch/,
    );
    await rpc({ type: "APPEARANCE", appearance: { theme: "graphite" } });
    await control.reload();
    await control.getByLabel("Hide likely avatars", { exact: true }).check();
    await wait(async () => (await snap()).settings.hideAvatars);
    await control
      .getByLabel("Small-image threshold", { exact: true })
      .fill("128");
    await wait(async () => (await snap()).settings.minImageSize === 128);
    await control
      .getByLabel("Small-image threshold", { exact: true })
      .fill("9999");
    await control
      .locator("#error-minImageSize")
      .filter({ hasText: "0 to 4096" })
      .waitFor();
    assert.equal((await snap()).settings.minImageSize, 128);
    await control
      .getByLabel("Small-image threshold", { exact: true })
      .fill("96");
    await wait(async () => (await snap()).settings.minImageSize === 96);
    await control.screenshot({
      path: resolve(dir, "preferences.png"),
      fullPage: true,
    });
  });
  await test("scan restart and navigation ignore stale sessions and retain terminal states", async () => {
    await rpc({ type: "SCAN", tabId, command: "start" });
    const first = await wait(async () => {
      const s = (await snap()).scan;
      return s.sessionId ? s : false;
    });
    await rpc({ type: "SCAN", tabId, command: "start" });
    const second = await wait(async () => {
      const s = (await snap()).scan;
      return s.sessionId !== first.sessionId ? s : false;
    });
    assert(second.sessionId);
    await rpc({ type: "SCAN", tabId, command: "stop" });
    await wait(async () => (await snap()).scan.state === "stopped");
    await page.goto(fixture.origin + "/empty");
    await wait(async () => (await snap()).scan.state === "idle");
    await page.waitForTimeout(800);
    assert.equal((await snap()).scan.state, "idle");
  });
  await test("removed and navigated frames cannot leave the scan permanently running", async () => {
    await page.goto(fixture.origin + "/noisy");
    await page.evaluate(() => {
      for (const id of ["removed-frame", "navigated-frame"]) {
        const frame = document.createElement("iframe");
        frame.id = id;
        frame.src = "/frame";
        document.body.prepend(frame);
      }
    });
    await wait(
      async () =>
        (await snap()).records.filter((r) => r.frameId !== 0).length >= 2,
    );
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () => (await snap()).scan.state === "running");
    await page.evaluate(() => {
      document.getElementById("removed-frame").remove();
      document.getElementById("navigated-frame").src = "/empty";
    });
    await wait(async () => (await snap()).scan.state === "complete", 30000);
    assert.equal((await snap()).scan.phase, "complete");
  });
  await test("worker interruption pauses scanning and Resume creates a recoverable new pass", async () => {
    await page.goto(fixture.origin + "/noisy");
    await wait(async () => (await snap()).records.length >= 9);
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () => (await snap()).scan.state === "running");
    const old = (await snap()).scan.sessionId;
    await rpc({ type: "SCAN", tabId, command: "pause" });
    await wait(async () => (await snap()).scan.state === "paused");
    const browserCdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    assert(target);
    await browserCdp.send("Target.closeTarget", { targetId: target.targetId });
    await page.waitForTimeout(500);
    const recovered = await snap();
    assert.equal(recovered.scan.state, "paused");
    assert.match(recovered.scan.reason, /interrupted/);
    await rpc({ type: "SCAN", tabId, command: "resume" });
    await wait(async () => {
      const s = (await snap()).scan;
      return s.state === "running" && s.sessionId !== old;
    });
    await rpc({ type: "SCAN", tabId, command: "stop" });
    await wait(async () => (await snap()).scan.state === "stopped");
    await browserCdp.detach();
  });
  await test("5000-image default-policy scan keeps gallery and page work bounded", async () => {
    await page.goto(fixture.origin + "/perf");
    await wait(async () => (await snap()).records.length >= 5000, 90000);
    await rpc({ type: "SCAN", tabId, command: "start" });
    await page.waitForTimeout(2000);
    await panel.reload();
    await page.bringToFront();
    try {
      await wait(
        async () =>
          (await panel.locator(".selection-bar").textContent())?.includes(
            "5000",
          ),
        90000,
      );
    } catch (error) {
      await panel.screenshot({ path: resolve(dir, "performance-failure.png") });
      const snapshot = await snap();
      await writeFile(
        resolve(dir, "performance-failure.json"),
        JSON.stringify(
          {
            text: await panel.locator("body").innerText(),
            records: snapshot.records.length,
            settings: snapshot.settings,
            power: snapshot.power,
            scan: snapshot.scan,
          },
          null,
          2,
        ),
      );
      throw error;
    }
    const cards = await panel.locator(".image-card").count();
    assert(cards < 30);
    await panel.waitForTimeout(500);
    const longs = await page.evaluate(() => window.longs || []);
    const galleryLongTasks = await panel.evaluate(
      () => window.galleryLongs || [],
    );
    await writeFile(
      resolve(dir, "performance.json"),
      JSON.stringify(
        {
          records: (await snap()).records.length,
          cards,
          longTasks: longs,
          galleryLongTasks,
          pageTaskDetails: await page.evaluate(() => window.longDetails || []),
        },
        null,
        2,
      ),
    );
    assert(longs.filter((n) => n > 100).length <= 1, JSON.stringify(longs));
    assert(
      galleryLongTasks.filter((n) => n > 100).length <= 1,
      JSON.stringify(galleryLongTasks),
    );
    await rpc({ type: "SCAN", tabId, command: "stop" });
    await wait(async () => (await snap()).scan.state === "stopped");
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
