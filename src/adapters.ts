import { absolute, variant, type Variant } from "./shared";
const imageLink = /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;
export function adapterVariants(el: Element, base: string): Variant[] {
  const found: Variant[] = [];
  const add = (s: unknown, method: string, w = 0, h = 0) => {
    if (typeof s !== "string") return;
    const u = absolute(s, base);
    if (u) found.push(variant(u, method, w, h));
  };
  const a = el.closest("a");
  if (a) {
    const href = a.getAttribute("href");
    if (href && imageLink.test(href)) add(href, "linked original");
    try {
      const u = new URL(href || "", base);
      if (/(^|\.)google\./.test(u.hostname))
        add(u.searchParams.get("imgurl"), "Google Images");
    } catch {}
    if (a.hasAttribute("m"))
      try {
        const m = JSON.parse(a.getAttribute("m")!);
        add(m.murl, "Bing Images", m.w || 0, m.h || 0);
      } catch {}
  }
  for (const key of [
    "data-orig-file",
    "data-large-file",
    "data-full",
    "data-original",
    "data-pin-media",
    "data-zoom-image",
    "data-src-original",
  ])
    add(el.getAttribute(key), key);
  // Only transform well-known CDN paths; never strip arbitrary signatures or query strings.
  if (el instanceof HTMLImageElement) {
    try {
      const u = new URL(el.currentSrc || el.src, base);
      if (
        u.hostname.endsWith(".pinimg.com") &&
        /^\/(\d+x|\d+x\d+(_RS)?)\//.test(u.pathname)
      ) {
        u.pathname = u.pathname.replace(/^\/[^/]+\//, "/originals/");
        add(u.href, "Pinterest original");
      }
      if (/(^|\.)cdn\.shopify\.com$/.test(u.hostname)) {
        const full = new URL(u);
        const w = Number(full.searchParams.get("width"));
        if (w && !full.searchParams.has("signature")) {
          full.searchParams.delete("width");
          add(full.href, "Shopify original");
        }
      }
    } catch {}
    // Instagram exposes responsive candidates in srcset; keep signed URLs unchanged.
    if (/(^|\.)instagram\.com$/.test(new URL(base).hostname))
      for (const s of el.closest("picture")?.querySelectorAll("source") || [])
        for (const v of parseSrcset(s.getAttribute("srcset") || "", base))
          found.push({ ...v, method: "Instagram responsive" });
  }
  return found;
}
export function parseSrcset(raw: string, base: string): Variant[] {
  const result: Variant[] = [];
  // Commas inside a URL (notably data URLs and signed CDN URLs) are not separators.
  // A trailing comma ends a descriptorless candidate, as in the HTML parsing algorithm.
  let offset = 0;
  while (offset < raw.length) {
    while (/[\s,]/.test(raw[offset] || "") && offset < raw.length) offset++;
    const start = offset;
    while (offset < raw.length && !/\s/.test(raw[offset])) offset++;
    let url = raw.slice(start, offset);
    if (!url) break;
    let descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const startDescriptor = offset;
      while (offset < raw.length && raw[offset] !== ",") offset++;
      descriptor = raw.slice(startDescriptor, offset).trim();
      if (raw[offset] === ",") offset++;
    }
    const width = descriptor.match(/^([1-9]\d*)w$/);
    const density = descriptor.match(/^(\d+(?:\.\d+)?|\.\d+)x$/);
    if (descriptor && !width && !(density && Number(density[1]) > 0)) continue;
    const u = absolute(url, base);
    if (u) result.push(variant(u, "srcset", width ? Number(width[1]) : 0));
  }
  return result;
}
