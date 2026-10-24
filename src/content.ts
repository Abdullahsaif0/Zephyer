import { pagePower } from "./power";
import {
  absolute,
  boundedBlob,
  defaults,
  hash,
  idleScan,
  mergeVariants,
  MAX_INLINE_URL,
  rpc,
  safeUrl,
  variant,
  type ImageRecord,
  type ScanSession,
  type Settings,
  type PagePowerState,
  type Variant,
  defaultOutput,
} from "./shared";
import { adapterVariants, parseSrcset } from "./adapters";
import { Dock } from "./dock";
import { applyTheme, tokensCSS } from "./appearance";
import { iconElement } from "./icons";
import { eligibility, allowedVariants, normalizedFormat } from "./discovery";
import overlayCSS from "./overlay.css?inline";

import { Lifecycle } from "./lifecycle";
import {
  siteCapability,
  mediaContext,
  socialRoot,
  navigationButton,
  socialFeed,
  socialDocumentKey,
  storyPosition,
} from "./social";
const instanceKey = "__zephyerInstance";
const previous = (globalThis as any)[instanceKey];
let currentAlive = false;
try {
  currentAlive = !!previous?.alive();
} catch {}
if (!currentAlive) {
  window.dispatchEvent(new Event("zephyer:dispose"));
  startContent();
}
function startContent() {
  const lifecycle = new Lifecycle();
  const listen = lifecycle.listen.bind(lifecycle);
  const setTimeout = lifecycle.timeout.bind(lifecycle);
  const setInterval = lifecycle.interval.bind(lifecycle);
  let disposed = false;
  let initialized = false;
  (globalThis as any)[instanceKey] = {
    alive: () => !disposed && !!chrome.runtime.id,
  };
  let collectionScope = "";
  let prefix = "",
    active = false,
    settings: Settings = { ...defaults },
    mode = false,
    selected = new Set<string>(),
    total = 0;
  let power = pagePower(defaults, location.href, 0, false);
  let collecting = false;
  let traversals = 0;
  let faviconUrls = new Set<string>();
  let runGeneration = 0,
    powerBusy = false;
  let helloGeneration = 0,
    helloTimer = 0;
  const stalePowerEpochs = new Set<string>();
  const blobControllers = new Set<AbortController>();
  function applyRuntime(
    nextSettings: Settings,
    next: PagePowerState,
    force = false,
  ) {
    if (
      stalePowerEpochs.has(next.epoch) ||
      (next.epoch === power.epoch && next.revision < power.revision)
    )
      return;
    const epochChanged = next.epoch !== power.epoch;
    if (epochChanged && power.epoch) stalePowerEpochs.add(power.epoch);
    const scopeChanged =
      !!next.collectionId && next.collectionId !== collectionScope;
    if (scopeChanged) {
      collectionScope = next.collectionId!;
      records.clear();
      published.clear();
      elements.clear();
      dirty.clear();
      localVerified.clear();
      included.clear();
      selected.clear();
      signatures = new WeakMap();
    }
    const wasActive = active,
      wasCollecting = collecting;
    settings = nextSettings;
    power = next;
    active = next.effectiveEnabled;
    collecting = next.collecting && !!prefix && !!next.collectionId;
    if (
      force ||
      scopeChanged ||
      wasActive !== active ||
      wasCollecting !== collecting ||
      epochChanged
    ) {
      runGeneration++;
      for (const observer of roots.values()) observer.disconnect();
      roots.clear();
      pending.clear();
      dirty.clear();
      blobQueue.length = 0;
      for (const controller of blobControllers) controller.abort();
      for (const [url, format] of localVerified)
        if (format === "unknown") localVerified.delete(url);
      clearTimeout(flushTimer);
      flushTimer = 0;
      signatures = new WeakMap();
      if (!active || force || epochChanged || scopeChanged) {
        hover = null;
        elements.clear();
        for (const entry of boxes.values()) entry.root.remove();
        boxes.clear();
        tools.hidden = true;
      }
      shadow
        .querySelectorAll(".z-discovery-flash")
        .forEach((el) => el.remove());
      if (collecting) {
        root(document);
        resources();
      }
    }
    if (!active) {
      mode = false;
      scanPause = true;
      if (scan.state === "running") {
        scan.state = "paused";
        scan.phase = "paused";
        scan.reason = "Website detection is off · turn on, then Resume";
        progress();
      }
    }
    redraw();
  }
  async function togglePower() {
    if (powerBusy) return;
    if (!power.globalEnabled) {
      void send({ type: "OPEN_OPTIONS" });
      return;
    }
    powerBusy = true;
    updateDock();
    try {
      const result = await rpc<{ settings: Settings; power: PagePowerState }>({
        type: "SITE_POWER",
        enabled: !power.siteEnabled,
      });
      applyRuntime(result.settings, result.power);
    } catch (e) {
      error(e, () => void togglePower());
    } finally {
      powerBusy = false;
      updateDock();
    }
  }
  let collected = 0;
  let included = new Set<string>();
  const localVerified = new Map<string, string>();
  const blobQueue: string[] = [];
  let blobActive = 0;
  function verifyBlob(url: string) {
    if (localVerified.has(url)) return;
    localVerified.set(url, "unknown");
    blobQueue.push(url);
    drainBlobs();
  }
  function drainBlobs() {
    while (collecting && blobActive < 2 && blobQueue.length) {
      const url = blobQueue.shift()!;
      const generation = runGeneration,
        controller = new AbortController();
      blobControllers.add(controller);
      blobActive++;
      void fetch(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })
        .then(async (response) => {
          const format = normalizedFormat(
            response.headers.get("content-type") || "unknown",
          );
          await response.body?.cancel();
          if (!collecting || generation !== runGeneration) return;
          localVerified.set(url, format);
          for (const r of records.values())
            if (r.variants.some((v) => v.url === url)) {
              for (const v of r.variants)
                if (v.url === url) {
                  v.format = format;
                  if (!v.method.includes("verified MIME"))
                    v.method += " · verified MIME";
                }
              dirty.set(r.id, r);
            }
          if (!flushTimer) flushTimer = setTimeout(flush, 50);
        })
        .catch(() => {})
        .finally(() => {
          blobControllers.delete(controller);
          blobActive--;
          drainBlobs();
        });
    }
  }
  function accepted(id: string) {
    const r = records.get(id);
    return (
      !!r &&
      eligibility({ ...r, userIncluded: included.has(id) }, settings).state ===
        "accepted"
    );
  }
  let pageScan: ScanSession = { ...idleScan };
  let runningScanToken: number | undefined;
  let scan: ScanSession = { ...idleScan },
    scanToken = 0,
    scanPause = false,
    scanStop = false;
  const records = new Map<string, ImageRecord>(),
    elements = new Map<Element, string>();
  const published = new Map<string, string>();
  const recordFingerprint = (r: ImageRecord) =>
    JSON.stringify([
      r.name,
      r.source,
      r.status,
      r.displayed,
      r.width,
      r.height,
      r.variants,
      r.signals,
      r.media,
    ]);
  let signatures = new WeakMap<Element, string>();
  const roots = new Map<Document | ShadowRoot, MutationObserver>(),
    pending = new Set<Element>(),
    dirty = new Map<string, ImageRecord>();
  let scheduled = false,
    flushTimer = 0,
    hover: Element | null = null,
    pointerTarget: Element | null = null,
    renderPending = false;
  const host = document.createElement("zephyer-tools");
  document.querySelectorAll("zephyer-tools").forEach((el) => el.remove());
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = overlayCSS + tokensCSS;
  shadow.append(style);
  const layer = document.createElement("div"),
    toolbar = document.createElement("div"),
    tools = document.createElement("div");
  shadow.append(layer, tools, toolbar);
  let pressedControl: Element | null = null;
  shadow.addEventListener(
    "pointerdown",
    (e) => {
      pressedControl =
        e.target instanceof Element ? e.target.closest("button") : null;
    },
    true,
  );
  shadow.addEventListener(
    "pointercancel",
    () => {
      pressedControl = null;
    },
    true,
  );
  const boxes = new Map<
    Element,
    {
      id: string;
      mode: boolean;
      inlineDownload: boolean;
      root: HTMLDivElement;
      check: HTMLButtonElement;
    }
  >();
  function button(label: string, fn: () => void, title = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    return b;
  }
  function downloadButton(label: string, fn: () => void) {
    const b = button(label, fn);
    b.addEventListener(
      "click",
      (e) => {
        if (e.detail > 0 && pressedControl !== b) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    return b;
  }
  function error(e: unknown, retry?: () => void) {
    const node = document.createElement("div");
    node.className = "error";
    node.textContent = e instanceof Error ? e.message : String(e);
    if (retry) node.append(button("Retry", retry));
    shadow.append(node);
    setTimeout(() => node.remove(), 6000);
  }
  const send = (m: any) => rpc(m).catch(error);
  const dock =
    window === window.top
      ? new Dock(toolbar, {
          traverse: (target) => {
            if (
              target === "stories" &&
              !window.confirm(
                "Advancing Stories can change Instagram's viewed status. Scan only this opened Story tray, up to 50 items?",
              )
            )
              return;
            void send({
              type: "SCAN",
              command: "start",
              target,
              storyConsent: target === "stories",
            });
          },
          power: () => void togglePower(),
          gallery: () => send({ type: "OPEN_GALLERY" }),
          scanNow: () => send({ type: "SCAN_NOW" }),
          automatic: () =>
            send({
              type: "AUTO_COLLECTION",
              enabled: !settings.automaticCollection,
            }),
          select: () => send({ type: "MODE", value: !mode }),
          scan: () =>
            send({
              type: "SCAN",
              command:
                pageScan.state === "running"
                  ? "pause"
                  : pageScan.state === "paused"
                    ? "resume"
                    : "start",
            }),
          download: () =>
            send({
              type: "DOWNLOAD",
              ids: [...selected],
              output: defaultOutput,
            }),
          zip: () =>
            send({
              type: "DOWNLOAD",
              ids: [...selected],
              output: { ...defaultOutput, zip: true },
            }),
          library: () => send({ type: "OPEN" }),
          stop: () => send({ type: "SCAN", command: "stop" }),
          all: () => send({ type: "SELECT", ids: ["*"], value: true }),
          clear: () => send({ type: "SELECT", ids: ["*"], value: false }),
          preferences: () => send({ type: "OPEN_OPTIONS" }),
          save: (layout) => send({ type: "DOCK_SAVE", layout }),
          reset: () => send({ type: "DOCK_RESET" }),
        })
      : undefined;
  if (!dock) toolbar.hidden = true;
  let appliedTheme = "";
  function updateDock() {
    dock?.update({
      capability: siteCapability(document, location.href),
      count: total,
      selected: selected.size,
      mode,
      scan: pageScan,
      settings,
      power,
      powerBusy,
    });
    if (appliedTheme !== settings.theme) {
      applyTheme(host, settings.theme);
      appliedTheme = settings.theme;
    }
  }
  async function loadDock() {
    updateDock();
    if (dock) {
      try {
        const result = await rpc<{
          layout: import("./shared").DockLayout | null;
        }>({
          type: "DOCK_GET",
        });
        dock.setLayout(result.layout);
      } catch (error) {
        dock.setLayout(null);
        throw error;
      }
    }
  }
  function mappingMatches(el: Element, id: string) {
    if (!el.isConnected) return false;
    if (!(el instanceof HTMLImageElement)) return true;
    const current = absolute(el.currentSrc || el.src, document.baseURI);
    return !!records.get(id)?.variants.some((v) => v.url === current);
  }
  function selectMapped(el: Element, id: string) {
    if (mappingMatches(el, id)) send({ type: "SELECT", ids: [id] });
    else {
      redraw();
      error("This image changed · Scan now to update page controls");
    }
  }
  function downloadMapped(
    el: Element,
    id: string,
    output: import("./shared").Output,
  ) {
    if (mappingMatches(el, id)) send({ type: "DOWNLOAD", ids: [id], output });
    else {
      redraw();
      error("This image changed · Scan now to update page controls");
    }
  }
  function frameVisible(el: Element) {
    const r = el.getBoundingClientRect();
    return (
      r.width >= 12 &&
      r.height >= 12 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    );
  }
  function mount() {
    const parent =
      document.querySelector("dialog:modal") || document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    if (window === window.top && typeof host.showPopover === "function") {
      host.setAttribute("popover", "manual");
      try {
        if (!host.matches(":popover-open")) host.showPopover();
      } catch {}
    }
  }
  function draw() {
    renderPending = false;
    if (!power.activated) {
      host.remove();
      return;
    }
    mount();
    host.style.setProperty("display", "block", "important");
    host.dataset.disabled = String(!active);
    updateDock();
    if (!active) return;
    if (!mode && !hover && pointerTarget?.isConnected) {
      let el: Element | null = pointerTarget;
      while (el && !elements.has(el)) el = el.parentElement;
      hover = el;
    }
    const visible = new Set<Element>();
    let n = 0;
    for (const [el, id] of elements) {
      if (!el.isConnected) {
        elements.delete(el);
        continue;
      }
      if (
        !(mode || settings.alwaysVisible) ||
        !accepted(id) ||
        !frameVisible(el)
      )
        continue;
      if (!mappingMatches(el, id)) continue;
      if (++n > 200) break;
      const r = el.getBoundingClientRect();
      const inlineDownload =
        settings.alwaysVisible && !mode && r.width >= 84 && r.height >= 40;
      let entry = boxes.get(el);
      if (
        entry &&
        (entry.id !== id ||
          entry.mode !== mode ||
          entry.inlineDownload !== inlineDownload)
      ) {
        entry.root.remove();
        boxes.delete(el);
        entry = undefined;
      }
      if (!entry) {
        const box = document.createElement("div");
        box.dataset.imageId = id;
        const check = button("Select image", () => selectMapped(el, id));
        check.className = "check";
        if (mode) {
          const surface = button("Select image", () => selectMapped(el, id));
          surface.className = "z-select-surface";
          surface.textContent = "";
          surface.dataset.imageId = id;
          box.append(surface);
          check.tabIndex = -1;
          check.setAttribute("aria-hidden", "true");
          check.style.pointerEvents = "none";
        }
        box.append(check);
        if (inlineDownload) {
          const download = downloadButton("Download image", () =>
            downloadMapped(el, id, defaultOutput),
          );
          download.setAttribute("aria-label", "Download image");
          download.className = "z-inline-download";
          download.replaceChildren(iconElement("download"));
          box.append(download);
        }
        entry = { id, mode, inlineDownload, root: box, check };
        boxes.set(el, entry);
        layer.append(box);
      }
      visible.add(el);
      const { root: box, check } = entry;
      box.className = `box${selected.has(id) ? " selected" : ""}`;
      Object.assign(box.style, {
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
      check.setAttribute(
        "aria-label",
        selected.has(id) ? "Deselect image" : "Select image",
      );
      const pressed = String(selected.has(id));
      if (check.dataset.selected !== pressed) {
        check.dataset.selected = pressed;
        check.replaceChildren(
          iconElement(selected.has(id) ? "check" : "select"),
        );
      }
      const surface = box.querySelector<HTMLButtonElement>(".z-select-surface");
      surface?.setAttribute("aria-pressed", pressed);
      surface?.setAttribute(
        "aria-label",
        selected.has(id) ? "Deselect image" : "Select image",
      );
    }
    for (const [el, entry] of boxes)
      if (!visible.has(el)) {
        entry.root.remove();
        boxes.delete(el);
      }
    let showingTools = false;
    if (
      !mode &&
      hover &&
      hover.isConnected &&
      elements.has(hover) &&
      mappingMatches(hover, elements.get(hover)!) &&
      accepted(elements.get(hover)!) &&
      frameVisible(hover)
    ) {
      const id = elements.get(hover)!;
      const rec = records.get(id);
      if (rec) {
        const r = hover.getBoundingClientRect();
        tools.className = "tools";
        showingTools = true;
        tools.hidden = false;
        Object.assign(tools.style, {
          left: Math.max(4, Math.min(innerWidth - 300, r.left + 5)) + "px",
          top: Math.max(4, r.top + 5) + "px",
        });
        if (tools.dataset.key !== id) {
          const sourceElement = hover;
          tools.dataset.key = id;
          tools.dataset.version = "";
          tools.replaceChildren();
          const quality = document.createElement("select");
          quality.title = "Download quality";
          quality.setAttribute("aria-label", "Download quality");
          quality.addEventListener("blur", redraw);
          const download = downloadButton("Download", () =>
            downloadMapped(sourceElement, id, {
              ...defaultOutput,
              quality: quality.value,
            }),
          );
          download.prepend(iconElement("download"));
          const select = button("Select", () =>
            selectMapped(sourceElement, id),
          );
          tools.append(download, quality, select);
        }
        const quality = tools.querySelector("select")!;
        if (
          tools.dataset.version !== String(rec.updated) &&
          shadow.activeElement !== quality
        ) {
          const value = quality.value;
          quality.replaceChildren();
          for (const [url, label] of [
            ["best", "Best available"],
            ["displayed", "Displayed version"],
            ...allowedVariants(rec, settings).map((v) => [
              v.url,
              (v.width
                ? String(v.width) + (v.height ? "×" + v.height : "")
                : "Unknown size") +
                " · " +
                v.method,
            ]),
          ]) {
            const option = document.createElement("option");
            option.value = url;
            option.textContent = label;
            quality.append(option);
          }
          if ([...quality.options].some((o) => o.value === value))
            quality.value = value;
          tools.dataset.version = String(rec.updated);
        }
        const select = tools.querySelector("button:last-child")!;
        const pressed = String(selected.has(id));
        if (select.getAttribute("aria-pressed") !== pressed) {
          select.setAttribute("aria-pressed", pressed);
          select.textContent = selected.has(id) ? "Selected" : "Select";
          select.prepend(iconElement(selected.has(id) ? "check" : "select"));
        }
      }
    }
    if (!showingTools) tools.hidden = true;
  }
  function redraw() {
    if (!renderPending) {
      renderPending = true;
      requestAnimationFrame(draw);
    }
  }
  function queue(el: Element) {
    if (!collecting) return;
    if (host === el || host.contains(el)) return;
    pending.add(el);
    if (!scheduled) {
      scheduled = true;
      setTimeout(work, 0);
    }
  }
  function work() {
    scheduled = false;
    if (!collecting) return;
    const start = performance.now();
    while (pending.size && performance.now() - start < 9) {
      const el = pending.values().next().value!;
      pending.delete(el);
      inspect(el);
    }
    if (pending.size) {
      scheduled = true;
      setTimeout(work, 0);
    }
    if (dirty.size && !flushTimer) flushTimer = setTimeout(flush, 250);
    redraw();
  }
  async function flush() {
    flushTimer = 0;
    if (!prefix || !collecting) return;
    const generation = runGeneration;
    const batch: ImageRecord[] = [];
    let size = 0;
    for (const record of dirty.values()) {
      const weight =
        record.displayed.length +
        record.variants.reduce((n, v) => n + v.url.length + 300, 0) +
        1000;
      if (
        batch.length &&
        (batch.length >= 60 || size + weight > 20 * 1024 * 1024)
      )
        break;
      batch.push(record);
      size += weight;
    }
    batch.forEach((r) => dirty.delete(r.id));
    const sent = batch.map((r) => [r.id, recordFingerprint(r)] as const);
    if (batch.length)
      try {
        const accepted = await rpc({
          type: "DISCOVER",
          records: batch,
          revision: power.revision,
        });
        if (accepted && generation === runGeneration)
          for (const [id, fingerprint] of sent) published.set(id, fingerprint);
        if (!accepted && collecting && generation === runGeneration)
          for (const record of batch)
            if (!dirty.has(record.id)) dirty.set(record.id, record);
      } catch (e) {
        if (!collecting || generation !== runGeneration) return;
        for (const r of batch) if (!dirty.has(r.id)) dirty.set(r.id, r);
        error(e);
        if (!flushTimer) flushTimer = setTimeout(flush, 2000);
        return;
      }
    if (dirty.size && !flushTimer) flushTimer = setTimeout(flush, 100);
  }
  function root(root: Document | ShadowRoot) {
    if (!collecting || roots.has(root)) return;
    const observer = new MutationObserver((ms) => {
      if (!collecting) return;
      for (const m of ms) {
        if (m.type === "attributes") {
          queue(m.target as Element);
          if (m.target instanceof HTMLSourceElement)
            m.target.closest("picture")?.querySelectorAll("img").forEach(queue);
        }
        for (const node of m.addedNodes)
          if (node instanceof Element) {
            enqueueTree(node);
          }
      }
      if (ms.some((m) => m.removedNodes.length))
        for (const [observed, observer] of roots)
          if (observed instanceof ShadowRoot && !observed.host.isConnected) {
            observer.disconnect();
            roots.delete(observed);
          }
    });
    roots.set(root, observer);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "src",
        "srcset",
        "sizes",
        "href",
        "style",
        "class",
        "data-src",
        "data-srcset",
        "data-media-id",
        "aria-posinset",
        "data-original",
        "data-lazy-src",
        "data-orig-file",
        "data-full",
        "data-zoom-image",
      ],
    });
    enqueueTree(root instanceof Document ? root.documentElement : root);
  }
  function enqueueTree(el: Element | ShadowRoot) {
    if (!collecting) return;
    const generation = runGeneration;
    // Prioritize explicit media before the much larger computed-background pass.
    for (const media of el.querySelectorAll(
      "img,canvas,svg,image,picture source",
    ))
      queue(media);
    if (el instanceof Element) queue(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node: Node | null;
    let chunk: Element[] = [];
    while ((node = walker.nextNode())) {
      chunk.push(node as Element);
      if (chunk.length >= 500) {
        const batch = chunk;
        traversals++;
        setTimeout(() => {
          traversals--;
          if (collecting && generation === runGeneration) batch.forEach(queue);
        }, 0);
        chunk = [];
      }
    }
    chunk.forEach(queue);
  }
  function urls(css: string) {
    return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
      .map((m) => absolute(m[1], document.baseURI))
      .filter(Boolean);
  }
  function addRecord(
    el: Element | null,
    vs: Variant[],
    source: string,
    name = "",
    status = "ready",
    identity = "",
  ) {
    for (const v of vs) {
      const known = localVerified.get(v.url);
      if (known && known !== "unknown") {
        v.format = known;
        if (!v.method.includes("verified MIME")) v.method += " · verified MIME";
      } else if (v.url.startsWith("blob:")) verifyBlob(v.url);
    }
    const oversized = vs.some((v) => v.url.length > MAX_INLINE_URL);
    let variantBytes = 0;
    vs = mergeVariants(
      [],
      vs.filter((v) => {
        if (!safeUrl(v.url) || variantBytes + v.url.length > MAX_INLINE_URL)
          return false;
        variantBytes += v.url.length;
        return true;
      }),
    );
    if (oversized && !vs.length)
      status = "unsupported: inline image exceeds 8 MB transfer limit";
    if (!vs.length && !status.startsWith("unsupported")) {
      if (el) elements.delete(el);
      return;
    }
    let displayed =
      el instanceof HTMLImageElement
        ? absolute(el.currentSrc || el.src, document.baseURI)
        : vs[0]?.url || "";
    if (!vs.some((v) => v.url === displayed)) displayed = vs[0]?.url || "";
    let media: import("./shared").MediaContext | undefined;
    try {
      if (el) media = mediaContext(el, location.href);
    } catch {}
    if (media?.kind === "story" && !settings.instagramStoriesEnabled) return;
    let seed =
      (media?.contentId && media.slideId
        ? `${media.platform}:${media.kind}:${media.contentId}:${media.slideId}`
        : "") ||
      identity ||
      (el instanceof HTMLImageElement
        ? el.getAttribute("data-src") ||
          el.getAttribute("data-original") ||
          el.getAttribute("data-lazy-src")
          ? absolute(
              el.getAttribute("data-src") ||
                el.getAttribute("data-original") ||
                el.getAttribute("data-lazy-src") ||
                "",
              document.baseURI,
            )
          : ""
        : "") ||
      vs.find((v) => v.method === "src")?.url ||
      displayed ||
      status;
    const id = prefix + collectionScope + ":" + hash(seed);
    if (el) {
      elements.set(el, id);
      const sig = JSON.stringify([
        id,
        vs,
        status,
        name,
        el.getAttribute("class"),
        !!el.closest(
          'nav,header,footer,button,[role="button"],[role="navigation"]',
        ),
        vs.some((v) => faviconUrls.has(v.url)),
      ]);
      if (signatures.get(el) === sig) return;
      signatures.set(el, sig);
    }
    const old = records.get(id);
    const current = vs.find((v) => v.url === displayed);
    const rec: ImageRecord = {
      media,
      id,
      tabId: 0,
      documentId: "",
      frameId: 0,
      pageUrl: location.href,
      source,
      name: name.slice(0, 200),
      variants: mergeVariants(old?.variants || [], vs),
      displayed,
      width: current?.width || old?.width || 0,
      height: current?.height || old?.height || 0,
      selected: false,
      signals: {
        favicon: vs.some((v) => faviconUrls.has(v.url)),
        emoji:
          !!el &&
          /emoji|emoticon|twemoji|emojione/i.test(
            `${name} ${el.className} ${vs
              .map((v) => {
                try {
                  return new URL(v.url).pathname;
                } catch {
                  return "";
                }
              })
              .join(" ")}`,
          ) &&
          (!!el.closest('button,nav,[role="button"],[role="navigation"]') ||
            (Math.max(current?.width || 0, current?.height || 0) > 0 &&
              Math.max(current?.width || 0, current?.height || 0) <= 192)),
        interfaceAsset:
          !!el &&
          /logo|brand|icon|badge|sprite|emoji/i.test(
            `${name} ${el.id} ${el.getAttribute("class") || ""}`,
          ) &&
          (!!el.closest(
            'nav,header,footer,button,[role="button"],[role="navigation"]',
          ) ||
            (Math.max(current?.width || 0, current?.height || 0) > 0 &&
              Math.max(current?.width || 0, current?.height || 0) <= 192)),
        avatar:
          media?.kind === "avatar" ||
          (!!el &&
            /avatar|profile[-_ ]?(picture|photo)|user[-_ ]?(picture|photo)/i.test(
              `${name} ${el.id} ${el.getAttribute("class") || ""}`,
            )),
      },
      status,
      anchored: !!el,
      updated: Date.now(),
    };
    if (old && published.get(id) === recordFingerprint(rec)) return;
    records.set(id, rec);
    dirty.set(id, rec);
    if (
      !old &&
      !document.hidden &&
      scan.state === "running" &&
      eligibility(rec, settings).state === "accepted" &&
      el &&
      frameVisible(el) &&
      shadow.querySelectorAll(".z-discovery-flash").length < 3
    ) {
      const r = el.getBoundingClientRect(),
        flash = document.createElement("div");
      flash.className = "z-discovery-flash";
      Object.assign(flash.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      shadow.append(flash);
      setTimeout(() => flash.remove(), 600);
    }
  }
  function inspect(el: Element) {
    if (!collecting || !el.isConnected || el === host) return;
    if (el instanceof HTMLSourceElement)
      el.closest("picture")?.querySelectorAll("img").forEach(queue);
    if (el.shadowRoot) root(el.shadowRoot);
    let vs: Variant[] = [];
    if (el instanceof HTMLImageElement) {
      const add = (
        s: string | null,
        method: string,
        w = 0,
        h = 0,
        verified = false,
      ) => {
        if (!s) return;
        const u = absolute(s, document.baseURI);
        if (u) vs.push(variant(u, method, w, h, verified));
      };
      add(el.getAttribute("src"), "src");
      add(
        el.currentSrc,
        "displayed",
        el.naturalWidth,
        el.naturalHeight,
        el.complete && !!el.naturalWidth,
      );
      for (const key of [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-lazy",
        "data-full",
      ])
        add(el.getAttribute(key), key);
      for (const key of ["srcset", "data-srcset"])
        vs.push(...parseSrcset(el.getAttribute(key) || "", document.baseURI));
      for (const s of el.closest("picture")?.querySelectorAll("source") || [])
        vs.push(
          ...parseSrcset(s.getAttribute("srcset") || "", document.baseURI),
        );
      let media;
      try {
        media = mediaContext(el, location.href);
        vs.push(...adapterVariants(el, location.href));
      } catch {
        /* Generic detection survives an adapter failure. */
      }
      if (media?.kind === "story" && !settings.instagramStoriesEnabled) return;
      if (media?.kind === "story" && !frameVisible(el)) return;
      addRecord(el, vs, "image", el.alt || el.title);
      return;
    }
    if (
      el instanceof HTMLAnchorElement &&
      /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(el.href) &&
      !el.querySelector("img")
    )
      addRecord(
        el,
        [variant(el.href, "linked image")],
        "link",
        el.textContent || "",
      );
    if (el instanceof SVGSVGElement && !el.closest("zephyer-tools")) {
      try {
        const clone = el.cloneNode(true) as SVGSVGElement;
        clone.setAttributeNS(
          "http://www.w3.org/2000/xmlns/",
          "xmlns",
          "http://www.w3.org/2000/svg",
        );
        const text = new XMLSerializer().serializeToString(clone);
        const r = el.viewBox.baseVal;
        addRecord(
          el,
          [
            variant(
              "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text),
              "inline SVG",
              r.width || el.clientWidth,
              r.height || el.clientHeight,
              true,
            ),
          ],
          "inline SVG",
          el.getAttribute("aria-label") || "",
          "ready",
          `svg:${hash(text)}`,
        );
      } catch {}
    }
    if (el instanceof SVGImageElement) {
      const u = absolute(el.href.baseVal, document.baseURI);
      if (u) addRecord(el, [variant(u, "SVG reference")], "SVG image");
    }
    if (el instanceof HTMLCanvasElement) {
      try {
        if (el.width && el.height && el.width * el.height <= 40_000_000) {
          const u = el.toDataURL("image/png");
          addRecord(
            el,
            [variant(u, "canvas", el.width, el.height, true)],
            "canvas",
            "Canvas",
          );
        } else if (el.width * el.height > 40_000_000) {
          addRecord(
            el,
            [],
            "canvas",
            "Large canvas",
            "unsupported: canvas exceeds 40 megapixels",
            `canvas:${el.id || [...document.querySelectorAll("canvas")].indexOf(el)}`,
          );
        }
      } catch {
        addRecord(
          el,
          [],
          "canvas",
          "Protected canvas",
          "unsupported: tainted canvas",
          `canvas:${el.id || [...document.querySelectorAll("canvas")].indexOf(el)}`,
        );
      }
      return;
    }
    if (
      ["SCRIPT", "STYLE", "LINK", "META", "SOURCE", "HEAD", "TITLE"].includes(
        el.tagName,
      )
    )
      return;
    try {
      for (const pseudo of [null, "::before", "::after"]) {
        const css = getComputedStyle(el, pseudo);
        for (const url of urls(css.backgroundImage))
          vs.push(variant(url, pseudo ? "pseudo-element" : "CSS background"));
      }
      if (vs.length)
        addRecord(el, vs, "background", el.getAttribute("aria-label") || "");
    } catch {}
  }
  function resources() {
    if (
      siteCapability(document, location.href).page === "stories" &&
      !settings.instagramStoriesEnabled
    )
      return;
    faviconUrls = new Set(
      [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel~="icon"],link[rel="apple-touch-icon"],link[rel="mask-icon"]',
        ),
      ].map((link) => link.href),
    );
    if (!collecting) return;
    if (faviconUrls.size)
      for (const record of records.values()) {
        if (
          !record.signals?.favicon &&
          record.variants.some((v) => faviconUrls.has(v.url))
        ) {
          record.signals = {
            interfaceAsset: false,
            avatar: false,
            ...record.signals,
            favicon: true,
          };
          dirty.set(record.id, record);
        }
      }
    for (const [root, observer] of roots)
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect();
        roots.delete(root);
      }
    const known = new Set(
      [...records.values()].flatMap((r) => r.variants.map((v) => v.url)),
    );
    for (const e of performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]) {
      if (
        e.initiatorType === "img" ||
        /\.(png|jpe?g|webp|avif|gif|svg)(?:[?#]|$)/i.test(e.name)
      )
        if (!known.has(e.name))
          addRecord(null, [variant(e.name, "resource timing")], "resource");
    }
    for (const meta of document.querySelectorAll(
      'meta[property="og:image"],meta[name="twitter:image"]',
    )) {
      const u = absolute(meta.getAttribute("content") || "", document.baseURI);
      if (u) addRecord(null, [variant(u, "page metadata")], "metadata");
    }
    if (dirty.size && !flushTimer) flushTimer = setTimeout(flush, 50);
  }
  listen(
    document,
    "load",
    (e) => {
      if (e.target instanceof HTMLImageElement) queue(e.target);
    },
    true,
  );
  listen(
    document,
    "pointerover",
    (e) => {
      if (e.composedPath().includes(host)) return;
      pointerTarget = e.target instanceof Element ? e.target : null;
      if (!active || mode) return;
      let el = e.target as Element | null;
      while (el && !elements.has(el)) el = el.parentElement;
      if (el !== hover) {
        hover = el;
        redraw();
      }
    },
    true,
  );
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "dragstart",
  ])
    listen(
      window,
      type,
      (e: Event) => {
        if (!active || !mode || e.composedPath().includes(host)) return;
        let el: Element | null =
          (e
            .composedPath()
            .find(
              (node) => node instanceof Element && elements.has(node),
            ) as Element) || (e.target instanceof Element ? e.target : null);
        while (el && !elements.has(el)) el = el.parentElement;
        if (
          el &&
          mappingMatches(el, elements.get(el)!) &&
          accepted(elements.get(el)!)
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === "click" && (e as MouseEvent).button === 0)
            send({ type: "SELECT", ids: [elements.get(el)!] });
        }
      },
      true,
    );
  listen(window, "scroll", redraw, true);
  listen(window, "resize", () => {
    for (const el of elements.keys()) queue(el);
    redraw();
  });
  listen(document, "keydown", (e) => {
    if (e.key === "Escape" && mode) send({ type: "MODE", value: false });
  });
  const sleep = (ms: number) =>
    new Promise<void>((r) => setTimeout(() => r(), ms));
  async function scrollContainers() {
    const result: Element[] = [];
    const generation = runGeneration;
    let tick = performance.now();
    for (const el of document.querySelectorAll("*")) {
      if (!active || scanPause || generation !== runGeneration) break;
      if (performance.now() - tick > 7) {
        await sleep(0);
        tick = performance.now();
      }
      if (
        el === host ||
        el === document.scrollingElement ||
        el.clientHeight < 150 ||
        el.scrollHeight <= el.clientHeight + 100
      )
        continue;
      if (/auto|scroll/.test(getComputedStyle(el).overflowY)) result.push(el);
      if (result.length >= 30) break;
    }
    return result;
  }
  let positions: { el: Element | null; x: number; y: number }[] = [];
  function progress() {
    scan.count = collected;
    send({ type: "SCAN_PROGRESS", scan: { ...scan } });
    redraw();
  }
  async function traverse(token: number) {
    const target = scan.target!;
    const initialURL = location.href;
    const root = socialRoot(document, location.href);
    if (!root) {
      scan.state = "stopped";
      scan.reason = "No supported media viewer is open";
      progress();
      return;
    }
    const signature = () =>
      [...root.querySelectorAll<HTMLImageElement>("img")]
        .filter(frameVisible)
        .filter((el) => mediaContext(el, location.href)?.kind !== "avatar")
        .map((el) => {
          const media = mediaContext(el, location.href);
          return `${media?.slideId || ""}:${el.currentSrc || el.src}`;
        })
        .join("|") ||
      (root.querySelector("video")
        ? `video:${root.querySelector<HTMLVideoElement>("video")?.currentSrc}`
        : "");
    const seen = new Set<string>();
    const start = signature();
    let moved = 0,
      elapsed = 0,
      last = Date.now();
    const alive = () => token === scanToken && !scanStop && active && !disposed;
    try {
      while (alive()) {
        if (scanPause) {
          last = Date.now();
          await sleep(100);
          continue;
        }
        elapsed += Date.now() - last;
        last = Date.now();
        if (
          !root.isConnected ||
          (location.href !== initialURL &&
            socialDocumentKey(location.href) !==
              socialDocumentKey(initialURL)) ||
          siteCapability(document, location.href).page === "blocked"
        ) {
          scan.reason = "Traversal stopped · viewer changed or access blocked";
          break;
        }
        if (mode) {
          scan.reason =
            "Traversal stopped · exit Select mode before restarting";
          break;
        }
        if (
          (settings.scanMinutes > 0 &&
            elapsed >= settings.scanMinutes * 60000) ||
          (settings.scanImages > 0 && collected >= settings.scanImages)
        ) {
          scanPause = true;
          scan.state = "paused";
          scan.phase = "paused";
          scan.reason = "Safety limit reached · Resume or Stop";
          progress();
          continue;
        }
        if (target === "stories" && !settings.instagramStoriesEnabled) {
          scan.reason = "Story collection was disabled";
          break;
        }
        const sig = signature();
        if (!sig || seen.has(sig)) {
          scan.reason = "Traversal stopped · no new media identity";
          break;
        }
        seen.add(sig);
        enqueueTree(root);
        await sleep(200);
        await flush();
        if (!alive()) break;
        if (root.querySelector("video")) scan.skipped = (scan.skipped || 0) + 1;
        scan.steps = seen.size;
        scan.reason = `${target === "stories" ? "Stories" : "Carousel"} · ${seen.size} items checked · ${scan.skipped || 0} video items skipped`;
        progress();
        if (seen.size >= 50) {
          scan.reason = "Traversal limit reached · 50 items checked";
          break;
        }
        if (target === "stories") {
          const position = storyPosition(root);
          if (!position) {
            scan.reason =
              "Traversal stopped · cannot verify this Story tray boundary; advance manually";
            break;
          }
          if (position.index >= position.total) {
            scan.reason = "Opened Story tray exhausted";
            scan.state = "complete";
            break;
          }
        }
        const next = navigationButton(root, "next");
        if (!next) {
          scan.reason = "Loaded viewer content exhausted";
          scan.state = "complete";
          break;
        }
        while (scanPause && alive()) {
          await sleep(100);
          last = Date.now();
        }
        if (!alive()) break;
        next.click();
        moved++;
        const deadline = Date.now() + 4000;
        while (
          alive() &&
          !scanPause &&
          signature() === sig &&
          Date.now() < deadline
        )
          await sleep(100);
        if (signature() === sig && !scanPause) {
          scan.reason = "Traversal stopped · next item did not load";
          break;
        }
      }
      if (scanStop)
        scan.reason = "Traversal stopped · collected photos retained";
      if (scan.state !== "complete") scan.state = "stopped";
      // Returning through a Story can affect viewed status again; only carousels
      // are restored, with bounded, observable previous navigation.
      if (
        target === "carousel" &&
        alive() &&
        root.isConnected &&
        location.href === initialURL
      ) {
        while (moved-- > 0 && signature() !== start && alive()) {
          const before = signature(),
            previous = navigationButton(root, "previous");
          if (!previous) break;
          previous.click();
          const deadline = Date.now() + 1000;
          while (alive() && signature() === before && Date.now() < deadline)
            await sleep(80);
          if (signature() === before) break;
        }
        if (signature() !== start)
          scan.reason += " · original slide could not be restored";
      }
    } catch {
      scan.state = "stopped";
      scan.reason = "Traversal interrupted · collected photos retained";
    }
    if (token === scanToken) {
      scan.phase = scan.state === "complete" ? "complete" : "stopped";
      progress();
    }
  }
  async function fullScan(token: number) {
    if (scan.target === "carousel" || scan.target === "stories")
      return traverse(token);
    let stable = 0,
      previous = "",
      elapsed = 0,
      last = Date.now();
    while (token === scanToken && !scanStop) {
      if (scanPause) {
        last = Date.now();
        await sleep(250);
        continue;
      }
      elapsed += Date.now() - last;
      last = Date.now();
      if (
        (settings.scanMinutes > 0 && elapsed >= settings.scanMinutes * 60000) ||
        (settings.scanImages > 0 && collected >= settings.scanImages)
      ) {
        scanPause = true;
        scan.state = "paused";
        scan.phase = "paused";
        scan.reason =
          "Safety limit reached · change limits in Preferences, then Resume";
        progress();
        continue;
      }
      const containers =
        socialFeed(document, location.href).length ||
        siteCapability(document, location.href).platform !== "generic"
          ? socialFeed(document, location.href)
          : await scrollContainers();
      if (token !== scanToken || scanStop) break;
      if (!active || scanPause) continue;
      scan.phase = "scanning";
      for (const el of containers)
        if (!positions.some((p) => p.el === el))
          positions.push({ el, x: el.scrollLeft, y: el.scrollTop });
      const scrolling = document.scrollingElement || document.documentElement;
      let atBottom = true;
      for (const el of [scrolling, ...containers]) {
        if (scanStop) break;
        enqueueTree(el);
        const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
        if (!bottom) {
          atBottom = false;
          el.scrollTop += Math.max(200, el.clientHeight * 0.8);
        }
      }
      scan.phase = "waiting";
      progress();
      await sleep(650);
      if (token !== scanToken || scanStop) break;
      if (scanPause) continue;
      resources();
      await flush();
      const sig = `${collected}:${[scrolling, ...containers].map((el) => el.scrollHeight).join(":")}`;
      stable = atBottom && sig === previous ? stable + 1 : 0;
      previous = sig;
      scan.steps++;
      scan.reason = `Scanning · ${total} images collected · step ${scan.steps}`;
      progress();
      if (stable >= 3) {
        scan.state = "complete";
        scan.phase = "complete";
        scan.reason = "Reached loaded page end · no new images in 3 checks";
        break;
      }
    }
    if (token !== scanToken) return;
    if (scanStop) {
      scan.state = "stopped";
      scan.phase = "stopped";
      scan.reason = "Scan stopped · collected images retained";
    }
    for (const p of positions) {
      if (p.el) p.el.scrollTo(p.x, p.y);
      else window.scrollTo(p.x, p.y);
    }
    progress();
  }
  const onMessage: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = (m, _s, reply) => {
    if (disposed) return false;
    if (m.type === "PING") {
      reply({
        version: chrome.runtime.getManifest().version,
        prefix,
        initialized,
        observerCount: roots.size,
        mounted: host.isConnected,
        visible:
          !!dock &&
          !toolbar.hidden &&
          toolbar.getBoundingClientRect().width > 0,
      });
      return false;
    }
    if (m.type === "REFRESH_MEDIA") {
      const current = [...records.values()].find(
        (r) =>
          r.id === m.id &&
          r.media &&
          JSON.stringify(r.media) === JSON.stringify(m.media),
      );
      const el =
        current && [...elements].find(([, id]) => id === current.id)?.[0];
      if (!el?.isConnected || !current?.media?.slideId) {
        reply(null);
        return false;
      }
      signatures.delete(el);
      inspect(el);
      const fresh = records.get(current.id);
      reply(
        fresh && JSON.stringify(fresh.media) === JSON.stringify(m.media)
          ? fresh.variants
          : null,
      );
      return false;
    }
    if (m.type === "ROUTE_UPDATE") {
      if (collecting) enqueueTree(document.documentElement);
      redraw();
      reply(true);
      return false;
    }
    if (m.type === "CAPABILITIES") {
      reply(siteCapability(document, location.href));
      return false;
    }
    if (m.type === "SHOW_DOCK") {
      if (power.activated) {
        if (dock?.layout.state === "minimized")
          dock.setLayout({ ...dock.layout, state: dock.layout.restoreState });
        redraw();
      }
      if (power.activated) draw();
      reply({
        mounted: host.isConnected,
        visible:
          !!dock &&
          !toolbar.hidden &&
          toolbar.getBoundingClientRect().width > 0,
      });
      return false;
    }
    if (m.type === "SCAN_NOW") {
      const generation = runGeneration;
      enqueueTree(document.documentElement);
      resources();
      void (async () => {
        const started = Date.now();
        while (
          collecting &&
          generation === runGeneration &&
          Date.now() - started < 60000
        ) {
          await sleep(25);
          await flush();
          if (!pending.size && !dirty.size && !scheduled && traversals === 0) {
            reply(true);
            return;
          }
        }
        reply({ error: "Discovery interrupted or timed out" });
      })();
      return true;
    }
    if (m.type === "POWER_STATE") {
      applyRuntime(m.settings, m.power);
      reply(true);
      return false;
    }
    if (m.type === "DOCK_LAYOUT") {
      dock?.setLayout(m.layout);
      reply(true);
      return false;
    }
    if (m.type === "UI_STATE") {
      if (
        stalePowerEpochs.has(m.power.epoch) ||
        (m.power.epoch === power.epoch && m.power.revision < power.revision)
      ) {
        reply(false);
        return false;
      }
      selected = new Set(m.ids);
      total = m.count;
      collected = m.collected ?? m.count;
      included = new Set(m.included || []);
      for (const verified of m.verifiedFormats || []) {
        const r = records.get(verified.id);
        if (r)
          for (const v of verified.variants)
            if (v.method.includes("verified MIME")) {
              localVerified.set(v.url, v.format);
              const match = r.variants.find(
                (candidate) => candidate.url === v.url,
              );
              if (match) {
                match.format = v.format;
                match.method = v.method;
              }
            }
      }
      pageScan = { ...m.scan };
      applyRuntime(m.settings, m.power);
      mode = active ? m.mode : false;
      redraw();
      reply(true);
    } else if (m.type === "RESET") {
      collectionScope = "";
      prefix = "";
      records.clear();
      published.clear();
      for (const entry of boxes.values()) entry.root.remove();
      boxes.clear();
      localVerified.clear();
      included.clear();
      elements.clear();
      dirty.clear();
      signatures = new WeakMap();
      selected.clear();
      scanToken++;
      scanStop = true;
      scan = { ...idleScan };
      pageScan = { ...idleScan };
      initializePage();
      reply(true);
    } else if (m.type === "SCAN") {
      if (typeof m.selectionMode === "boolean") mode = m.selectionMode;
      if (!active && ["start", "resume"].includes(m.command)) {
        reply({ error: "Website detection is off" });
        return false;
      }
      if (
        ["pause", "resume"].includes(m.command) &&
        runningScanToken !== scanToken
      ) {
        reply(true);
        return false;
      }
      if (m.command === "start") {
        const capability = siteCapability(document, location.href);
        if (
          ["carousel", "stories"].includes(m.target) &&
          (window !== top || mode || !capability.targets.includes(m.target))
        ) {
          reply({
            error: "Open a supported viewer and exit Select mode first",
          });
          return false;
        }
        if (
          m.target === "stories" &&
          (!settings.instagramStoriesEnabled || !m.storyConsent)
        ) {
          reply({
            error: "Stories require explicit opt-in and viewed-status consent",
          });
          return false;
        }
        if (window !== top && m.target && m.target !== "feed") {
          reply(true);
          return false;
        }
        scanToken++;
        scanPause = false;
        scanStop = false;
        positions = [{ el: null, x: scrollX, y: scrollY }];
        scan = {
          sessionId: m.sessionId,
          target: m.target || "feed",
          skipped: 0,
          phase: "scanning",
          state: "running",
          reason: "Starting full-page scan",
          started: Date.now(),
          steps: 0,
          count: total,
        };
        const token = scanToken;
        runningScanToken = token;
        void fullScan(token).finally(() => {
          if (runningScanToken === token) runningScanToken = undefined;
        });
      } else if (m.command === "pause") {
        scanPause = true;
        scan.state = "paused";
        scan.phase = "paused";
        scan.reason = "Scan paused";
      } else if (m.command === "resume") {
        scanPause = false;
        scan.state = "running";
        scan.phase = "scanning";
        scan.reason = "Scanning resumed";
      } else {
        scanStop = true;
        scan.state = "stopped";
        scan.phase = "stopped";
        scan.reason = "Scan stopped · collected images retained";
      }
      progress();
      reply(true);
    } else if (m.type === "PAGE_BYTES") {
      if (
        !safeUrl(m.url) ||
        ![...records.values()].some((r) =>
          r.variants.some((v) => v.url === m.url),
        )
      ) {
        reply({ error: "Image not registered in this document" });
        return;
      }
      fetch(m.url, {
        credentials: "include",
        signal: AbortSignal.timeout(25000),
      })
        .then(async (r) => {
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          const b = await boundedBlob(r, 32 * 1024 * 1024);
          const f = new FileReader();
          f.onload = () => reply({ data: f.result, mime: b.type });
          f.onerror = () => reply({ error: "Image read failed" });
          f.readAsDataURL(b);
        })
        .catch((e) => reply({ error: String(e) }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  function initializePage() {
    initialized = false;
    const generation = ++helloGeneration;
    clearTimeout(helloTimer);
    void rpc<{ prefix: string; settings: Settings; power: PagePowerState }>({
      type: "HELLO",
    })
      .then(async (r) => {
        if (disposed || generation !== helloGeneration) return;
        prefix = r.prefix;
        applyRuntime(r.settings, r.power, true);
        await loadDock();
        if (disposed || generation !== helloGeneration) return;
        initialized = true;
        redraw();
      })
      .catch(() => {
        if (generation === helloGeneration)
          helloTimer = setTimeout(initializePage, 1000);
      });
  }
  initializePage();
  listen(window, "pageshow", (event) => {
    if (event.persisted) initializePage();
  });
  setInterval(() => {
    if (power.activated) redraw();
    if (collecting) {
      resources();
      redraw();
    }
  }, 5000);

  listen(window, "zephyer:dispose", () => {
    disposed = true;
    helloGeneration++;
    runGeneration++;
    scanToken++;
    scanStop = true;
    collecting = false;
    lifecycle.dispose();
    for (const observer of roots.values()) observer.disconnect();
    roots.clear();
    pending.clear();
    dirty.clear();
    for (const controller of blobControllers) controller.abort();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {}
    dock?.dispose();
    host.remove();
  });
}
