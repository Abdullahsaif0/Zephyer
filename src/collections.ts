import {
  all,
  put,
  getCollection,
  collectionRecords,
  deleteCollection,
  getRecords,
  patchCollection,
  deleteRecords,
} from "./db";
import type { Collection, ImageRecord } from "./shared";
export const activatedTabs = new Set<number>();
export const liveCollections = new Map<number, string>();
const galleryTabs = new Map<number, string>();
let epoch = "",
  persistence = Promise.resolve();
function persist() {
  const next = persistence
    .catch(() => {})
    .then(() =>
      chrome.storage.session.set({
        activation: [...activatedTabs],
        collectionEpoch: epoch,
        galleryTabs: Object.fromEntries(galleryTabs),
      }),
    );
  persistence = next;
  return next;
}
export async function initCollections() {
  const saved = await chrome.storage.session.get([
    "activation",
    "collectionEpoch",
    "galleryTabs",
  ]);
  epoch = saved["collectionEpoch"] || crypto.randomUUID();
  const tabs = await chrome.tabs.query({});
  const ids = new Set(tabs.map((t) => t.id));
  for (const id of saved["activation"] || [])
    if (ids.has(id)) activatedTabs.add(id);
  for (const [id, value] of Object.entries(saved["galleryTabs"] || {}))
    if (ids.has(Number(id))) galleryTabs.set(Number(id), String(value));
  for (const c of await all<Collection>("collections")) {
    if (
      c.epoch !== epoch &&
      c.state === "live" &&
      ids.has(c.tabId) &&
      c.documentId
    ) {
      const frame = await chrome.webNavigation
        .getFrame({ tabId: c.tabId, frameId: 0 })
        .catch(() => null);
      // Extension reloads clear storage.session too. An unchanged browser document
      // proves that its collection belongs to this session; restored browser tabs
      // receive new document IDs and cannot pass this check.
      if ((frame as any)?.documentId === c.documentId) {
        c.epoch = epoch;
        await put("collections", [c]);
      }
    }
    if (
      c.epoch !== epoch ||
      (c.state === "detached" && ![...galleryTabs.values()].includes(c.id))
    )
      await deleteCollection(c.id);
    else if (c.state === "live") {
      const frame = ids.has(c.tabId)
        ? await chrome.webNavigation
            .getFrame({ tabId: c.tabId, frameId: 0 })
            .catch(() => null)
        : null;
      liveCollections.set(c.tabId, c.id);
      if (
        !frame ||
        (c.documentId && (frame as any).documentId !== c.documentId)
      )
        await detach(c.tabId);
    }
  }
  // Backfill still-live legacy documents without activating the tab or fetching images.
  const legacy = (await all<ImageRecord>("records")).filter(
    (r) => !r.collectionId,
  );
  for (const id of new Set(legacy.map((r) => r.tabId))) {
    const rows = legacy.filter((r) => r.tabId === id),
      tab = tabs.find((t) => t.id === id);
    const frames = tab
      ? await chrome.webNavigation.getAllFrames({ tabId: id }).catch(() => [])
      : [];
    const valid = rows.filter((r) =>
      frames?.some(
        (f) =>
          f.frameId === r.frameId && (f as any).documentId === r.documentId,
      ),
    );
    await deleteRecords(
      rows.filter((r) => !valid.includes(r)).map((r) => r.id),
    );
    if (valid.length) {
      const c = await ensureCollection(id);
      for (const r of valid) r.collectionId = c.id;
      await put("records", valid);
    }
  }
  await persist();
}
export async function activate(id: number) {
  const wasActive = activatedTabs.has(id);
  activatedTabs.add(id);
  try {
    await persist();
  } catch (e) {
    if (!wasActive) activatedTabs.delete(id);
    throw e;
  }
}
export async function ensureCollection(tabId: number) {
  const existing = liveCollections.get(tabId);
  if (existing) {
    const c = await getCollection(existing);
    if (c) return c;
  }
  const tab = await chrome.tabs.get(tabId);
  const frame = await chrome.webNavigation
    .getFrame({ tabId, frameId: 0 })
    .catch(() => null);
  const c: Collection = {
    id: crypto.randomUUID(),
    epoch,
    tabId,
    documentId: (frame as any)?.documentId || "",
    url: tab.url || "",
    title: tab.title || new URL(tab.url || "https://invalid").hostname,
    state: "live",
    revision: 1,
    nextOrder: 0,
  };
  await put("collections", [c]);
  liveCollections.set(tabId, c.id);
  return c;
}
export async function detach(tabId: number) {
  const id = liveCollections.get(tabId);
  liveCollections.delete(tabId);
  if (!id) return;
  const c = await getCollection(id);
  if (!c) return;
  if ([...galleryTabs.values()].includes(id)) {
    await patchCollection(c.id, {
      state: "detached",
      scan:
        c.scan?.state === "running"
          ? { ...c.scan, state: "stopped", reason: "Source closed or changed" }
          : c.scan,
    });
    const records = await collectionRecords(id);
    for (const record of records) record.detached = true;
    await put("records", records);
    chrome.runtime
      .sendMessage({ type: "COLLECTION_NOTICE", collectionId: id })
      .catch(() => {});
  } else await deleteCollection(id);
}
export async function openGallery(tabId: number) {
  const c = await ensureCollection(tabId);
  const source = await chrome.tabs.get(tabId);
  if (source.title && source.title !== c.title)
    await patchCollection(c.id, { title: source.title.slice(0, 500) });
  if (!(await getRecords(tabId)).length)
    throw Error("Collect images before opening the gallery");
  const existing = [...galleryTabs].find(([, id]) => id === c.id);
  if (existing) {
    const tab = await chrome.tabs.get(existing[0]).catch(() => undefined);
    if (
      tab &&
      (!tab.url || tab.url.startsWith(chrome.runtime.getURL("gallery.html")))
    ) {
      await chrome.tabs.update(tab.id!, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { id: tab.id, collectionId: c.id };
    }
    galleryTabs.delete(existing[0]);
  }
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(
      `gallery.html?collection=${encodeURIComponent(c.id)}`,
    ),
  });
  galleryTabs.set(tab.id!, c.id);
  try {
    await persist();
  } catch (error) {
    galleryTabs.delete(tab.id!);
    await chrome.tabs.remove(tab.id!).catch(() => {});
    throw error;
  }
  return { id: tab.id, collectionId: c.id };
}
export async function closeTab(tabId: number) {
  activatedTabs.delete(tabId);
  await detach(tabId);
  const id = galleryTabs.get(tabId);
  galleryTabs.delete(tabId);
  await persist();
  if (id && ![...galleryTabs.values()].includes(id)) {
    const c = await getCollection(id);
    if (c?.state === "detached") await deleteCollection(id);
  }
}
export async function requireCollection(id: unknown) {
  if (typeof id !== "string" || id.length > 80)
    throw Error("Invalid collection");
  const c = await getCollection(id);
  if (!c || c.epoch !== epoch)
    throw Error(
      "Session ended · return to the website and click Zephyer to collect again",
    );
  return c;
}
export async function retainGallery(
  tabId: number | undefined,
  id: string,
  url: string | undefined,
) {
  if (tabId === undefined || !url) return;
  const source = new URL(url),
    gallery = new URL(chrome.runtime.getURL("gallery.html"));
  if (
    source.origin !== gallery.origin ||
    source.pathname !== gallery.pathname ||
    source.searchParams.get("collection") !== id ||
    galleryTabs.get(tabId) === id
  )
    return;
  const previous = galleryTabs.get(tabId);
  galleryTabs.set(tabId, id);
  try {
    await persist();
  } catch (e) {
    if (galleryTabs.get(tabId) === id) {
      if (previous) galleryTabs.set(tabId, previous);
      else galleryTabs.delete(tabId);
    }
    throw e;
  }
  if (previous && ![...galleryTabs.values()].includes(previous)) {
    const old = await getCollection(previous);
    if (old?.state === "detached") await deleteCollection(previous);
  }
}
export function announceCollection(tabId: number) {
  const id = liveCollections.get(tabId);
  if (id)
    chrome.runtime
      .sendMessage({ type: "COLLECTION_NOTICE", collectionId: id })
      .catch(() => {});
}

export async function galleryNavigated(tabId: number, url: string) {
  const id = galleryTabs.get(tabId);
  if (
    !id ||
    url ===
      chrome.runtime.getURL(`gallery.html?collection=${encodeURIComponent(id)}`)
  )
    return;
  galleryTabs.delete(tabId);
  await persist();
  const c = await getCollection(id);
  if (c?.state === "detached" && ![...galleryTabs.values()].includes(id))
    await deleteCollection(id);
}
