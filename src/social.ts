import type { MediaContext, SiteCapability } from "./shared";

type Adapter = {
  id: MediaContext["platform"];
  hosts: RegExp;
  post: RegExp;
  root: string;
};
export const socialAdapters: readonly Adapter[] = [
  {
    id: "instagram",
    hosts: /(^|\.)instagram\.com$/,
    post: /^\/(?:p|reel)\/([^/]+)/,
    root: 'article,[role="dialog"],main',
  },
  {
    id: "facebook",
    hosts: /(^|\.)(facebook\.com|fb\.com)$/,
    post: /(?:\/(?:posts|photos|videos)\/|[?&](?:fbid|story_fbid)=)([^/?&]+)/,
    root: '[role="article"],[role="dialog"],article,main',
  },
  {
    id: "x",
    hosts: /(^|\.)(x\.com|twitter\.com)$/,
    post: /\/status\/(\d+)/,
    root: 'article,[role="dialog"],main',
  },
  {
    id: "pinterest",
    hosts: /(^|\.)pinterest\.[a-z.]+$/,
    post: /\/pin\/(\d+)/,
    root: '[data-test-id="pin"],[data-test-id="pinWrapper"],[role="dialog"],article,main',
  },
];
export function adapterFor(url: string) {
  try {
    const host = new URL(url).hostname;
    return socialAdapters.find((a) => a.hosts.test(host));
  } catch {
    return undefined;
  }
}
export function socialDocumentKey(url: string) {
  const a = adapterFor(url);
  if (!a) return "";
  const u = new URL(url);
  if (a.id === "instagram" && /^\/stories\/[^/]+/.test(u.pathname))
    return `${a.id}:stories:${u.pathname.split("/")[2]}`;
  const post = (u.pathname + u.search).match(a.post);
  return post ? `${a.id}:post:${post[1]}` : "";
}
export function storyPosition(
  root: Element,
): { index: number; total: number } | undefined {
  const marker = root.querySelector("[aria-posinset][aria-setsize]");
  if (
    marker &&
    (marker.matches("img,video") || marker.querySelector("img,video"))
  ) {
    const index = Number(marker.getAttribute("aria-posinset")),
      total = Number(marker.getAttribute("aria-setsize"));
    if (index >= 1 && index <= total && total <= 1000) return { index, total };
  }
  const tabs = [...root.querySelectorAll('[role="tablist"] [role="tab"]')];
  if (
    !tabs.length ||
    !tabs.every((tab) => {
      const id = tab.getAttribute("aria-controls");
      const target = id && root.ownerDocument.getElementById(id);
      return (
        target && root.contains(target) && target.querySelector("img,video")
      );
    })
  )
    return;
  const index = tabs.findIndex(
    (t) => t.getAttribute("aria-selected") === "true",
  );
  if (index >= 0) return { index: index + 1, total: tabs.length };
}
const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.top < innerHeight &&
    getComputedStyle(el).visibility !== "hidden"
  );
};
export function socialRoot(doc: Document, url: string): Element | null {
  const adapter = adapterFor(url);
  if (!adapter) return null;
  const roots = [
    ...doc.querySelectorAll(
      '[role="dialog"],dialog[open],article,[role="article"],[data-test-id="pinWrapper"]',
    ),
  ].filter(visible);
  const modal = roots.find((r) => r.matches('[role="dialog"],dialog[open]'));
  return (
    (modal && (modal.querySelector('article,[role="article"]') || modal)) ||
    roots[0] ||
    doc.querySelector("main") ||
    doc.body
  );
}
export function navigationButton(
  root: Element,
  direction: "next" | "previous",
): HTMLElement | undefined {
  const words =
    direction === "next"
      ? /^(next|next photo|next image|next slide|next story|siguiente|suivant|weiter|avanti|próximo|التالي|اگلا)$/i
      : /^(previous|back|previous photo|previous image|previous slide|previous story|anterior|précédent|zurück|indietro|السابق|پچھلا)$/i;
  for (const marker of root.querySelectorAll(
    'button,[role="button"],[aria-label]',
  )) {
    const control = marker.closest<HTMLElement>('button,[role="button"]');
    if (
      !control ||
      !root.contains(control) ||
      control.matches(':disabled,[aria-disabled="true"]') ||
      !visible(control)
    )
      continue;
    if (
      words.test(
        (
          marker.getAttribute("aria-label") ||
          marker.getAttribute("title") ||
          marker.textContent ||
          ""
        ).trim(),
      )
    ) {
      // A viewer's outer "Next" can mean another post. Bare directional
      // controls are accepted only inside a post/carousel, or a verified tray.
      const postScope = root.matches(
        'article,[role="article"],[data-test-id="pinWrapper"],[aria-roledescription="carousel"]',
      );
      const explicitMedia =
        /photo|image|slide|story|foto|imagen|bild|صورة|شريحة/i.test(
          marker.getAttribute("aria-label") || "",
        );
      if (!postScope && !explicitMedia && !storyPosition(root)) continue;
      return control;
    }
  }
}
export function siteCapability(doc: Document, url: string): SiteCapability {
  const a = adapterFor(url);
  if (!a) return { platform: "generic", page: "feed", targets: ["feed"] };
  const u = new URL(url),
    root = socialRoot(doc, url);
  const blocked =
    /\/(accounts\/login|challenge|checkpoint|login)(\/|$)/.test(u.pathname) ||
    !!doc.querySelector('form input[type="password"]');
  const stories = a.id === "instagram" && /^\/stories\//.test(u.pathname);
  const carousel =
    !!root &&
    root.matches(
      'article,[role="article"],[role="dialog"],dialog[open],[data-test-id="pinWrapper"],[aria-roledescription="carousel"]',
    ) &&
    !!navigationButton(root, "next");
  return {
    platform: a.id,
    page: blocked
      ? "blocked"
      : stories
        ? "stories"
        : carousel
          ? "carousel"
          : doc.querySelector('[role="dialog"],dialog[open]')
            ? "viewer"
            : a.post.test(u.pathname + u.search)
              ? "post"
              : /^\/$/.test(u.pathname)
                ? "feed"
                : "profile",
    targets: blocked
      ? []
      : stories
        ? ["stories"]
        : carousel
          ? ["feed", "carousel"]
          : ["feed"],
  };
}
export function mediaContext(
  el: Element,
  url: string,
): MediaContext | undefined {
  const a = adapterFor(url);
  if (!a) return;
  const root = el.closest(a.root);
  const links = root
    ? [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]
    : [];
  let contentId = "";
  for (const href of [
    el.closest<HTMLAnchorElement>("a[href]")?.href,
    ...links.map((l) => l.href),
    url,
  ]) {
    if (!href) continue;
    try {
      const u = new URL(href, url);
      if (!a.hosts.test(u.hostname)) continue;
      const m = (u.pathname + u.search).match(a.post);
      if (m) {
        contentId = m[1];
        break;
      }
    } catch {}
  }
  const stories =
    a.id === "instagram" && /^\/stories\//.test(new URL(url).pathname);
  const avatar =
    /avatar|profile.{0,12}(picture|photo)|صورة الملف/i.test(
      el.getAttribute("alt") || "",
    ) || !!el.closest('header,nav,[role="navigation"]');
  const position = el.closest("[aria-posinset],[data-media-id]");
  const slideId =
    el.getAttribute("data-media-id") ||
    position?.getAttribute("data-media-id") ||
    position?.getAttribute("aria-posinset") ||
    "";
  if (stories) contentId = new URL(url).pathname.replace(/\/$/, "");
  return {
    platform: a.id,
    contentId,
    slideId,
    kind: avatar ? "avatar" : stories ? "story" : "photo",
  };
}
export function socialFeed(doc: Document, url: string): Element[] {
  const root = socialRoot(doc, url);
  if (!adapterFor(url) || !root) return [];
  const start =
    root.closest('[role="feed"]') ||
    doc.querySelector('[role="feed"],main') ||
    root;
  for (let el: Element | null = start; el; el = el.parentElement) {
    if (
      el !== doc.scrollingElement &&
      el.clientHeight > 150 &&
      el.scrollHeight > el.clientHeight + 100 &&
      /auto|scroll/.test(getComputedStyle(el).overflowY)
    )
      return [el];
  }
  return [];
}

export function validMedia(value: unknown): value is MediaContext {
  const v = value as MediaContext | undefined;
  return (
    !!v &&
    socialAdapters.some((a) => a.id === v.platform) &&
    ["photo", "avatar", "story"].includes(v.kind) &&
    [v.contentId, v.slideId].every(
      (s) => typeof s === "string" && s.length <= 300,
    )
  );
}
