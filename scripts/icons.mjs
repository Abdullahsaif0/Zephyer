import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { iconSVG } from "../src/icons.ts";
const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="glass" x2="1" y2="1"><stop stop-color="#35423f"/><stop offset="1" stop-color="#131719"/></linearGradient></defs><rect x="4" y="4" width="120" height="120" rx="30" fill="url(#glass)" stroke="#819b902e" stroke-width="2"/><path d="M32 6h64" stroke="#d8f5e959" stroke-linecap="round"/><g color="#bbf2d6">${iconSVG("brand").replace('width="20" height="20"', 'x="30" y="30" width="68" height="68"')}</g></svg>`;
await writeFile("public/icons/mark.svg", mark);
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${mark}`,
    );
    await page.screenshot({
      path: `public/icons/${size}.png`,
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
