import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve("test-results/code-audit");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [];
let context;
const output = {
  format: "original",
  quality: "best",
  width: 0,
  height: 0,
  qualityValue: 0.92,
  upscale: false,
  background: "#ffffff",
  firstFrame: false,
  zip: false,
};
async function wait(fn, ms = 30000) {
  const end = Date.now() + ms;
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
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/code-audit-profile-")),
    {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      executablePath: process.env.CHROMIUM_PATH,
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).hostname;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`);
  const rpc = (m) => control.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const page = await context.newPage();
  await page.goto(fixture.origin + "/empty");
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    page.url(),
  );
  const snap = () => rpc({ type: "SNAPSHOT", tabId });
  await test("activation and permission changes advance revisions even without automatic collection", async () => {
    const initial = (await snap()).power.revision;
    await worker.evaluate((id) => globalThis.activateZephyerTab(id), tabId);
    assert((await snap()).power.revision > initial);
    await rpc({ type: "MODE", tabId, value: true });
    await rpc({ type: "AUTO_COLLECTION", enabled: false });
    assert.equal((await snap()).selectMode, true);
    const on = (await snap()).power.revision;
    await rpc({ type: "SITE_POWER", tabId, enabled: false });
    const off = (await snap()).power.revision;
    assert(off > on);
    await rpc({ type: "SITE_POWER", tabId, enabled: true });
    assert((await snap()).power.revision > off);
    await rpc({ type: "AUTO_COLLECTION", enabled: true });
  });
  await page.evaluate(() => {
    const i = new Image();
    i.id = "photo";
    i.src = "/audit.png";
    document.body.append(i);
  });
  const first = await wait(async () =>
    (await snap()).records.find((r) => r.displayed.endsWith("/audit.png")),
  );
  let gallery, collectionId;
  await test("same-document navigation cannot overwrite retained collection IDs or selection", async () => {
    await rpc({ type: "SELECT", tabId, ids: [first.id], value: true });
    const opened = await rpc({ type: "OPEN_GALLERY", tabId });
    collectionId = opened.collectionId;
    gallery =
      context.pages().find((p) => p.url().includes(collectionId)) ||
      (await context.waitForEvent("page"));
    await page.evaluate(() => history.pushState({}, "", "/audit-route"));
    const replacement = await wait(async () =>
      (await snap()).records.find(
        (r) => r.displayed.endsWith("/audit.png") && r.id !== first.id,
      ),
    );
    const old = await rpc({
      type: "COLLECTION_BATCH",
      collectionId,
      ids: [first.id],
    });
    assert.equal(old.records.length, 1);
    assert.equal(old.records[0].selected, true);
    assert.equal(old.records[0].detached, true);
    assert.equal(replacement.selected, false);
    assert.equal(
      (await rpc({ type: "COLLECTION_META", collectionId })).collection.state,
      "detached",
    );
  });
  await test("duplicated gallery tabs retain their collection independently", async () => {
    const duplicate = await context.newPage();
    await duplicate.goto(gallery.url());
    await duplicate.waitForSelector(".photo-tile");
    await gallery.close();
    gallery = duplicate;
    const meta = await rpc({ type: "COLLECTION_META", collectionId });
    assert(meta.collection, JSON.stringify(meta));
    assert(meta.ids.includes(first.id));
  });
  await test("tab-based download retry reuses the job and reserves sequence only once", async () => {
    const image = (await snap()).records.find((r) =>
      r.displayed.endsWith("/audit.png"),
    );
    const message = {
      type: "DOWNLOAD",
      tabId,
      ids: [image.id],
      output,
      requestId: crypto.randomUUID(),
    };
    const [a, b] = await Promise.all([rpc(message), rpc(message)]);
    assert(a.id, JSON.stringify(a));
    assert.equal(b.id, a.id);
    const before = await control.evaluate(() =>
      chrome.storage.local.get("sequenceNext"),
    );
    assert.equal((await rpc(message)).id, a.id);
    assert.equal(
      (await control.evaluate(() => chrome.storage.local.get("sequenceNext")))
        .sequenceNext,
      before.sequenceNext,
    );
    assert.equal(
      (await snap()).jobs.filter((j) => j.clientRequestId === message.requestId)
        .length,
      1,
    );
  });
  await test("a stale mixed download selection fails as a whole rather than silently losing files", async () => {
    const image = (await snap()).records.find((r) =>
      r.displayed.endsWith("/audit.png"),
    );
    const before = (await snap()).jobs.length;
    const result = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [image.id, "missing-image"],
      output,
    });
    assert(
      result.error?.includes("unavailable or excluded"),
      JSON.stringify(result),
    );
    assert.equal((await snap()).jobs.length, before);
  });
  await test("failed scan dispatch releases its temporary automatic-collection grant", async () => {
    await rpc({ type: "AUTO_COLLECTION", enabled: false });
    await worker.evaluate(() => {
      const original = chrome.tabs.sendMessage;
      globalThis.restoreAuditMessage = () => {
        chrome.tabs.sendMessage = original;
      };
      chrome.tabs.sendMessage = (tab, m, ...args) =>
        m.type === "SCAN"
          ? Promise.reject(Error("Fixture: frame unavailable"))
          : original(tab, m, ...args);
    });
    try {
      const response = await rpc({ type: "SCAN", tabId, command: "start" });
      assert(
        response.error?.includes("frame unavailable"),
        JSON.stringify(response),
      );
      const state = await snap();
      assert.equal(state.power.collecting, false);
      assert.equal(state.scan.state, "stopped");
    } finally {
      await worker.evaluate(() => globalThis.restoreAuditMessage());
      await rpc({ type: "AUTO_COLLECTION", enabled: true });
    }
  });
  await test("parallel preview IDs cannot replace another active cancellation token", async () => {
    const message = {
      type: "COLLECTION_PREVIEW",
      collectionId,
      id: first.id,
      url: first.displayed,
      full: true,
      requestId: crypto.randomUUID(),
    };
    const responses = await gallery.evaluate(
      (m) =>
        Promise.all([
          chrome.runtime.sendMessage(m),
          chrome.runtime.sendMessage(m),
        ]),
      message,
    );
    assert.equal(
      responses.filter((r) => r.error?.includes("already active")).length,
      1,
      JSON.stringify(responses),
    );
    const preview = responses.find((r) => r.blobUrl);
    assert(preview, JSON.stringify(responses));
    await gallery.evaluate(
      (url) => chrome.runtime.sendMessage({ type: "PREVIEW_RELEASE", url }),
      preview.blobUrl,
    );
  });
  await test("a newly inserted picture source updates its existing image family", async () => {
    await page.evaluate(() => {
      const picture = document.createElement("picture");
      picture.id = "picture";
      const im = new Image();
      im.src = "/picture-thumb.png";
      picture.append(im);
      document.body.append(picture);
    });
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.displayed.endsWith("/picture-thumb.png"),
      ),
    );
    await page.evaluate(() => {
      const source = document.createElement("source");
      source.media = "(min-width: 99999px)";
      source.srcset = "/hidden-large.png 2400w";
      document.querySelector("#picture").prepend(source);
    });
    await wait(async () =>
      (await snap()).records.some((r) =>
        r.variants.some((v) => v.url.endsWith("/hidden-large.png")),
      ),
    );
  });
  await test("Stop remains deterministic after a scan reaches completion", async () => {
    assert.equal(await rpc({ type: "SCAN", tabId, command: "start" }), true);
    await wait(async () => (await snap()).scan.state === "complete");
    assert.equal(await rpc({ type: "SCAN", tabId, command: "stop" }), true);
    await wait(async () => (await snap()).scan.state === "stopped");
    await page.waitForTimeout(800);
    assert.equal((await snap()).scan.state, "stopped");
  });
  await test("paged reads and atomic selection preserve every record across batch boundaries", async () => {
    const image = (await snap()).records.find((r) =>
      r.displayed.endsWith("/audit.png"),
    );
    const ids = await control.evaluate(async (image) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("zephyer");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const ids = Array.from(
        { length: 401 },
        (_, i) => image.id + "-batch-" + String(i).padStart(4, "0"),
      );
      await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        ids.forEach((id, i) =>
          tx
            .objectStore("records")
            .put({ ...image, id, selected: false, discoveredOrder: 100 + i }),
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return ids;
    }, image);
    const result = await rpc({ type: "SELECT", tabId, ids, value: true });
    assert.equal(result, true, JSON.stringify(result));
    const selected = (await snap()).records.filter((r) => ids.includes(r.id));
    assert.equal(selected.length, 401);
    assert(selected.every((r) => r.selected));
    assert.equal(new Set(selected.map((r) => r.collectionRevision)).size, 1);
  });
  await test("ZIP insertion failure releases the prepared image Blob URL", async () => {
    const image = (await snap()).records.find((r) =>
      r.displayed.endsWith("/audit.png"),
    );
    await worker.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      globalThis.restoreAuditRuntime = () => {
        chrome.runtime.sendMessage = original;
      };
      chrome.runtime.sendMessage = async (...args) => {
        const m = args[0];
        if (m?.target === "offscreen" && m.operation === "ZIP_ADD") {
          globalThis.auditZIPBlob = m.url;
          globalThis.auditZIPBlobWasReadable = (await fetch(m.url)).ok;
          throw Error("Invalid fixture archive insertion");
        }
        return original(...args);
      };
    });
    try {
      const job = await rpc({
        type: "DOWNLOAD",
        tabId,
        ids: [image.id],
        output: { ...output, zip: true },
      });
      assert(job.id, JSON.stringify(job));
      await wait(
        async () =>
          (await snap()).jobs.find((j) => j.id === job.id)?.items[0].state ===
          "failed",
      );
      const state = await worker.evaluate(async () => {
        let readable = false;
        try {
          readable = (await fetch(globalThis.auditZIPBlob)).ok;
        } catch {}
        return { before: globalThis.auditZIPBlobWasReadable, after: readable };
      });
      assert.equal(state.before, true);
      assert.equal(state.after, false);
    } finally {
      await worker.evaluate(() => globalThis.restoreAuditRuntime());
    }
  });
  await test("worker recovery removes orphan collections and abandoned preview Blobs", async () => {
    const preview = await gallery.evaluate(
      (m) => chrome.runtime.sendMessage(m),
      {
        type: "COLLECTION_PREVIEW",
        collectionId,
        id: first.id,
        url: first.displayed,
        full: true,
        requestId: crypto.randomUUID(),
      },
    );
    assert(preview.blobUrl, JSON.stringify(preview));
    assert.equal(
      await control.evaluate(
        async (url) => (await fetch(url)).ok,
        preview.blobUrl,
      ),
      true,
    );
    await control.evaluate(async () => {
      const { collectionEpoch: epoch } =
        await chrome.storage.session.get("collectionEpoch");
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("zephyer");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["records", "collections"], "readwrite");
        tx.objectStore("collections").put({
          id: "audit-orphan",
          epoch,
          tabId: 987654321,
          documentId: "lost",
          url: "https://lost.test",
          title: "lost",
          state: "live",
          revision: 1,
          nextOrder: 1,
        });
        tx.objectStore("records").put({
          id: "audit-orphan-record",
          collectionId: "audit-orphan",
          tabId: 987654321,
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes(extensionId),
    );
    await cdp.send("Target.closeTarget", { targetId: target.targetId });
    await rpc({ type: "SNAPSHOT", tabId });
    const orphan = await rpc({
      type: "COLLECTION_META",
      collectionId: "audit-orphan",
    });
    assert(orphan.error?.includes("Session ended"), JSON.stringify(orphan));
    assert.equal(
      await control.evaluate(async (url) => {
        try {
          return (await fetch(url)).ok;
        } catch {
          return false;
        }
      }, preview.blobUrl),
      false,
    );
    await cdp.detach();
  });
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await context?.close();
  await new Promise((r) => fixture.server.close(r));
}
