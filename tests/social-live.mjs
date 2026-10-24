import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
const dir = resolve("test-results/social-live");
await mkdir(dir, { recursive: true });
const matrix = [];
const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve("test-results/social-live-profile-")),
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
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const control = await context.newPage();
await control.goto(
  `chrome-extension://${new URL(worker.url()).hostname}/options.html`,
);
const rpc = async (message) => {
  const result = await control.evaluate(
    (m) => chrome.runtime.sendMessage(m),
    message,
  );
  if (result?.error) throw Error(result.error);
  return result;
};
const nativeAttempted = new Set();
async function observe(page, platform, view) {
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).filter((t) => t.url === url).at(-1)?.id,
    page.url(),
  );
  if (!tabId)
    return { activation: "unverified", reason: "Source tab unavailable" };
  let activation = "ready";
  try {
    await worker.evaluate((id) => globalThis.activateZephyerTab(id), tabId);
  } catch {
    activation = "failed";
  }
  await page.waitForTimeout(500);
  const snapshot = await rpc({ type: "SNAPSHOT", tabId });
  const capability = await rpc({ type: "CAPABILITIES", tabId }).catch(
    () => null,
  );
  const photos = snapshot.records
    .filter(
      (r) =>
        r.media?.kind === "photo" &&
        r.media.contentId &&
        r.eligibility?.state === "accepted",
    )
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const details = {
    activation,
    dockHosts: await page.locator("zephyer-tools").count(),
    records: snapshot.records.length,
    useful: snapshot.records.filter((r) => r.eligibility?.state === "accepted")
      .length,
    socialPhotos: photos.length,
    capability,
    preview: "not attempted",
    native: "not attempted",
  };
  const record = photos[0];
  if (record && view === "individual image") {
    let blob;
    try {
      const result = await rpc({
        type: "COLLECTION_PREVIEW",
        collectionId: record.collectionId,
        id: record.id,
        url: record.displayed,
        full: false,
        requestId: crypto.randomUUID(),
      });
      blob = result.blobUrl;
      details.preview = "decoded";
    } catch (error) {
      details.preview = /HTTP \d{3}/.exec(String(error))?.[0] || "unavailable";
    } finally {
      if (blob) await rpc({ type: "PREVIEW_RELEASE", url: blob });
    }
    if (!nativeAttempted.has(platform)) {
      nativeAttempted.add(platform);
      const { id: jobId } = await rpc({
        type: "DOWNLOAD",
        tabId,
        ids: [record.id],
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
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        const job = (await rpc({ type: "SNAPSHOT", tabId })).jobs.find(
          (j) => j.id === jobId,
        );
        if (job?.state === "done") {
          details.native = job.items[0].state;
          details.fallback = !!job.items[0].fallback;
          break;
        }
        await page.waitForTimeout(250);
      }
      if (details.native === "not attempted") {
        details.native = "timed out/cancelled";
        await rpc({ type: "JOB", id: jobId, command: "cancel" });
      }
    }
  }
  return details;
}
const platforms = [
  ["Instagram", "https://www.instagram.com/nasa/", /\/p\//],
  ["Facebook", "https://www.facebook.com/NASA/", /\/posts\/|[?&]fbid=/],
  ["X", "https://x.com/NASA", /\/status\/\d+/],
  [
    "Pinterest",
    "https://www.pinterest.com/search/pins/?q=landscape",
    /\/pin\/\d+/,
  ],
];
try {
  for (const [platform, url, postPattern] of platforms) {
    const page = await context.newPage();
    let blocked = "",
      candidates = [];
    try {
      const response = await page.goto(url, {
        timeout: 10000,
        waitUntil: "domcontentloaded",
      });
      if (response && response.status() >= 400)
        blocked = `HTTP ${response.status()}`;
      const tabId = await worker.evaluate(
        async (url) =>
          (await chrome.tabs.query({})).filter((t) => t.url === url).at(-1)?.id,
        page.url(),
      );
      if (tabId)
        await worker
          .evaluate((id) => globalThis.activateZephyerTab(id), tabId)
          .catch(() => {});
      await page.waitForTimeout(1200);
      candidates = (
        await page
          .locator("a[href]")
          .evaluateAll((links) => links.map((a) => a.href))
      ).filter((href) => {
        try {
          return (
            postPattern.test(href) &&
            new URL(href).hostname.replace(/^www\./, "") ===
              new URL(url).hostname.replace(/^www\./, "")
          );
        } catch {
          return false;
        }
      });
      const login = await page.locator('input[type="password"]').count();
      if (login) blocked = "Login wall or authentication required";
      if (!candidates.length && !blocked)
        blocked =
          "No accessible post links in loaded shell; feed compatibility unverified";
      await page.screenshot({
        path: resolve(dir, `${platform.toLowerCase()}-profile.png`),
      });
      const details = await observe(page, platform, "feed/profile");
      matrix.push({
        ...details,
        platform,
        view: "feed/profile",
        session: "logged-out",
        url,
        status: blocked ? "blocked/unverified" : "observed only",
        reason:
          blocked ||
          "Accessible post links; activation/discovery observations recorded below",
      });
    } catch (error) {
      blocked = /Timeout/.test(String(error))
        ? "Navigation timed out; page access unavailable in this environment"
        : `Navigation/network unavailable: ${/net::[A-Z_]+/.exec(String(error))?.[0] || "browser navigation failed"}`;
      matrix.push({
        platform,
        view: "feed/profile",
        session: "logged-out",
        url,
        status: "blocked/unverified",
        reason: blocked,
      });
    }
    for (const view of ["individual image", "carousel", "modal viewer"]) {
      if (blocked || !candidates.length) {
        matrix.push({
          platform,
          view,
          session: "logged-out",
          status: "blocked/unverified",
          reason:
            "Requires an accessible post from this platform's feed/profile",
        });
        continue;
      }
      try {
        if (view === "modal viewer") {
          await page.goto(url, {
            timeout: 10000,
            waitUntil: "domcontentloaded",
          });
          const index = await page
            .locator("a[href]")
            .evaluateAll(
              (links, href) => links.findIndex((a) => a.href === href),
              candidates[0],
            );
          if (index < 0)
            throw Error("The chosen post link is no longer present");
          await page.locator("a[href]").nth(index).click({ timeout: 3000 });
        } else
          await page.goto(candidates[0], {
            timeout: 10000,
            waitUntil: "domcontentloaded",
          });
        await page.waitForTimeout(700);
        const observation = await observe(page, platform, view);
        const details = await page.evaluate(() => ({
          images: [...document.images].filter(
            (i) => i.complete && i.naturalWidth > 100,
          ).length,
          modal: !!document.querySelector('[role="dialog"],dialog[open]'),
          login: !!document.querySelector('input[type="password"]'),
        }));
        matrix.push({
          ...observation,
          platform,
          view,
          session: "logged-out",
          status:
            observation.activation === "ready" &&
            observation.preview === "decoded" &&
            observation.native === "done"
              ? "image pipeline verified"
              : "unverified",
          reason: details.login
            ? "Login required"
            : `Loaded view: ${details.images} readable displayed images; modal=${details.modal}. Per-stage observations recorded; native toolbar gesture and authenticated views remain unverified.`,
        });
      } catch {
        matrix.push({
          platform,
          view,
          session: "logged-out",
          status: "blocked/unverified",
          reason: "Post/view navigation or scoped viewer controls unavailable",
        });
      }
    }
    await page.close();
    for (const view of [
      "feed/profile",
      "individual image",
      "carousel",
      "modal viewer",
    ])
      matrix.push({
        platform,
        view,
        session: "logged-in",
        status: "unverified",
        reason: "No user-provided authenticated browser session available",
      });
  }
  matrix.push({
    platform: "Instagram",
    view: "still-image Stories, opt-in enabled",
    session: "logged-in",
    status: "unverified",
    reason:
      "No authenticated opened Story tray available; deterministic opt-in/boundary fixtures tested separately",
  });
} finally {
  await writeFile(
    resolve(dir, "matrix.json"),
    JSON.stringify({ date: new Date().toISOString(), matrix }, null, 2),
  );
  await context.close();
}
console.log(JSON.stringify(matrix, null, 2));
