import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { resolve, join, dirname } from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  copyFile,
} from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const sourceVersion = process.env.MIGRATION_FROM || "1.5.0";
assert(["1.5.0", "1.6.0", "1.6.2"].includes(sourceVersion));
const dir = resolve(
  sourceVersion === "1.5.0"
    ? "test-results/migration"
    : sourceVersion === "1.6.0"
      ? "test-results/migration-1.6"
      : "test-results/migration-1.6.2",
);
await mkdir(dir, { recursive: true });
const root = await mkdtemp(resolve("test-results/migration-extension-")),
  profile = await mkdtemp(resolve("test-results/migration-profile-"));
for (const [name, bytes] of Object.entries(
  unzipSync(await readFile(`release/zephyer-${sourceVersion}.zip`)),
)) {
  const path = resolve(root, name);
  assert(path.startsWith(root + "\\"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
const fixture = await server(),
  results = [];
let context;
async function test(name, fn) {
  await fn();
  results.push({ name, status: "passed" });
  console.log("PASS", name);
}
async function wait(fn) {
  for (let i = 0; i < 300; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out");
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname,
    page = await context.newPage();
  await page.goto(fixture.origin);
  let control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const rpc = (m) => control.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  let original;
  await test(`legacy ${sourceVersion} profile has selected records, preferences and a paused job`, async () => {
    assert.equal(
      await worker.evaluate(() => chrome.runtime.getManifest().version),
      sourceVersion,
    );
    if (sourceVersion !== "1.5.0")
      await worker.evaluate(
        (tabId) => globalThis.activateZephyerTab(tabId),
        tabId,
      );
    original = await wait(async () => {
      const s = await rpc({ type: "SNAPSHOT", tabId });
      return s.records?.find((r) => r.displayed.endsWith("/static.png"));
    });
    await rpc({ type: "SELECT", tabId, ids: [original.id], value: true });
    await rpc({
      type: "PREFERENCES",
      patch: { theme: "forest", downloadFolder: "Migration gallery" },
    });
    await worker.evaluate(
      async ({ record, tabId }) => {
        await chrome.storage.local.set({ sequenceNext: 42 });
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("zephyer");
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction("jobs", "readwrite");
            tx.objectStore("jobs").put({
              id: "migration-paused",
              tabId,
              created: Date.now(),
              folder: "Legacy",
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
              state: "paused",
              items: [
                {
                  id: record.id,
                  record,
                  state: "queued",
                  attempts: 0,
                  sequence: 41,
                },
              ],
              archiveIds: [],
              zipPart: 0,
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });
      },
      { record: original, tabId },
    );
  });
  async function copyTree(relative = "") {
    for (const entry of await readdir(join("dist", relative), {
      withFileTypes: true,
    })) {
      const name = join(relative, entry.name),
        target = join(root, name);
      if (entry.isDirectory()) {
        await mkdir(target, { recursive: true });
        await copyTree(name);
      } else await copyFile(join("dist", name), target);
    }
  }
  // Command-line installation bypasses the Developer mode requirement only on
  // first load. Enable it in this isolated profile before testing a real reload.
  const management = await context.newPage();
  await management.goto("chrome://extensions");
  const developerMode = management.locator("#devMode");
  if (!(await developerMode.evaluate((el) => el.checked)))
    await developerMode.click();
  await management.close();
  await copyTree();
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await new Promise((r) => setTimeout(r, 750));
  control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  await rpc({ type: "SNAPSHOT", tabId });
  worker =
    context.serviceWorkers().at(-1) ||
    (await context.waitForEvent("serviceworker"));
  await test(`${sourceVersion} migration preserves live selected families, jobs, settings and numbering`, async () => {
    const s = await rpc({ type: "SNAPSHOT", tabId });
    assert(!s.error, s.error);
    assert.equal(s.settings.theme, "forest");
    assert.equal(s.settings.downloadFolder, "Migration gallery");
    const row = s.records.find((r) => r.id === original.id);
    assert(row && row.selected && row.collectionId);
    const job = s.jobs.find((j) => j.id === "migration-paused");
    assert.equal(job.state, "paused");
    assert.equal(job.items[0].record.id, original.id);
    assert.equal(job.items[0].sequence, 41);
    assert.equal(s.power.activated, false);
    assert.equal(s.settings.automaticCollection, true);
    assert.equal(
      (await worker.evaluate(() => chrome.storage.local.get("sequenceNext")))
        .sequenceNext,
      42,
    );
    const version = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("zephyer");
          r.onsuccess = () => {
            const v = r.result.version;
            r.result.close();
            resolve(v);
          };
        }),
    );
    assert.equal(version, 3);
  });
  await test("a migrated collection opens in Photos with its original selection", async () => {
    await worker.evaluate(
      (tabId) => globalThis.activateZephyerTab(tabId),
      tabId,
    );
    const opened = await rpc({ type: "OPEN_GALLERY", tabId });
    assert(opened.collectionId, JSON.stringify(opened));
    const gallery = await wait(() =>
      context
        .pages()
        .find((p) => p.url().includes(`collection=${opened.collectionId}`)),
    );
    await gallery.waitForSelector(".photo-tile");
    assert.match(
      await gallery.locator(".photos-footer strong").textContent(),
      /1 selected/,
    );
  });
} catch (e) {
  console.error(e);
  try {
    const debug = await context.newPage();
    await debug.goto("chrome://extensions");
    await writeFile(
      join(dir, "extension-state.txt"),
      await debug.locator("body").innerText(),
    );
    await debug.screenshot({ path: join(dir, "extension-state.png") });
  } catch {}
  results.push({ name: "migration", status: "failed", error: String(e) });
  process.exitCode = 1;
} finally {
  await writeFile(join(dir, "results.json"), JSON.stringify(results, null, 2));
  await context?.close();
  fixture.server.close();
}
