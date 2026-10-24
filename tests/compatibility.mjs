import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
// Public pages only. This is a live, automated smoke matrix, not a guarantee for every route or account.
const targets = [
  [
    "Image search",
    "Google Images",
    "https://www.google.com/search?tbm=isch&q=mountains",
  ],
  [
    "Image search",
    "Bing Images",
    "https://www.bing.com/images/search?q=mountains",
  ],
  [
    "Social galleries",
    "Pinterest",
    "https://www.pinterest.com/search/pins/?q=mountains",
  ],
  ["Social galleries", "Instagram", "https://www.instagram.com/nasa/"],
  ["Commerce", "Shopify store", "https://www.allbirds.com/"],
  ["Commerce", "IKEA", "https://www.ikea.com/us/en/"],
  ["Commerce", "Amazon", "https://www.amazon.com/"],
  ["Publishing", "WordPress", "https://wordpress.org/news/"],
  ["Publishing", "Smashing Magazine", "https://www.smashingmagazine.com/"],
  ["Publishing", "The Guardian", "https://www.theguardian.com/international"],
  ["Photography", "Unsplash", "https://unsplash.com/s/photos/mountains"],
  ["Photography", "Pexels", "https://www.pexels.com/search/mountains/"],
  [
    "Photography",
    "Wikimedia Commons",
    "https://commons.wikimedia.org/wiki/Main_Page",
  ],
  ["Science and education", "NASA", "https://www.nasa.gov/"],
  [
    "Science and education",
    "Wikipedia",
    "https://en.wikipedia.org/wiki/Mountain",
  ],
  ["Science and education", "Smithsonian", "https://www.si.edu/"],
  ["Design portfolios", "Behance", "https://www.behance.net/"],
  ["Design portfolios", "Dribbble", "https://dribbble.com/"],
  ["Documentation and software", "MDN", "https://developer.mozilla.org/en-US/"],
  ["Documentation and software", "GitHub", "https://github.com/"],
];
const dir = resolve("test-results/compatibility");
await mkdir(dir, { recursive: true });
let ctx;
const results = [];
try {
  ctx = await chromium.launchPersistentContext(
    await mkdtemp(resolve("test-results/compat-profile-")),
    {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 850 },
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        `--disable-extensions-except=${resolve("dist")}`,
        `--load-extension=${resolve("dist")}`,
      ],
    },
  );
  const worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  const control = await ctx.newPage();
  await control.goto(`chrome-extension://${id}/options.html`);
  for (let n = 0; n < targets.length; n += 3) {
    await Promise.all(
      targets.slice(n, n + 3).map(async ([category, name, url], offset) => {
        const index = n + offset;
        const p = await ctx.newPage();
        const row = {
          category,
          name,
          url,
          status: "unverified",
          images: 0,
          anchored: 0,
          fetch: "not tested",
          note: "",
          screenshot: `${String(index + 1).padStart(2, "0")}.png`,
        };
        try {
          const response = await p.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          });
          await p.waitForTimeout(4000);
          const tabId = await worker.evaluate(
            async (u) =>
              (await chrome.tabs.query({})).find((t) => t.url === u)?.id,
            p.url(),
          );
          let s = await control.evaluate(
            async (tabId) =>
              chrome.runtime.sendMessage({ type: "SNAPSHOT", tabId }),
            tabId,
          );
          if (s.error) throw Error(s.error);
          for (let attempt = 0; !s.records.length && attempt < 10; attempt++) {
            await p.waitForTimeout(1000);
            s = await control.evaluate(
              async (tabId) =>
                chrome.runtime.sendMessage({ type: "SNAPSHOT", tabId }),
              tabId,
            );
          }
          row.images = s.records.length;
          row.accepted = s.records.filter(
            (r) => r.eligibility?.state === "accepted",
          ).length;
          row.excluded = s.records.filter(
            (r) => r.eligibility?.state === "excluded",
          ).length;
          row.pending = s.records.filter(
            (r) => r.eligibility?.state === "pending",
          ).length;
          row.anchored = s.records.filter((r) => r.anchored).length;
          const title = await p.title();
          const body = (
            await p.locator("body").innerText({ timeout: 3000 })
          ).slice(0, 4000);
          row.note = `HTTP ${response?.status() || "unknown"}; ${title}`;
          if ((response?.status() || 0) >= 400)
            row.status = `HTTP ${response.status()} blocked/rate-limited`;
          else if (
            /captcha|verify you are human|access denied|just a moment|robot check|automated queries/i.test(
              title + " " + body.slice(0, 1000),
            )
          )
            row.status = "blocked/challenge";
          else if (/log in|sign up/i.test(body.slice(0, 500)) && !row.images)
            row.status =
              "no images detected (sign-in text present; wall unconfirmed)";
          else
            row.status = row.images ? "detection passed" : "no images detected";
          const r = s.records.find(
            (r) =>
              r.eligibility?.state === "accepted" &&
              r.variants.some((v) => v.url.startsWith("https:")),
          );
          if (r) {
            row.fetch = await worker.evaluate(
              async (url) => {
                try {
                  const r = await fetch(url, {
                    credentials: "include",
                    signal: AbortSignal.timeout(12000),
                  });
                  const type = r.headers.get("Content-Type") || "unknown";
                  await r.body?.cancel();
                  return `${r.status} ${type}`;
                } catch (e) {
                  return String(e);
                }
              },
              r.variants.find((v) => v.url.startsWith("https:")).url,
            );
          }
          await p.screenshot({
            path: resolve(dir, row.screenshot),
            timeout: 7000,
          });
        } catch (e) {
          row.status = "navigation/network blocked";
          row.note = String(e);
        } finally {
          results.push(row);
          console.log(row.name, row.status, row.images, row.fetch);
          await writeFile(
            resolve(dir, "results.json"),
            JSON.stringify(results, null, 2),
          );
          await p.close();
        }
      }),
    );
  }
} finally {
  await ctx?.close();
  const lines = [
    "# Live website compatibility smoke test",
    "",
    "Run: " + new Date().toISOString(),
    "",
    "Automated Chromium extension tests on public pages. Counts are initial discovery after a short settle, before full-page scan. Fetch checks stop after response headers; they do not prove complete download or conversion. Login walls and anti-bot responses are recorded as blocked, never passed. Manual account-specific social-feed verification remains pending.",
    "",
    "Default policy: JPEG/PNG with Smart cleanup. Useful/excluded/pending counts are recorded separately. An excluded image is a filtering outcome, not a browser failure.",
    "",
    "| Category | Website | Detection | Candidates / useful / excluded / pending | Sample fetch | Notes |",
    "|---|---|---|---:|---|---|",
    ...results.map(
      (r) =>
        `| ${r.category} | [${r.name}](${r.url}) | ${r.status} | ${r.images} / ${r.accepted || 0} / ${r.excluded || 0} / ${r.pending || 0} | ${r.fetch.replaceAll("|", "/")} | ${r.note.replaceAll("|", "/").replaceAll("\n", " ").slice(0, 250)} |`,
    ),
  ];
  await writeFile("COMPATIBILITY.md", lines.join("\n") + "\n");
}
