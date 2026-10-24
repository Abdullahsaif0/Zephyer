import { activateFixtures } from "./activation.mjs";
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve("test-results/liquid");
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  visuals = [];
let context;
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
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/liquid-profile-")),
    {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      viewport: { width: 1180, height: 880 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await activateFixtures(context, worker);
  const id = new URL(worker.url()).hostname,
    page = await context.newPage();
  await page.goto(fixture.origin);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  const rpc = (m) => control.evaluate((m) => chrome.runtime.sendMessage(m), m);
  const tabId = await worker.evaluate(
    async (origin) =>
      (await chrome.tabs.query({})).find((t) => t.url === origin + "/").id,
    fixture.origin,
  );
  const snapshot = () => rpc({ type: "SNAPSHOT", tabId });
  await wait(async () =>
    (await snapshot()).records.some((r) => r.displayed.endsWith("/static.png")),
  );
  const first = (await snapshot()).records.find((r) =>
    r.displayed.endsWith("/static.png"),
  );
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 430, height: 1000 });
  await panel.addInitScript(() => {
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.downloadCalls = 0;
    chrome.runtime.sendMessage = async (m, ...args) => {
      if (m.type === "DOWNLOAD") {
        window.downloadCalls++;
        await new Promise((r) => setTimeout(r, 350));
        if (window.rejectDownload)
          return { error: "Fixture: download rejected" };
      }
      const r = await real(m, ...args);
      if (m.type === "LIBRARY_META")
        return {
          ...r,
          ...(window.testRecords
            ? { recordIds: window.testRecords.map((r) => r.id) }
            : {}),
          ...(window.testJobs ? { jobs: window.testJobs } : {}),
        };
      if (m.type === "RECORDS_BATCH" && window.testRecords)
        return {
          records: window.testRecords.filter((r) => m.ids.includes(r.id)),
        };
      return r;
    };
  });
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await page.bringToFront();
  const refresh = async () => {
    await rpc({ type: "NOTICE", tabId });
    await panel.waitForTimeout(350);
  };
  await wait(async () => (await panel.locator(".image-card").count()) > 0);
  await test("failed download stays in Library and background refresh preserves its action error", async () => {
    await rpc({ type: "SELECT", ids: [first.id], value: true, tabId });
    await wait(
      async () => !(await panel.locator("footer .download").isDisabled()),
    );
    await panel.evaluate(() => (window.rejectDownload = true));
    await panel.locator("footer .download").click();
    await wait(async () =>
      (await panel.locator(".alert").textContent())?.includes(
        "download rejected",
      ),
    );
    assert.equal(
      await panel
        .locator("nav button.active")
        .textContent()
        .then((s) => s.trim().startsWith("Library")),
      true,
    );
    await refresh();
    assert.match(
      await panel.locator(".alert").textContent(),
      /download rejected/,
    );
    assert.equal((await snapshot()).jobs.length, 0);
  });
  await test("rapid download submissions create exactly one job", async () => {
    await panel.evaluate(() => {
      window.rejectDownload = false;
      window.downloadCalls = 0;
      const b = document.querySelector("footer .download");
      b.click();
      b.click();
    });
    await wait(async () => (await snapshot()).jobs.length === 1);
    assert.equal(await panel.evaluate(() => window.downloadCalls), 1);
    await wait(async () => (await snapshot()).jobs[0].state === "done");
    await panel.locator("nav button").first().click();
  });
  await test("filtering a scrolled collection renders matching cards immediately", async () => {
    await panel.evaluate(
      (first) =>
        (window.testRecords = Array.from({ length: 200 }, (_, i) => ({
          ...first,
          id: first.id + i,
          name: i === 0 ? "unique-filter-target" : "image-" + i,
        }))),
      first,
    );
    await refresh();
    await panel.locator(".gallery").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
      e.dispatchEvent(new Event("scroll"));
    });
    await panel.locator(".filters > input").fill("unique-filter-target");
    await wait(async () => (await panel.locator(".image-card").count()) === 1);
    assert.match(
      await panel.locator(".image-card").textContent(),
      /unique-filter-target/,
    );
    assert.equal(
      await panel.locator(".gallery").evaluate((e) => e.scrollTop),
      0,
    );
    await panel.locator(".filters > input").fill("");
  });
  await test("a corrected preview URL recovers without remounting the image family", async () => {
    await panel.route("**/missing-preview.png", (route) => route.abort());
    const bad = {
      ...first,
      displayed: fixture.origin + "/missing-preview.png",
      variants: [
        {
          ...first.variants[0],
          url: fixture.origin + "/missing-preview.png",
          format: "png",
        },
      ],
    };
    await panel.evaluate((r) => (window.testRecords = [r]), bad);
    await refresh();
    await wait(async () =>
      (await panel.locator(".unavailable").textContent())?.includes(
        "unavailable",
      ),
    );
    await panel.evaluate((r) => (window.testRecords = [r]), first);
    await refresh();
    await wait(async () =>
      panel
        .locator(".preview img")
        .evaluate((e) => e.complete && e.naturalWidth > 0),
    );
    await panel.evaluate(() => delete window.testRecords);
    await refresh();
  });
  await test("preferences preserve unsaved edits and synchronize clean external fields", async () => {
    const folder = control.getByRole("textbox", { name: "Download subfolder" });
    await folder.fill("My unsaved folder");
    await rpc({ type: "PREFERENCES", patch: { hideAvatars: true } });
    await wait(async () =>
      control.getByLabel("Hide likely avatars").isChecked(),
    );
    assert.equal(await folder.inputValue(), "My unsaved folder");
    await folder.blur();
    await wait(
      async () =>
        (await snapshot()).settings.downloadFolder === "My unsaved folder",
    );
  });
  await test("invalid preference gets an inline error and never reaches persisted settings", async () => {
    const folder = control.getByRole("textbox", { name: "Download subfolder" });
    await folder.fill("../outside");
    await folder.blur();
    await wait(
      async () => (await folder.getAttribute("aria-invalid")) === "true",
    );
    assert.match(
      await control.locator("#error-downloadFolder").textContent(),
      /invalid/,
    );
    assert.equal(
      (await snapshot()).settings.downloadFolder,
      "My unsaved folder",
    );
    await folder.fill("Zephyer");
    await folder.blur();
    await wait(
      async () => (await snapshot()).settings.downloadFolder === "Zephyer",
    );
  });
  await control.addInitScript(() => {
    window.preferenceWrites = 0;
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (m, ...args) => {
      if (m.type === "PREFERENCES") {
        window.preferenceWrites++;
        while (window.holdSecond && window.preferenceWrites === 2)
          await new Promise((r) => setTimeout(r, 40));
        await new Promise((r) => setTimeout(r, 450));
        if (window.rejectAppearance && m.patch.theme)
          return { error: "Fixture: appearance rejected" };
      }
      return real(m, ...args);
    };
  });
  await test("rapid preference changes stay Saving until the final write completes", async () => {
    await control.reload();
    await control.getByRole("button", { name: "Dusk theme" }).waitFor();
    await control.evaluate(() => {
      window.preferenceWrites = 0;
      window.holdSecond = true;
    });
    await control.getByRole("button", { name: "Dusk theme" }).click();
    await control.getByRole("button", { name: "Forest theme" }).click();
    await wait(
      async () => (await control.evaluate(() => window.preferenceWrites)) === 2,
    );
    assert.match(await control.locator(".save-status").textContent(), /Saving/);
    await control.evaluate(() => (window.holdSecond = false));
    await wait(async () =>
      (await control.locator(".save-status").textContent())?.includes(
        "All changes saved",
      ),
    );
    assert.equal((await snapshot()).settings.theme, "forest");
  });
  await test("rejected appearance restores the persisted theme and reports its error", async () => {
    await control.evaluate(() => (window.rejectAppearance = true));
    await control.getByRole("button", { name: "Dusk theme" }).click();
    await wait(async () =>
      (await control.locator("#error-theme").textContent())?.includes(
        "appearance rejected",
      ),
    );
    assert.equal(
      await control.locator("html").getAttribute("data-theme"),
      "forest",
    );
    assert.equal(
      await control
        .getByRole("button", { name: "Forest theme" })
        .getAttribute("aria-pressed"),
      "true",
    );
    await control.evaluate(() => (window.rejectAppearance = false));
  });
  await test("global pause stops scanning until detection is enabled and Resume is requested", async () => {
    await rpc({ type: "SCAN", tabId, command: "start" });
    await wait(async () => (await snapshot()).scan.state === "running");
    await rpc({ type: "PREFERENCES", patch: { enabled: false } });
    await wait(async () => (await snapshot()).scan.state === "paused");
    const y = await page.evaluate(() => scrollY);
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => scrollY), y);
    assert.match(
      (await rpc({ type: "SCAN", tabId, command: "resume" })).error,
      /Enable image detection/,
    );
    await rpc({ type: "PREFERENCES", patch: { enabled: true } });
    assert.equal((await snapshot()).scan.state, "paused");
    await rpc({ type: "SCAN", tabId, command: "resume" });
    await wait(async () => (await snapshot()).scan.state === "running");
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(dir, "scan-activity.png") });
    await rpc({ type: "SCAN", tabId, command: "stop" });
    await wait(async () => (await snapshot()).scan.state === "stopped");
  });
  await test("a cancelled ZIP stays cancelled after a late fetch failure and rejects stale Resume", async () => {
    await page.evaluate(() => {
      const image = new Image();
      image.src = "/delayed-failure.png";
      image.width = 640;
      image.height = 480;
      document.body.append(image);
    });
    const delayed = await wait(async () =>
      (await snapshot()).records.find((r) =>
        r.displayed.endsWith("/delayed-failure.png"),
      ),
    );
    const baseOutput = {
      quality: "displayed",
      format: "original",
      width: 0,
      height: 0,
      qualityValue: 0.92,
      upscale: false,
      background: "#ffffff",
      firstFrame: false,
      zip: true,
    };
    const created = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [delayed.id],
      output: baseOutput,
    });
    assert(created.id);
    await wait(async () =>
      (await snapshot()).jobs
        .find((j) => j.id === created.id)
        .items.some((i) => i.state === "fetching"),
    );
    await rpc({ type: "JOB", id: created.id, command: "cancel" });
    await page.waitForTimeout(1800);
    const job = (await snapshot()).jobs.find((j) => j.id === created.id);
    assert.equal(job.state, "cancelled");
    assert(job.items.every((i) => i.state === "cancelled"));
    assert.match(
      (await rpc({ type: "JOB", id: created.id, command: "resume" })).error,
      /Only paused/,
    );
  });
  await test("late Save as cancellation cannot change an explicitly cancelled job to done", async () => {
    await rpc({ type: "PREFERENCES", patch: { askWhereToSave: true } });
    await worker.evaluate(() => {
      globalThis.realDownload = chrome.downloads.download;
      chrome.downloads.download = () =>
        new Promise((resolve, reject) => {
          globalThis.rejectPicker = () => reject(Error("Download canceled"));
        });
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
      zip: true,
    };
    const created = await rpc({
      type: "DOWNLOAD",
      tabId,
      ids: [first.id],
      output,
    });
    await wait(async () => worker.evaluate(() => !!globalThis.rejectPicker));
    await rpc({ type: "JOB", id: created.id, command: "cancel" });
    await worker.evaluate(() => globalThis.rejectPicker());
    await page.waitForTimeout(800);
    const job = (await snapshot()).jobs.find((j) => j.id === created.id);
    assert.equal(job.state, "cancelled");
    assert(job.items.every((i) => i.state === "cancelled"));
    await worker.evaluate(() => {
      chrome.downloads.download = globalThis.realDownload;
      delete globalThis.rejectPicker;
    });
    await rpc({ type: "PREFERENCES", patch: { askWhereToSave: false } });
  });
  await test("batched library transport matches stored families and rejects oversized or cross-tab batches", async () => {
    const full = await snapshot(),
      metadata = await rpc({ type: "LIBRARY_META", tabId });
    assert.deepEqual(
      [...metadata.recordIds].sort(),
      full.records.map((r) => r.id).sort(),
    );
    assert.equal(metadata.records, undefined);
    assert(
      metadata.jobs.every((j) =>
        j.items.every((i) => Object.keys(i.record).join() === "name"),
      ),
    );
    const chunk = await rpc({
      type: "RECORDS_BATCH",
      tabId,
      ids: metadata.recordIds.slice(0, 200),
    });
    assert.equal(
      chunk.records.length,
      Math.min(200, metadata.recordIds.length),
    );
    assert.match(
      (
        await rpc({
          type: "RECORDS_BATCH",
          tabId,
          ids: Array(201).fill(first.id),
        })
      ).error,
      /Invalid library batch/,
    );
    const other = await context.newPage();
    await other.goto(fixture.origin + "/empty");
    const otherId = await worker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url === origin + "/empty")
          .id,
      fixture.origin,
    );
    assert.deepEqual(
      (await rpc({ type: "RECORDS_BATCH", tabId: otherId, ids: [first.id] }))
        .records,
      [],
    );
    await other.close();
    await page.bringToFront();
  });
  await test("per-file queue results render only when opened and paginate at 50 rows", async () => {
    const job = (await snapshot()).jobs[0];
    const fixtureJob = {
      ...job,
      items: Array.from({ length: 101 }, (_, i) => ({
        ...job.items[0],
        id: `fixture-${i}`,
        file: `image-${i + 1}.png`,
        record: { name: `Image ${i + 1}` },
      })),
    };
    await panel.evaluate((j) => (window.testJobs = [j]), fixtureJob);
    await refresh();
    await panel.locator("nav button").nth(1).click();
    assert.equal(await panel.locator(".job-item").count(), 0);
    await panel.locator(".job summary").click();
    await wait(async () => (await panel.locator(".job-item").count()) === 50);
    await panel.getByRole("button", { name: "Next files" }).click();
    assert.match(
      await panel.locator(".job-item").first().textContent(),
      /image-51.png/,
    );
    await panel.getByRole("button", { name: "Next files" }).click();
    assert.equal(await panel.locator(".job-item").count(), 1);
    await panel.getByRole("button", { name: "Previous files" }).click();
    assert.equal(await panel.locator(".job-item").count(), 50);
    await panel.evaluate(() => delete window.testJobs);
    await refresh();
    await panel.locator("nav button").first().click();
  });
  await test("all six glass palettes render without horizontal overflow and keep SVG identity", async () => {
    for (const theme of [
      "graphite",
      "porcelain",
      "midnight",
      "forest",
      "dusk",
      "sand",
    ]) {
      await rpc({ type: "PREFERENCES", patch: { theme, showUpcoming: false } });
      await wait(
        async () =>
          (await panel.locator("html").getAttribute("data-theme")) === theme,
      );
      for (const width of [320, 430]) {
        await panel.setViewportSize({ width, height: 1000 });
        await panel.screenshot({
          path: resolve(dir, `${theme}-library-${width}.png`),
        });
        const m = await panel.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
          glass: getComputedStyle(document.querySelector("header"))
            .backdropFilter,
        }));
        assert(m.scroll <= m.width, JSON.stringify(m));
        assert.match(m.glass, /blur/);
        visuals.push({ theme, width, ...m });
      }
      await control.screenshot({
        path: resolve(dir, `${theme}-preferences.png`),
        fullPage: true,
      });
      assert.equal(await panel.locator(".logo svg").count(), 1);
      await page.evaluate((light) => {
        document.body.style.background = light
          ? "radial-gradient(at 20% 90%,#d9e8eb,transparent 65%),radial-gradient(at 80% 70%,#efddc8,transparent 70%),#fafafa"
          : "radial-gradient(at 20% 90%,#19443c,transparent 65%),radial-gradient(at 80% 70%,#393152,transparent 70%),#08090c";
        document.body.style.backgroundAttachment = "fixed";
        document.body.style.color = light ? "#183529" : "#e7efec";
      }, ["porcelain", "sand"].includes(theme));
      await page.screenshot({ path: resolve(dir, `${theme}-dock.png`) });
    }
  });
  await test("reduced motion, high contrast and 200 percent zoom retain usable controls", async () => {
    await panel.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
    const style = await panel.locator("header").evaluate((e) => ({
      blur: getComputedStyle(e).backdropFilter,
      bg: getComputedStyle(e).backgroundColor,
    }));
    assert.equal(style.blur, "none");
    assert.match(style.bg, /^rgb\(/);
    await control.evaluate(() => (document.body.style.zoom = "2"));
    await control.screenshot({
      path: resolve(dir, "preferences-200-percent.png"),
      fullPage: true,
    });
    await panel.emulateMedia({ forcedColors: "active" });
    await panel.screenshot({ path: resolve(dir, "forced-colors.png") });
    assert.equal(
      await panel
        .locator("header")
        .evaluate((e) => getComputedStyle(e).backdropFilter),
      "none",
    );
    await panel.emulateMedia({
      forcedColors: "none",
      reducedMotion: "no-preference",
      contrast: "no-preference",
    });
    await control.evaluate(() => (document.body.style.zoom = "1"));
    await rpc({ type: "PREFERENCES", patch: { theme: "graphite" } });
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2),
  );
  await writeFile(
    resolve(dir, "visuals.json"),
    JSON.stringify(visuals, null, 2),
  );
  await context?.close();
  fixture.server.close();
}
