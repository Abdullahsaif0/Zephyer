import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";

const dir = resolve("test-results/panel-scroll");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [];
let context;
async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "passed" });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, status: "failed", error: String(error) });
    throw error;
  }
}
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/panel-scroll-profile-")),
    {
      channel: "chromium",
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  const source = await context.newPage();
  await source.goto(fixture.origin);
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  await worker.evaluate((id) => globalThis.activateZephyerTab(id), tabId);
  await source.evaluate(() => {
    for (let i = 0; i < 50; i++) {
      const img = new Image();
      img.src = `/scroll-test-${i}.png`;
      img.width = 220;
      img.alt = `Scroll photo ${i}`;
      document.body.prepend(img);
    }
  });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 520 });
  // The panel is rendered in a tab for automation. Native side panels query
  // the source tab; keep that identity while bringing this test surface forward.
  await panel.addInitScript((tabId) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info) =>
      info.active && info.currentWindow
        ? chrome.tabs.get(tabId).then((tab) => [tab])
        : query(info);
  }, tabId);
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.waitForFunction(
    () => document.querySelectorAll(".image-card").length > 0,
  );
  const main = panel.locator("main"),
    grid = panel.getByRole("region", { name: "Collected images" });
  await test("short panel scrolls to images using the mouse wheel", async () => {
    await panel.mouse.move(340, 460);
    await panel.mouse.wheel(0, 850);
    await panel.waitForFunction(
      () => document.querySelector("main").scrollTop > 0,
    );
    await grid.scrollIntoViewIfNeeded();
    const box = await grid.boundingBox();
    assert(box.height >= 320);
    assert(box.y < 520 && box.y + box.height > 0);
  });
  await test("image viewport scrolls and advances the virtualized rows", async () => {
    await panel.waitForFunction(
      () => document.querySelector(".gallery > div")?.offsetHeight > 2000,
    );
    const before = await grid.locator(".image-card").first().textContent();
    await grid.hover();
    await panel.mouse.wheel(0, 1600);
    await panel.waitForFunction(
      () => document.querySelector(".gallery").scrollTop > 500,
    );
    assert.notEqual(
      await grid.locator(".image-card").first().textContent(),
      before,
    );
    assert((await grid.locator(".image-card").count()) < 30);
  });
  await test("keyboard scrolling and expanded output keep download controls reachable", async () => {
    await grid.focus();
    await panel.keyboard.press("Home");
    await panel.keyboard.press("PageDown");
    await panel.waitForFunction(
      () => document.querySelector(".gallery").scrollTop > 0,
    );
    await panel.locator(".output summary").click();
    await panel.locator(".download-actions").scrollIntoViewIfNeeded();
    const box = await panel.locator(".download-actions").boundingBox();
    assert(box.y >= 0 && box.y + box.height <= 521);
    await panel.screenshot({ path: resolve(dir, "short-panel-controls.png") });
  });
  await test("200 percent browser zoom keeps panel controls reachable", async () => {
    const panelTab = await panel.evaluate(
      async () => (await chrome.tabs.getCurrent()).id,
    );
    await worker.evaluate((id) => chrome.tabs.setZoom(id, 2), panelTab);
    await grid.scrollIntoViewIfNeeded();
    assert((await grid.boundingBox()).height >= 320);
    await panel.locator(".download-actions").scrollIntoViewIfNeeded();
    assert((await main.evaluate((el) => el.scrollTop)) > 0);
    await worker.evaluate((id) => chrome.tabs.setZoom(id, 1), panelTab);
  });
  await test("Photos Gallery button opens a separate source-bound full tab", async () => {
    const opened = context.waitForEvent("page");
    await panel
      .getByRole("button", { name: "Open Photos Gallery in new tab" })
      .click();
    const gallery = await opened;
    await gallery.waitForURL(
      `chrome-extension://${id}/gallery.html?collection=*`,
    );
    await gallery.waitForSelector(".photo-tile");
    assert(new URL(gallery.url()).searchParams.get("collection"));
    assert((await gallery.locator(".photo-tile").count()) > 0);
    await gallery.screenshot({ path: resolve(dir, "full-tab-gallery.png") });
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  fixture.server.close();
}
