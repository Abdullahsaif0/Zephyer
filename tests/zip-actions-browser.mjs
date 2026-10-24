import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { server } from "./server.mjs";
const dir = resolve("test-results/zip-actions");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [];
let context;
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/zip-profile-")),
    {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      viewport: { width: 1080, height: 820 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker")),
    id = new URL(worker.url()).hostname;
  await activateFixtures(context, worker);
  const page = await context.newPage();
  await page.goto(fixture.origin);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 430, height: 960 });
  await panel.goto(`chrome-extension://${id}/panel.html`);
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
      }, m),
    snap = () => rpc({ type: "SNAPSHOT", tabId });
  async function wait(fn, timeout = 25000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
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
  async function read(selector) {
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
    try {
      const { result } = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(){const r=this.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,disabled:this.disabled,display:getComputedStyle(this).display};}`,
        returnByValue: true,
      });
      return result.value;
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    }
  }
  async function click(selector) {
    const r = await wait(async () => {
      const r = await read(selector);
      return r?.w && r?.h ? r : false;
    });
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await page.waitForTimeout(300);
  }
  const rs = await wait(async () => {
      const r = (await snap()).records.filter((r) =>
        ["/static.png", "/linked.png"].some((s) => r.displayed.endsWith(s)),
      );
      return r.length === 2 ? r : false;
    }),
    ids = rs.map((r) => r.id);
  async function checkZip(job) {
    assert.equal(job.output.zip, true);
    assert.equal(job.output.format, "original");
    assert.deepEqual(job.items.map((i) => i.id).sort(), [...ids].sort());
    assert(
      job.items.every((i) => i.state === "done"),
      JSON.stringify(job.items),
    );
    const [download] = await worker.evaluate(
      (id) => chrome.downloads.search({ id }),
      job.archiveIds[0],
    );
    const files = unzipSync(new Uint8Array(await readFile(download.filename)));
    assert.equal(Object.keys(files).length, 2);
    assert(
      Object.values(files).every(
        (b) => Buffer.from(b).subarray(1, 4).toString() === "PNG",
      ),
    );
  }
  await test("library and dock ZIP actions are disabled until images are selected", async () => {
    await panel
      .getByRole("button", {
        name: "Download selected images as ZIP",
        exact: true,
      })
      .waitFor();
    assert(
      await panel
        .getByRole("button", {
          name: "Download selected images as ZIP",
          exact: true,
        })
        .isDisabled(),
    );
    await click("[data-action=more]");
    assert.equal((await read("[data-action=zip]")).disabled, true);
    await click("[data-action=more]");
    assert.equal((await snap()).jobs.length, 0);
  });
  await test("library Download ZIP button creates an archive containing exactly the selection", async () => {
    await rpc({ type: "SELECT", tabId, ids, value: true });
    const button = panel.getByRole("button", {
      name: "Download selected images as ZIP",
      exact: true,
    });
    await wait(async () => await button.isEnabled());
    await panel.screenshot({ path: resolve(dir, "library-zip.png") });
    await button.click();
    const job = await wait(async () => {
      const j = (await snap()).jobs.find((j) => j.output.zip);
      return j?.state === "done" ? j : false;
    }, 60000);
    await checkZip(job);
    await panel.getByRole("button", { name: /^Library/ }).click();
    await page.bringToFront();
    await panel.locator("details.output > summary").click();
    assert.equal(
      await panel.locator("details.output select").nth(2).inputValue(),
      "false",
    );
  });
  await test("dock ZIP action takes an immutable selection snapshot and closes its menu", async () => {
    const before = new Set((await snap()).jobs.map((j) => j.id));
    await click("[data-action=more]");
    await wait(async () => !(await read("[data-action=zip]")).disabled);
    await page.screenshot({ path: resolve(dir, "dock-zip.png") });
    await click("[data-action=zip]");
    await rpc({ type: "SELECT", tabId, ids: [ids[0]], value: false });
    const job = await wait(async () => {
      const j = (await snap()).jobs.find((j) => !before.has(j.id));
      return j?.state === "done" ? j : false;
    }, 60000);
    await checkZip(job);
    assert.equal((await read(".z-dock-menu")).display, "none");
  });
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  await new Promise((r) => fixture.server.close(r));
}
