/* global clicks, index -- page-context globals defined by the social fixtures */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { server } from "./server.mjs";
const dir = resolve(
  process.env.SOCIAL_ONLY
    ? "test-results/social-focused"
    : "test-results/social",
);
await mkdir(dir, { recursive: true });
const fixture = await server(),
  results = [],
  errors = [];
let context, worker, control, id;
const wait = async (fn, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Timed out");
};
async function test(name, fn) {
  if (
    process.env.SOCIAL_ONLY &&
    !new RegExp(process.env.SOCIAL_ONLY).test(name)
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
const rpc = async (m) => {
  const r = await control.evaluate((m) => chrome.runtime.sendMessage(m), m);
  if (r?.error) throw Error(r.error);
  return r;
};
const tabs = new Map();
async function clickDock(page, action) {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const find = (n) =>
      n.nodeName === "ZEPHYER-TOOLS"
        ? n
        : (n.children || []).map(find).find(Boolean);
    const host = find(root);
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: host.shadowRoots[0].nodeId,
      selector: `[data-action="${action}"]`,
    });
    const { model } = await cdp.send("DOM.getBoxModel", { nodeId });
    const q = model.border;
    await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    const { result } = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration:
        "function(){return this.getRootNode().querySelector('.z-dock-menu').hidden}",
      returnByValue: true,
    });
    return result.value;
  } finally {
    await cdp.detach();
  }
}
function html(platform, story = false, count = 3) {
  const href =
    platform === "instagram"
      ? "/p/abc/"
      : platform === "x"
        ? "/name/status/123/"
        : platform === "facebook"
          ? "/posts/123/"
          : "/pin/123/";
  return `<!doctype html><title>${platform} photo fixture</title><style>body{margin:32px;background:#e9e7dd;font:16px system-ui;color:#19332a}article{width:600px;max-width:90vw}img{width:400px;height:280px;object-fit:contain}button{padding:12px}header img{width:48px;height:48px}</style><main><article ${story ? 'role="dialog"' : ""}><a href="${href}">Post</a><header><img alt="Profile photo" src="${fixture.origin}/avatar.png"></header><div id="slide" aria-posinset="1" aria-setsize="${count}"><img id="photo" data-media-id="1" alt="Landscape photograph" src="${fixture.origin}/${platform}-slide-1.png?sig=keep%2Bme"></div><button id="previous" aria-label="Anterior" disabled>Back</button><button id="next" aria-label="Siguiente">Next</button></article></main><script>window.index=1;window.clicks=0;function render(){photo.src='${fixture.origin}/${platform}-slide-'+index+'.png?sig=keep%2Bme';photo.dataset.mediaId=String(index);slide.setAttribute('aria-posinset',String(index));previous.disabled=index===1;next.disabled=index===${count};}next.onclick=()=>{clicks++;if(index<${count}){index++;render();}};previous.onclick=()=>{if(index>1){index--;render();}};</script>`;
}
async function source(platform = "instagram", story = false, count = 3) {
  const hosts = {
    instagram: "www.instagram.com",
    facebook: "www.facebook.com",
    x: "x.com",
    pinterest: "www.pinterest.com",
  };
  const path = story
    ? "/stories/person/123/"
    : platform === "instagram"
      ? "/p/abc/"
      : platform === "x"
        ? "/name/status/123/"
        : platform === "facebook"
          ? "/posts/123/"
          : "/pin/123/";
  const page = await context.newPage();
  // Synthetic public HTTPS pages fetch fixture pixels from loopback. Grant
  // only this disposable test profile's local-network permission.
  await context.grantPermissions(["local-network-access"], {
    origin: `https://${hosts[platform]}`,
  });
  await page.route(`https://${hosts[platform]}/**`, (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: "text/html",
          body: html(platform, story, count),
        })
      : route.abort(),
  );
  await page.goto(`https://${hosts[platform]}${path}`);
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).filter((t) => t.url === url).at(-1).id,
    page.url(),
  );
  return {
    page,
    tabId,
    snap: () => rpc({ type: "SNAPSHOT", tabId }),
    activate: () =>
      worker.evaluate((id) => globalThis.activateZephyerTab(id), tabId),
  };
}
try {
  context = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/social-profile-")),
    {
      channel: "chromium",
      headless: true,
      executablePath: process.env.CHROMIUM_PATH,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  id = new URL(worker.url()).hostname;
  control = await context.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  for (const platform of ["instagram", "facebook", "x", "pinterest"]) {
    await test(`${platform}: dormant page, acknowledged activation and semantic photo identity`, async () => {
      const s = await source(platform);
      tabs.set(platform, s);
      assert.equal((await s.snap()).records.length, 0);
      await wait(() =>
        s.page
          .locator("#photo")
          .evaluate((im) => im.complete && im.naturalWidth > 0),
      );
      await s.activate();
      const photo = await wait(async () =>
        (await s.snap()).records.find(
          (r) =>
            r.media?.platform === platform &&
            r.media.kind === "photo" &&
            r.media.slideId === "1",
        ),
      );
      assert(photo.media.contentId);
      assert(photo.displayed.endsWith("?sig=keep%2Bme"));
      assert.equal(
        (await rpc({ type: "ACTIVATION_STATUS", tabId: s.tabId })).stage,
        "ready",
      );
      assert.equal(await s.page.locator("zephyer-tools").count(), 1);
      assert.equal(
        await s.page
          .locator("zephyer-tools")
          .evaluate((el) => el.matches(":popover-open")),
        true,
      );
    });
    await test(`${platform}: bounded carousel captures separate slides and restores original`, async () => {
      const s = tabs.get(platform) || (await source(platform));
      await s.activate();
      await rpc({
        type: "SCAN",
        tabId: s.tabId,
        command: "start",
        target: "carousel",
      });
      await wait(async () =>
        ["complete", "stopped"].includes((await s.snap()).scan.state),
      );
      const photos = (await s.snap()).records.filter(
        (r) => r.media?.kind === "photo",
      );
      assert.deepEqual(
        [...new Set(photos.map((r) => r.media.slideId))].sort(),
        ["1", "2", "3"],
      );
      assert.equal(await s.page.evaluate(() => index), 1);
      assert.equal(await s.page.evaluate(() => clicks), 2);
    });
  }
  await test("missing receiver is injected and concurrent activation does not duplicate observers/docks", async () => {
    const s = tabs.get("instagram") || (await source());
    await s.page.evaluate(() =>
      window.dispatchEvent(new Event("zephyer:dispose")),
    );
    await worker.evaluate(
      async (id) =>
        Promise.all(
          Array.from({ length: 12 }, () => globalThis.activateZephyerTab(id)),
        ),
      s.tabId,
    );
    assert.equal(await s.page.locator("zephyer-tools").count(), 1);
    const before = (await s.snap()).records.length;
    await worker.evaluate(
      (id) =>
        chrome.scripting.executeScript({
          target: { tabId: id },
          files: ["content.js"],
        }),
      s.tabId,
    );
    assert.equal(await s.page.locator("zephyer-tools").count(), 1);
    assert.equal((await s.snap()).records.length, before);
    const health = await worker.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: "PING" }, { frameId: 0 }),
      s.tabId,
    );
    assert.equal(health.observerCount, 1);
  });
  await test("removed host repairs and remains above a modal without stealing focus", async () => {
    const s = tabs.get("instagram") || (await source());
    await s.activate();
    await s.page.evaluate(() => {
      document.querySelector("zephyer-tools").remove();
      const d = document.createElement("dialog");
      d.innerHTML = '<input id="focus-target">';
      document.body.append(d);
      d.showModal();
      document.querySelector("#focus-target").focus();
    });
    await s.activate();
    assert.equal(
      await s.page
        .locator("zephyer-tools")
        .evaluate((el) => el.matches(":popover-open")),
      true,
    );
    assert.equal(
      await s.page.evaluate(() => document.activeElement.id),
      "focus-target",
    );
    assert.equal(
      await clickDock(s.page, "more"),
      false,
      "Dock buttons must accept real pointer input above the modal",
    );
    await s.page.keyboard.press("Escape");
    await s.page.evaluate(() => document.querySelector("dialog").close());
    await s.page.screenshot({ path: resolve(dir, "instagram-dock.png") });
  });
  await test("site-off activation shows restore UI without collection", async () => {
    const s = await source();
    await s.activate();
    await rpc({ type: "SITE_POWER", tabId: s.tabId, enabled: false });
    await s.activate();
    assert.equal((await s.snap()).power.reason, "site-off");
    assert.equal(
      await s.page.locator("zephyer-tools").getAttribute("data-disabled"),
      "true",
    );
    await rpc({ type: "SITE_POWER", tabId: s.tabId, enabled: true });
  });
  await test("Stories are excluded by default and require opt-in plus explicit consent", async () => {
    const s = await source("instagram", true);
    tabs.set("stories", s);
    await s.activate();
    await s.page.waitForTimeout(600);
    assert.equal(
      (await s.snap()).records.filter((r) => r.media?.kind === "story").length,
      0,
    );
    await assert.rejects(
      rpc({
        type: "SCAN",
        tabId: s.tabId,
        command: "start",
        target: "stories",
        storyConsent: true,
      }),
      /Enable optional/,
    );
    await rpc({
      type: "PREFERENCES",
      patch: { instagramStoriesEnabled: true },
    });
    await assert.rejects(
      rpc({
        type: "SCAN",
        tabId: s.tabId,
        command: "start",
        target: "stories",
      }),
      /confirm/,
    );
    assert.equal(await s.page.evaluate(() => clicks), 0);
  });
  await test("opened Story tray stops at its boundary and collects still images", async () => {
    const s = tabs.get("stories");
    await rpc({
      type: "SCAN",
      tabId: s.tabId,
      command: "start",
      target: "stories",
      storyConsent: true,
    });
    await wait(async () =>
      ["complete", "stopped"].includes((await s.snap()).scan.state),
    );
    assert.equal(await s.page.evaluate(() => clicks), 2);
    assert.equal(
      (await s.snap()).records.filter((r) => r.media?.kind === "story").length,
      3,
    );
    assert.match((await s.snap()).scan.reason, /tray exhausted/);
  });
  await test("unknown Story boundary stops safely rather than opening another account", async () => {
    const s = await source("instagram", true);
    await s.activate();
    await s.page
      .locator("#slide")
      .evaluate((el) => el.removeAttribute("aria-setsize"));
    await rpc({
      type: "SCAN",
      tabId: s.tabId,
      command: "start",
      target: "stories",
      storyConsent: true,
    });
    await wait(async () =>
      ["complete", "stopped"].includes((await s.snap()).scan.state),
    );
    assert.equal(await s.page.evaluate(() => clicks), 0);
    assert.match((await s.snap()).scan.reason, /cannot verify/);
  });
  await test("Select mode cannot trigger traversal and Stop leaves no late clicks", async () => {
    const s = await source("instagram", false, 60);
    await s.activate();
    await rpc({ type: "MODE", tabId: s.tabId, value: true });
    await assert.rejects(
      rpc({
        type: "SCAN",
        tabId: s.tabId,
        command: "start",
        target: "carousel",
      }),
      /Select mode/,
    );
    await rpc({ type: "MODE", tabId: s.tabId, value: false });
    await rpc({
      type: "SCAN",
      tabId: s.tabId,
      command: "start",
      target: "carousel",
    });
    await wait(() => s.page.evaluate(() => clicks > 0));
    await rpc({ type: "SCAN", tabId: s.tabId, command: "pause" });
    const clicks = await s.page.evaluate(() => window.clicks);
    await s.page.waitForTimeout(500);
    assert.equal(await s.page.evaluate(() => window.clicks), clicks);
    await rpc({ type: "SCAN", tabId: s.tabId, command: "stop" });
    await s.page.waitForTimeout(400);
    assert.equal(await s.page.evaluate(() => window.clicks), clicks);
  });
  await test("same-post SPA navigation preserves collection and selection; different post detaches", async () => {
    const s = await source();
    await s.activate();
    const record = await wait(async () =>
      (await s.snap()).records.find((r) => r.media?.slideId === "1"),
    );
    await rpc({
      type: "SELECT",
      tabId: s.tabId,
      ids: [record.id],
      value: true,
    });
    await s.page.evaluate(() => history.pushState({}, "", "?img_index=2"));
    await s.page.waitForTimeout(350);
    assert((await s.snap()).records.find((r) => r.id === record.id)?.selected);
    await s.page.evaluate(() => history.pushState({}, "", "/p/different/"));
    await wait(
      async () => !(await s.snap()).records.some((r) => r.id === record.id),
    );
  });
  await test("disabled photo formats are explicit and enable requires a user action", async () => {
    const s = await source();
    await s.activate();
    await s.page.evaluate((origin) => {
      const im = new Image();
      im.src = origin + "/extra-photo.webp";
      im.alt = "Extra photo";
      im.width = 240;
      document.querySelector("article").append(im);
    }, fixture.origin);
    await wait(async () =>
      (await s.snap()).records.some(
        (r) =>
          r.displayed.endsWith("extra-photo.webp") &&
          r.eligibility.state === "excluded",
      ),
    );
    const result = await rpc({ type: "OPEN_GALLERY", tabId: s.tabId });
    const gallery = await wait(() =>
      context
        .pages()
        .find((p) =>
          p.url().includes("gallery.html?collection=" + result.collectionId),
        ),
    );
    await gallery.getByRole("button", { name: "Enable WebP/AVIF" }).waitFor();
    assert.deepEqual((await s.snap()).settings.allowedFormats, ["jpeg", "png"]);
    await gallery.getByRole("button", { name: "Enable WebP/AVIF" }).click();
    await wait(async () =>
      (await s.snap()).settings.allowedFormats.includes("avif"),
    );
    assert(
      (await s.snap()).records.some(
        (r) =>
          r.displayed.endsWith("extra-photo.webp") &&
          r.eligibility.state === "accepted",
      ),
    );
    await gallery.screenshot({ path: resolve(dir, "social-gallery.png") });
    await rpc({
      type: "PREFERENCES",
      patch: { allowedFormats: ["jpeg", "png"] },
    });
  });
  await test("unsupported HEAD resolves through GET; denied bytes fail once with a useful reason", async () => {
    const s = await source();
    await s.activate();
    await s.page.evaluate((origin) => {
      for (const path of ["head-rejected", "fail.png"]) {
        const im = new Image();
        im.src = origin + "/" + path;
        im.width = 240;
        im.alt = path;
        document.querySelector("article").append(im);
      }
    }, fixture.origin);
    const verified = await wait(async () =>
      (await s.snap()).records.find(
        (r) =>
          r.name === "head-rejected" &&
          r.variants.some((v) => v.format === "png"),
      ),
    );
    assert(verified.variants.some((v) => v.method.includes("verified MIME")));
    const blocked = await wait(async () =>
      (await s.snap()).records.find((r) => r.name === "fail.png"),
    );
    const { id: jobId } = await rpc({
      type: "DOWNLOAD",
      tabId: s.tabId,
      ids: [blocked.id],
      output: {
        quality: "best",
        format: "webp",
        width: 0,
        height: 0,
        qualityValue: 0.92,
        upscale: false,
        background: "#ffffff",
        firstFrame: false,
        zip: false,
      },
    });
    const job = await wait(async () => {
      const j = (await s.snap()).jobs.find((j) => j.id === jobId);
      return j?.state === "done" ? j : false;
    });
    assert.equal(job.items[0].state, "failed");
    assert.equal(job.items[0].attempts, 1);
    assert.match(job.items[0].error, /HTTP 403/);
    assert(job.items[0].retrieval.some((t) => t.strategy === "extension"));
  });
  await test("explicit verification retry works while automatic collection remains Off", async () => {
    const s = await source();
    await s.activate();
    await worker.evaluate(() => {
      globalThis.originalProbeFetch = fetch;
      globalThis.fetch = (url, options) =>
        String(url).includes("/retry-probe")
          ? Promise.resolve(new Response(null, { status: 403 }))
          : globalThis.originalProbeFetch(url, options);
    });
    try {
      await s.page.evaluate((origin) => {
        const im = new Image();
        im.src = origin + "/retry-probe";
        im.alt = "Retry candidate";
        im.width = 240;
        document.querySelector("article").append(im);
      }, fixture.origin);
      const pending = await wait(async () =>
        (await s.snap()).records.find(
          (r) =>
            r.name === "Retry candidate" &&
            r.variants.some((v) => v.probeError),
        ),
      );
      await rpc({ type: "PREFERENCES", patch: { automaticCollection: false } });
      await worker.evaluate(
        () => (globalThis.fetch = globalThis.originalProbeFetch),
      );
      await rpc({ type: "VERIFY_RETRY", tabId: s.tabId, ids: [pending.id] });
      await wait(
        async () =>
          (await s.snap()).records.find((r) => r.id === pending.id)?.eligibility
            .state === "accepted",
      );
      assert.equal((await s.snap()).settings.automaticCollection, false);
    } finally {
      await worker.evaluate(
        () => (globalThis.fetch = globalThis.originalProbeFetch),
      );
      await rpc({ type: "PREFERENCES", patch: { automaticCollection: true } });
    }
  });
  await test("an expired candidate refreshes only the same post/slide without rewriting its job snapshot", async () => {
    const s = await source();
    await s.activate();
    await s.page.evaluate((origin) => {
      document.querySelector("#photo").src = origin + "/expired-test.png";
    }, fixture.origin);
    const record = await wait(async () =>
      (await s.snap()).records.find(
        (r) =>
          r.media?.slideId === "1" && r.displayed.endsWith("expired-test.png"),
      ),
    );
    await worker.evaluate(
      ({ tabId, origin }) => {
        globalThis.expiredFetch = fetch;
        let updated = false;
        globalThis.fetch = async (url, options) => {
          if (String(url).includes("/expired-test.png")) {
            if (!updated) {
              updated = true;
              await chrome.scripting.executeScript({
                target: { tabId },
                func: async (origin) => {
                  const im = document.querySelector("#photo");
                  im.src = origin + "/refreshed-test.png";
                  await im.decode();
                },
                args: [origin],
              });
            }
            return new Response(null, { status: 403 });
          }
          return globalThis.expiredFetch(url, options);
        };
      },
      { tabId: s.tabId, origin: fixture.origin },
    );
    try {
      const { id: jobId } = await rpc({
        type: "DOWNLOAD",
        tabId: s.tabId,
        ids: [record.id],
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
      });
      const job = await wait(async () => {
        const j = (await s.snap()).jobs.find((j) => j.id === jobId);
        return j?.state === "done" ? j : false;
      });
      assert.equal(job.items[0].state, "done");
      assert(job.items[0].actualUrl.endsWith("refreshed-test.png"));
      assert(job.items[0].record.displayed.endsWith("expired-test.png"));
      assert.equal(
        job.items[0].retrieval.filter((t) => t.strategy === "refresh").length,
        1,
      );
    } finally {
      await worker.evaluate(() => (globalThis.fetch = globalThis.expiredFetch));
    }
  });
  await test("duplicate photo URLs retain distinct slide identities and pause/resume is predictable", async () => {
    const s = await source();
    await s.activate();
    await s.page.evaluate((origin) => {
      const photo = document.querySelector("#photo");
      photo.src = origin + "/duplicate.png";
      document.querySelector("#next").onclick = () => {
        window.clicks++;
        if (window.index < 3) {
          window.index++;
          photo.dataset.mediaId = String(window.index);
          document
            .querySelector("#slide")
            .setAttribute("aria-posinset", String(window.index));
          document.querySelector("#next").disabled = window.index === 3;
          document.querySelector("#previous").disabled = false;
        }
      };
    }, fixture.origin);
    await rpc({
      type: "SCAN",
      tabId: s.tabId,
      command: "start",
      target: "carousel",
    });
    await wait(async () =>
      ["complete", "stopped"].includes((await s.snap()).scan.state),
    );
    assert.equal(await s.page.evaluate(() => clicks), 2);
    assert((await s.snap()).records.some((r) => r.media?.slideId === "3"));
  });
  await test("carousel hard limit checks fifty items without opening unrelated posts", async () => {
    const s = await source("instagram", false, 60);
    await s.activate();
    await rpc({
      type: "SCAN",
      tabId: s.tabId,
      command: "start",
      target: "carousel",
    });
    await wait(
      async () => ["complete", "stopped"].includes((await s.snap()).scan.state),
      30000,
    );
    assert.equal(await s.page.evaluate(() => clicks), 49);
    assert.match((await s.snap()).scan.reason, /50 items/);
    assert.equal(await s.page.evaluate(() => index), 1);
  });
  await test("withheld access and restricted pages produce actionable redacted diagnostics", async () => {
    const s = await source();
    await worker.evaluate(() => {
      globalThis.originalContains = chrome.permissions.contains;
      chrome.permissions.contains = async () => false;
    });
    try {
      await assert.rejects(s.activate(), /withheld/);
    } finally {
      await worker.evaluate(
        () => (chrome.permissions.contains = globalThis.originalContains),
      );
    }
    const status = await rpc({ type: "ACTIVATION_STATUS", tabId: s.tabId });
    assert.equal(status.category, "access-withheld");
    assert(!JSON.stringify(status).includes("sig="));
    const optionsId = await control.evaluate(
      async () => (await chrome.tabs.getCurrent()).id,
    );
    await assert.rejects(
      worker.evaluate((id) => globalThis.activateZephyerTab(id), optionsId),
      /restricts/,
    );
    assert.equal(
      (await rpc({ type: "ACTIVATION_STATUS", tabId: optionsId })).category,
      "restricted",
    );
    const help = await context.newPage();
    await help.goto(
      `chrome-extension://${id}/troubleshoot.html?tab=${s.tabId}`,
    );
    await help.getByRole("button", { name: "Retry activation" }).click();
    await help.getByRole("heading", { name: "Dock is ready" }).waitFor();
    await help.screenshot({ path: resolve(dir, "activation-help.png") });
  });
} catch (error) {
  console.error(error);
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
