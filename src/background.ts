import { probeImage, clearProbe } from "./retrieval";
import {
  activateReliably,
  activationStatus,
  showTroubleshooting,
} from "./activation";
import { validMedia, socialDocumentKey } from "./social";
import {
  activatedTabs,
  liveCollections,
  initCollections,
  activate,
  ensureCollection,
  detach,
  openGallery,
  closeTab,
  requireCollection,
  announceCollection,
  galleryNavigated,
  retainGallery,
} from "./collections";
import { collectionRecords, patchCollection } from "./db";
import { pagePower, mergeSiteRules } from "./power";
import { validHostname, preferenceError } from "./preferences";
import {
  archiveFits,
  defaults,
  defaultOutput,
  idleScan,
  mergeVariants,
  MAX_INLINE_URL,
  networkUrl,
  safeUrl,
  sanitize,
  filename,
  candidates,
  DownloadFailure,
  failureKind,
  permanentFailure as sharedPermanentFailure,
  userCancelled as sharedUserCancelled,
  senderRole,
  type DownloadJob,
  type Collection,
  type ImageRecord,
  type Output,
  type RetrievalAttempt,
  type ScanSession,
  type Settings,
  type Variant,
} from "./shared";
import {
  getJobs,
  getRecords,
  getRecordIds,
  getRecordsByIds,
  put,
  removeTab,
} from "./db";
import { validTheme } from "./appearance";
import { validLayout } from "./dock";
import {
  normalizeDownloadFolder,
  validDownloadPreferences,
  outputPath,
  sequentialFilename,
} from "./download-settings";
import {
  decorate,
  eligibility,
  allowedVariants,
  validDiscoverySettings,
  normalizedFormat,
} from "./discovery";

/**
 * All per-tab service-worker state lives in one map with one cleanup path
 * (releaseTab). Each historical Map/Set is a thin accessor over TabState, so
 * call sites keep Map/Set syntax while the invariant "a tab's state is fully
 * owned by tabs" is enforced in one place. powerRevisions is deliberately
 * global and monotonic per tab: revisions must never go backward, even after
 * a tab's state is released (a reset revision could let stale callbacks win).
 */
type TabState = {
  manualCollection: boolean;
  scanHold: boolean;
  onePass?: string | undefined;
  publishedPower?: string | undefined;
  sessionId?: string | undefined;
  scanDocs: Map<number, string>;
  frameScans: Map<number, ScanSession>;
  scan?: ScanSession | undefined;
  mode: boolean;
  sourceRoute?: string | undefined;
  notifyTimer?: ReturnType<typeof setTimeout> | undefined;
  verificationControllers: Set<AbortController>;
};
const tabs = new Map<number, TabState>();
const ensureTab = (id: number): TabState => {
  let t = tabs.get(id);
  if (!t) {
    t = {
      manualCollection: false,
      scanHold: false,
      scanDocs: new Map(),
      frameScans: new Map(),
      mode: false,
      verificationControllers: new Set(),
    };
    tabs.set(id, t);
  }
  return t;
};
const tabField = <V>(
  pick: (t: TabState) => V | undefined,
  put: (t: TabState, v: V | undefined) => void,
) => ({
  get: (id?: number): V | undefined => {
    if (id === undefined) return undefined;
    const t = tabs.get(id);
    return t ? pick(t) : undefined;
  },
  set: (id: number, v: V): void => put(ensureTab(id), v),
  delete: (id: number): void => {
    const t = tabs.get(id);
    if (t) put(t, undefined);
  },
  has: (id: number): boolean => {
    const t = tabs.get(id);
    return !!t && pick(t) !== undefined;
  },
  entries: function* (): Generator<[number, V]> {
    for (const [id, t] of tabs) {
      const v = pick(t);
      if (v !== undefined) yield [id, v];
    }
  },
  values: function* (): Generator<V> {
    for (const [, v] of this.entries()) yield v;
  },
  [Symbol.iterator]() {
    return this.entries();
  },
});
const tabFlag = (pick: (t: TabState) => boolean, put: (t: TabState, v: boolean) => void) => ({
  add: (id: number): void => put(ensureTab(id), true),
  has: (id: number): boolean => {
    const t = tabs.get(id);
    return !!t && pick(t);
  },
  delete: (id: number): void => {
    const t = tabs.get(id);
    if (t) put(t, false);
  },
});
const manualCollection = tabFlag(
  (t) => t.manualCollection,
  (t, v) => (t.manualCollection = v),
);
const scanHolds = tabFlag(
  (t) => t.scanHold,
  (t, v) => (t.scanHold = v),
);
const onePass = tabField<string>(
  (t) => t.onePass,
  (t, v) => (t.onePass = v),
);
const publishedPower = tabField<string>(
  (t) => t.publishedPower,
  (t, v) => (t.publishedPower = v),
);
const sessionIds = tabField<string>(
  (t) => t.sessionId,
  (t, v) => (t.sessionId = v),
);
const scanDocs = tabField<Map<number, string>>(
  (t) => t.scanDocs,
  (t, v) => (t.scanDocs = v ?? new Map()),
);
const frameScans = tabField<Map<number, ScanSession>>(
  (t) => t.frameScans,
  (t, v) => (t.frameScans = v ?? new Map()),
);
const scans = tabField<ScanSession>(
  (t) => t.scan,
  (t, v) => (t.scan = v),
);
const modes = tabField<boolean>(
  (t) => t.mode || undefined,
  (t, v) => (t.mode = !!v),
);
const sourceRoutes = tabField<string>(
  (t) => t.sourceRoute,
  (t, v) => (t.sourceRoute = v),
);
const notifyTimers = tabField<ReturnType<typeof setTimeout>>(
  (t) => t.notifyTimer,
  (t, v) => (t.notifyTimer = v),
);
/** Abort controllers belong to their tab; the registry is derived. */
const verificationControllers = {
  set: (controller: AbortController, id: number): void => {
    ensureTab(id).verificationControllers.add(controller);
  },
  delete: (controller: AbortController, id?: number): void => {
    if (id === undefined) {
      for (const t of tabs.values()) t.verificationControllers.delete(controller);
      return;
    }
    tabs.get(id)?.verificationControllers.delete(controller);
  },
  /** Whether the tab currently owns at least one active controller. */
  has: (id: number): boolean => {
    const t = tabs.get(id);
    return !!t && t.verificationControllers.size > 0;
  },
  *ownedBy(id: number): Generator<AbortController> {
    const t = tabs.get(id);
    if (t) yield* t.verificationControllers;
  },
};
/** Release every piece of a tab's state. The only per-tab cleanup path. */
function releaseTab(id: number) {
  const t = tabs.get(id);
  if (t) {
    for (const c of t.verificationControllers) c.abort();
    if (t.notifyTimer) clearTimeout(t.notifyTimer);
    tabs.delete(id);
  }
  for (let i = verificationQueue.length - 1; i >= 0; i--) {
    const entry = verificationQueue[i];
    if (entry?.tabId === id) verificationQueue.splice(i, 1);
  }
  for (const key of verificationSeen)
    if (key.startsWith(`${id}:`)) verificationSeen.delete(key);
  releasePreviews(id);
}
const previewRequests = new Map<
  string,
  { owner: number; cancelled: boolean }
>();
const previewUrls = new Map<string, number>();
const powerEpoch = crypto.randomUUID();
// Monotonic per-tab revision counter; intentionally survives releaseTab.
const powerRevisions = new Map<number, number>();
function powerFor(tab: Pick<chrome.tabs.Tab, "id" | "url">) {
  const state = {
    ...pagePower(
      settings,
      tab.url || "",
      powerRevisions.get(tab.id!) || 0,
      activatedTabs.has(tab.id!),
      onePass.has(tab.id!) ||
        (manualCollection.has(tab.id!) &&
          scans.get(tab.id)?.state !== "paused"),
    ),
    epoch: powerEpoch,
    collectionId: liveCollections.get(tab.id!),
  };
  if (tab.id !== undefined) {
    const signature = JSON.stringify([
      state.hostname,
      state.globalEnabled,
      state.siteEnabled,
      state.activated,
      state.collecting,
      state.collectionId,
    ]);
    const previous = publishedPower.get(tab.id);
    if (previous !== undefined && previous !== signature)
      powerRevisions.set(tab.id, (powerRevisions.get(tab.id) || 0) + 1);
    publishedPower.set(tab.id, signature);
    state.revision = powerRevisions.get(tab.id) || 0;
  }
  return state;
}
async function commitSettings(next: Settings) {
  const previous = settings;
  await chrome.storage.local.set({ settings: next });
  settings = next;
  for (const tab of await chrome.tabs.query({})) {
    if (!tab.id) continue;
    const previousPower = pagePower(
      previous,
      tab.url || "",
      0,
      activatedTabs.has(tab.id),
      onePass.has(tab.id) ||
        (manualCollection.has(tab.id) && scans.get(tab.id)?.state !== "paused"),
    );
    const currentPower = powerFor(tab);
    const changed =
      previousPower.collecting !== currentPower.collecting ||
      previousPower.effectiveEnabled !== currentPower.effectiveEnabled;
    if (changed)
      powerRevisions.set(tab.id, (powerRevisions.get(tab.id) || 0) + 1);
    const power = powerFor(tab);
    if (!power.effectiveEnabled && scans.get(tab.id)?.state === "running") {
      scanHolds.add(tab.id);
      scans.set(tab.id, {
        ...scans.get(tab.id)!,
        state: "paused",
        phase: "paused",
        reason: "Website is off · turn on, then explicitly Resume",
      });
      await chrome.tabs
        .sendMessage(tab.id, { type: "SCAN", command: "pause" })
        .catch(() => {});
      await chrome.storage.local.set({
        scanRecovery: Object.fromEntries(scans),
      });
    }
    if (!power.collecting) {
      if (!power.effectiveEnabled) modes.set(tab.id, false);
      for (const controller of verificationControllers.ownedBy(tab.id))
        controller.abort();
      for (let i = verificationQueue.length - 1; i >= 0; i--) {
        const entry = verificationQueue[i];
        if (entry?.tabId === tab.id) verificationQueue.splice(i, 1);
      }
      for (const key of verificationSeen)
        if (key.startsWith(`${tab.id}:`)) verificationSeen.delete(key);
      const scan = scans.get(tab.id);
      if (!power.effectiveEnabled && scan?.state === "running") {
        Object.assign(scan, {
          state: "paused",
          phase: "paused",
          reason: "Website detection is off · turn on, then Resume",
        });
        for (const frame of frameScans.get(tab.id)?.values() || [])
          if (frame.state === "running")
            Object.assign(frame, {
              state: "paused",
              phase: "paused",
              reason: scan.reason,
            });
      }
      // Drain any discovery transaction that began before the committed Off state.
      await serialized(`records:${tab.id}`, async () => {});
    }
    await chrome.tabs
      .sendMessage(tab.id, { type: "POWER_STATE", settings, power })
      .catch(() => {});
    notify(tab.id);
  }
  persistScans();
}
let settings: Settings = { ...defaults };
let initialized: Promise<void>;
const locks = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  locks.set(key, p);
  p.finally(() => {
    if (locks.get(key) === p) locks.delete(key);
  }).catch(() => {});
  return p;
}
/**
 * scanRecovery durability: progress updates are debounced (they fire per
 * SCAN_PROGRESS burst), while terminal states flush immediately so a worker
 * death right after Stop/complete still recovers to the correct state.
 * Pending debounce timers are fire-and-forget by design — the 1-minute
 * zephyer-recover alarm is the backstop if the worker dies mid-debounce.
 */
let scanRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
let scanRecoveryPending = false;
function persistScans(immediate = false) {
  const write = () =>
    serialized("scan-recovery", () =>
      chrome.storage.local.set({ scanRecovery: Object.fromEntries(scans) }),
    );
  if (immediate) {
    if (scanRecoveryTimer) clearTimeout(scanRecoveryTimer);
    scanRecoveryTimer = undefined;
    scanRecoveryPending = false;
    void write();
    return;
  }
  scanRecoveryPending = true;
  if (scanRecoveryTimer) return;
  scanRecoveryTimer = setTimeout(() => {
    scanRecoveryTimer = undefined;
    if (scanRecoveryPending) {
      scanRecoveryPending = false;
      void write();
    }
  }, 1000);
}
const init = () =>
  (initialized ??= chrome.storage.local
    .get(["settings", "scanRecovery"])
    .then(async (r) => {
      settings = { ...defaults, ...r["settings"] };
      await initCollections();
      for (const tab of await chrome.tabs.query({}))
        if (tab.id && tab.url) sourceRoutes.set(tab.id, tab.url);
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: false,
      });
      if (!validTheme(settings.theme)) settings.theme = "graphite";
      if (!["horizontal", "vertical"].includes(settings.dockOrientation))
        settings.dockOrientation = "horizontal";
      if (!validDiscoverySettings(settings)) {
        for (const k of [
          "allowedFormats",
          "smartCleanup",
          "hideSmall",
          "hideBranding",
          "hideAvatars",
          "minImageSize",
          "showUpcoming",
        ] as const)
          (settings as any)[k] = defaults[k];
      }
      if (!validDownloadPreferences(settings)) {
        settings.downloadFolder = defaults.downloadFolder;
        settings.groupDownloads = defaults.groupDownloads;
        settings.askWhereToSave = defaults.askWhereToSave;
        settings.sequencePrefix = defaults.sequencePrefix;
      }
      for (const [id, value] of Object.entries(r["scanRecovery"] || {})) {
        const scan = value as ScanSession;
        if (["running", "paused"].includes(scan.state)) {
          const tab = await chrome.tabs.get(Number(id)).catch(() => undefined);
          if (!tab || (scan.pageUrl && tab.url !== scan.pageUrl)) continue;
          scanHolds.add(Number(id));
          scans.set(Number(id), {
            ...scan,
            state: "paused",
            phase: "paused",
            reason:
              "Scan interrupted · Resume starts a fresh pass; collected images are retained",
          });
          await chrome.tabs
            .sendMessage(Number(id), { type: "SCAN", command: "pause" })
            .catch(() => {});
          notify(Number(id));
        }
      }
    }));
const trusted = (s: chrome.runtime.MessageSender) =>
  s.id === chrome.runtime.id && !!s.url?.startsWith(chrome.runtime.getURL(""));
// Structured classification from shared.ts; the local names are re-exported
// for the queue so retry logic branches on FailureKind, not message text.
const permanentFailure = sharedPermanentFailure;
const userCancelled = sharedUserCancelled;
function cancellationSummary(j: DownloadJob) {
  const remaining = j.items.some((i) =>
    ["queued", "fetching", "downloading"].includes(i.state),
  );
  if (j.state !== "cancelled") j.state = remaining ? "paused" : "done";
  j.summary = `${j.items.filter((i) => i.state === "done").length} saved · ${j.items.filter((i) => i.state === "cancelled").length} cancelled${remaining ? " · queue paused" : ""}`;
}
function validateOutput(v: any): Output {
  if (
    !v ||
    !["original", "jpeg", "png", "webp"].includes(v.format) ||
    typeof v.quality !== "string" ||
    v.quality.length > MAX_INLINE_URL
  )
    throw Error("Invalid output settings");
  for (const key of ["width", "height"])
    if (!Number.isFinite(v[key]) || v[key] < 0 || v[key] > 16384)
      throw Error("Resize dimensions must be 0–16384");
  if (
    !Number.isFinite(v.qualityValue) ||
    v.qualityValue < 0.1 ||
    v.qualityValue > 1
  )
    throw Error("Invalid compression quality");
  return {
    ...defaultOutput,
    ...v,
    background: /^#[a-f0-9]{6}$/i.test(v.background) ? v.background : "#ffffff",
  };
}
function recordFrom(
  raw: any,
  s: chrome.runtime.MessageSender,
): ImageRecord | null {
  const pre = `${s.tab!.id}:${s.documentId || s.frameId}:`;
  if (
    !raw ||
    typeof raw.id !== "string" ||
    !raw.id.startsWith(pre) ||
    raw.id.length >= 300 ||
    !Array.isArray(raw.variants) ||
    raw.variants.length > 80
  )
    return null;
  const variants = raw.variants
    .filter(
      (v: any) =>
        v &&
        typeof v.url === "string" &&
        v.url.length <= MAX_INLINE_URL &&
        safeUrl(v.url),
    )
    .map((v: any) => ({
      url: v.url,
      width: Number.isFinite(v.width)
        ? Math.max(0, Math.min(v.width, 100000))
        : 0,
      height: Number.isFinite(v.height)
        ? Math.max(0, Math.min(v.height, 100000))
        : 0,
      format: String(v.format || "unknown").slice(0, 20),
      method: String(v.method || "discovered").slice(0, 80),
      verified: !!v.verified,
    }));
  if (!variants.length && !String(raw.status).startsWith("unsupported"))
    return null;
  return {
    ...(validMedia(raw.media)
      ? {
          media: {
            platform: raw.media.platform,
            contentId: raw.media.contentId,
            slideId: raw.media.slideId,
            kind: raw.media.kind,
          },
        }
      : {}),
    id: raw.id,
    tabId: s.tab!.id!,
    documentId: s.documentId || "",
    frameId: s.frameId || 0,
    pageUrl: s.url || s.tab!.url || "",
    source: String(raw.source || "image").slice(0, 80),
    name: String(raw.name || "").slice(0, 200),
    variants,
    displayed: variants.some((v: any) => v.url === raw.displayed)
      ? raw.displayed
      : variants[0]?.url || "",
    width: Number.isFinite(raw.width)
      ? Math.max(0, Math.min(raw.width, 100000))
      : 0,
    height: Number.isFinite(raw.height)
      ? Math.max(0, Math.min(raw.height, 100000))
      : 0,
    selected: false,
    signals: {
      interfaceAsset: raw.signals?.interfaceAsset === true,
      avatar: raw.signals?.avatar === true,
      favicon: raw.signals?.favicon === true,
      emoji: raw.signals?.emoji === true,
    },
    status: String(raw.status || "ready").slice(0, 150),
    anchored: !!raw.anchored,
    updated: Date.now(),
  };
}
const verificationQueue: ImageRecord[] = [];
const verificationSeen = new Set<string>();
const verificationGrants = new Set<string>();
let verificationActive = 0;
function scheduleVerification(r: ImageRecord) {
  if (!r.variants.some((v) => v.format === "unknown" && networkUrl(v.url)))
    return;
  const key = r.id + ":" + r.variants.map((v) => v.url).join("|");
  if (verificationSeen.has(key) || verificationQueue.length >= 10000) return;
  verificationSeen.add(key);
  verificationQueue.push(r);
  drainVerification();
}
function drainVerification() {
  while (verificationActive < 2 && verificationQueue.length) {
    const record = verificationQueue.shift()!;
    const controller = new AbortController();
    verificationControllers.set(controller, record.tabId);
    const revision = powerRevisions.get(record.tabId) || 0;
    const allowed = async () => {
      const tab = await chrome.tabs.get(record.tabId).catch(() => undefined);
      return (
        !!tab &&
        !controller.signal.aborted &&
        revision === (powerRevisions.get(record.tabId) || 0) &&
        powerFor(tab).effectiveEnabled &&
        (powerFor(tab).collecting || verificationGrants.has(record.id))
      );
    };
    verificationActive++;
    void (async () => {
      for (const variant of record.variants.filter(
        (v) => v.format === "unknown" && networkUrl(v.url),
      )) {
        if (!(await allowed())) break;
        const probe = await probeImage(variant.url, controller.signal);
        const format = probe.format;
        await serialized(`records:${record.tabId}`, async () => {
          if (!(await allowed())) return;
          const current = (await getRecords(record.tabId)).find(
            (r) => r.id === record.id,
          );
          if (!current) return;
          for (const v of current.variants)
            if (v.url === variant.url) {
              v.format = format;
              v.probeError = probe.error;
              v.bytes = probe.bytes;
              if (format !== "unknown" && !v.method.includes("verified MIME"))
                v.method += " · verified MIME";
            }
          await put("records", [current]);
        });
        notify(record.tabId);
      }
    })().finally(() => {
      verificationGrants.delete(record.id);
      verificationControllers.delete(controller);
      verificationActive--;
      drainVerification();
    });
  }
}
const notifyAgain = new Set<number>();
function notify(tabId: number) {
  if (notifyTimers.has(tabId)) {
    notifyAgain.add(tabId);
    return;
  }
  notifyTimers.set(
    tabId,
    setTimeout(async () => {
      try {
        await init();
        const rs = await getRecords(tabId);
        const collectionId = liveCollections.get(tabId);
        if (collectionId) {
          await patchCollection(collectionId, {
            scan: scans.get(tabId) || idleScan,
          });
        }
        announceCollection(tabId);
        const tab = await chrome.tabs.get(tabId).catch(() => undefined);
        if (!tab) return;
        chrome.tabs
          .sendMessage(tabId, {
            type: "UI_STATE",
            power: powerFor(tab),
            ids: rs
              .filter(
                (r) =>
                  r.selected && eligibility(r, settings).state === "accepted",
              )
              .map((r) => r.id),
            count: rs.filter(
              (r) => eligibility(r, settings).state === "accepted",
            ).length,
            collected: rs.length,
            included: rs.filter((r) => r.userIncluded).map((r) => r.id),
            verifiedFormats: rs
              .filter((r) =>
                r.variants.some((v) => v.method.includes("verified MIME")),
              )
              .map((r) => ({ id: r.id, variants: r.variants })),
            mode: modes.get(tabId) || false,
            scan: scans.get(tabId) || idleScan,
            settings,
          })
          .catch(() => {});
        chrome.runtime.sendMessage({ type: "NOTICE", tabId }).catch(() => {});
      } catch (e) {
        console.error("Page update", e);
      } finally {
        notifyTimers.delete(tabId);
        if (notifyAgain.delete(tabId)) notify(tabId);
      }
    }, 150),
  );
}
async function offscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (!contexts.length)
    await serialized("offscreen", async () => {
      if (!(await chrome.runtime.getContexts({ documentUrls: [url] })).length)
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: [chrome.offscreen.Reason.BLOBS],
          justification:
            "Locally decode/convert images, construct ZIP archives and retain download Blob URLs.",
        });
    });
}
let processingImages = 0;
async function processImage(payload: any) {
  processingImages++;
  try {
    await offscreen();
    const r = await chrome.runtime.sendMessage({
      target: "offscreen",
      ...payload,
    });
    if (!r || r.error) throw Error(r?.error || "Image processor disconnected");
    return r;
  } finally {
    processingImages--;
  }
}
async function updateJob(id: string, fn: (j: DownloadJob) => void) {
  return serialized("job:" + id, async () => {
    const j = (await getJobs()).find((j) => j.id === id);
    if (!j) throw Error("Job not found");
    fn(j);
    await put("jobs", [j]);
    notify(j.tabId);
    if (j.collectionId)
      chrome.runtime
        .sendMessage({
          type: "COLLECTION_NOTICE",
          collectionId: j.collectionId,
        })
        .catch(() => {});
    return j;
  });
}
const running = new Set<string>(),
  hostBusy = new Set<string>();
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  setTimeout(async () => {
    try {
      await recover();
      const jobs = await getJobs();
      const downloading = jobs
        .flatMap((j) => j.items)
        .filter((i) => i.state === "downloading");
      const activeHosts = new Set(
        downloading.map((i) => {
          try {
            return new URL(i.record.displayed).hostname;
          } catch {
            return "local";
          }
        }),
      );
      let slots = Math.max(
        0,
        settings.concurrency - downloading.length - running.size,
      );
      for (const job of jobs) {
        if (job.state !== "running") continue;
        if (
          job.delivery?.saveAs &&
          (running.size > 0 || downloading.length > 0)
        )
          continue;
        if (
          !job.items.some((i) =>
            ["queued", "fetching", "downloading"].includes(i.state),
          )
        ) {
          await updateJob(job.id, (j) => {
            j.state = "done";
            const failed = j.items.filter((i) => i.state === "failed").length;
            j.summary = `${j.items.filter((i) => i.state === "done").length} saved · ${failed} failed · ${j.items.filter((i) => i.state === "cancelled").length} cancelled`;
          });
          continue;
        }
        if (job.output.zip) {
          const k = job.id + ":zip";
          if (
            !running.has(k) &&
            slots > 0 &&
            job.items.some(
              (i) => i.state === "queued" && (i.nextAt || 0) <= Date.now(),
            ) &&
            !job.items.some((i) => i.state === "downloading")
          ) {
            slots--;
            running.add(k);
            void runZip(job).finally(() => {
              running.delete(k);
              pump();
            });
          }
          continue;
        }
        for (const item of job.items) {
          if (slots <= 0) break;
          if (item.state !== "queued" || (item.nextAt || 0) > Date.now())
            continue;
          let hostname = "local";
          try {
            hostname = new URL(item.record.displayed).hostname;
          } catch {}
          if (hostBusy.has(hostname) || activeHosts.has(hostname)) continue;
          const k = job.id + ":" + item.id;
          if (running.has(k)) continue;
          slots--;
          running.add(k);
          hostBusy.add(hostname);
          void runItem(job, item.id).finally(() => {
            running.delete(k);
            hostBusy.delete(hostname);
            pump();
          });
          if (job.delivery?.saveAs) break;
        }
      }
      if (
        jobs.some(
          (j) =>
            j.state === "running" &&
            j.items.some(
              (i) => i.state === "queued" && (i.nextAt || 0) > Date.now(),
            ),
        )
      )
        setTimeout(pump, 1000);
    } catch (e) {
      console.error("Queue", e);
    } finally {
      pumping = false;
    }
  }, 0);
}
async function pageBytes(r: ImageRecord, url: string) {
  try {
    const options: chrome.tabs.MessageSendOptions = { frameId: r.frameId };
    if (r.documentId) options.documentId = r.documentId;
    const response = await chrome.tabs.sendMessage(
      r.tabId,
      { type: "PAGE_BYTES", url },
      options,
    );
    if (response?.data) return response.data;
  } catch {}
  return undefined;
}
async function freshMedia(
  record: ImageRecord,
  trace: RetrievalAttempt[],
) {
  if (!record.media?.contentId || !record.media.slideId || record.detached)
    return;
  const current = (await getRecordsByIds([record.id]))[0];
  if (
    !current ||
    current.detached ||
    current.collectionId !== liveCollections.get(record.tabId)
  )
    return;
  trace.push({
    strategy: "refresh",
    url: record.displayed,
    result: "Attempted same post/slide live-document resolution",
    at: Date.now(),
  });
  try {
    const options: chrome.tabs.MessageSendOptions = {
      frameId: record.frameId,
    };
    if (record.documentId) options.documentId = record.documentId;
    const raw = await chrome.tabs.sendMessage(
      record.tabId,
      { type: "REFRESH_MEDIA", id: record.id, media: record.media },
      options,
    );
    if (!Array.isArray(raw) || raw.length > 80) return;
    const valid = raw.filter(
      (v) =>
        v &&
        networkUrl(v.url) &&
        typeof v.format === "string" &&
        Number.isFinite(v.width) &&
        Number.isFinite(v.height),
    );
    const changed = valid.filter(
      (v) => !record.variants.some((old) => old.url === v.url),
    );
    if (!changed.length) return;
    return {
      ...record,
      displayed: changed[0].url,
      variants: mergeVariants(changed, record.variants),
    };
  } catch {
    return;
  }
}
async function processCandidate(
  record: ImageRecord,
  url: string,
  output: Output,
  allowedFormats?: string[],
  requestId?: string,
  trace: RetrievalAttempt[] = [],
): Promise<any> {
  const attempt: RetrievalAttempt = {
    strategy: "extension",
    url,
    result: "Attempting readable bytes",
    at: Date.now(),
  };
  trace.push(attempt);
  try {
    const result = await processImage({
      operation: "IMAGE",
      url,
      output,
      allowedFormats,
      requestId,
    });
    attempt.result = "Readable bytes prepared";
    return result;
  } catch (error) {
    attempt.result =
      /HTTP \d{3}/.exec(String(error))?.[0] || "Extension byte request failed";
    const data = await pageBytes(record, url);
    if (!data) throw error;
    trace.push({
      strategy: "page",
      url,
      result: "Document-validated byte fallback",
      at: Date.now(),
    });
    return processImage({
      operation: "IMAGE",
      url: data,
      output,
      allowedFormats,
      requestId,
    });
  }
}
async function converted(
  record: ImageRecord,
  output: Output,
  allowedFormats?: string[],
  trace: RetrievalAttempt[] = [],
  allowRefresh = true,
): Promise<any> {
  let last = "No downloadable candidates";
  const vs = candidates(record, output.quality);
  for (let index = 0; index < vs.length; index++) {
    const v = vs[index];
    if (!v) break;
    try {
      const result = await processCandidate(
        record,
        v.url,
        output,
        allowedFormats,
        undefined,
        trace,
      );
      return { ...result, url: v.url, fallback: index > 0 };
    } catch (e) {
      last = String(e);
      if (failureKind(e) === "rate-limited") throw e;
    }
  }
  if (allowRefresh && /HTTP (401|403|404|410)/.test(last)) {
    const fresh = await freshMedia(record, trace);
    if (fresh) return converted(fresh, output, allowedFormats, trace, false);
  }
  throw Error(
    last +
      " · conversion/ZIP requires readable image bytes; an original browser download may have different access",
  );
}
async function enrich(record: ImageRecord) {
  let changed = false;
  for (const v of record.variants) {
    if (
      !v.width &&
      /original|full|large|zoom|Google|Bing|data-src|data-lazy|srcset/.test(
        v.method,
      )
    ) {
      try {
        Object.assign(
          v,
          await processImage({ operation: "PROBE", url: v.url }),
          { verified: true },
        );
        changed = true;
      } catch (e) {
        v.probeError = String(e);
        changed = true;
      }
    }
  }
  if (changed) {
    await serialized("records:" + record.tabId, async () => {
      const rs = await getRecords(record.tabId);
      const r = rs.find((r) => r.id === record.id);
      if (r) {
        r.variants = mergeVariants(r.variants, record.variants);
        await put("records", [r]);
      }
    });
    notify(record.tabId);
  }
  return record;
}
async function runItem(job: DownloadJob, itemId: string) {
  const retrieval: RetrievalAttempt[] = [
    ...(job.items.find((i) => i.id === itemId)?.retrieval || []),
  ];
  let item = job.items.find((i) => i.id === itemId)!;
  let pendingBlob: string | undefined;
  try {
    let claimed = false;
    job = await updateJob(job.id, (j) => {
      const i = j.items.find((i) => i.id === itemId)!;
      if (j.state !== "running" || i.state !== "queued") return;
      claimed = true;
      i.state = "fetching";
      i.attempts++;
      i.error = undefined;
    });
    if (!claimed) return;
    item = job.items.find((i) => i.id === itemId)!;
    if (job.output.quality === "best" && item.attempts === 1) {
      item.record = await enrich(item.record);
      job = await updateJob(job.id, (j) => {
        j.items.find((i) => i.id === itemId)!.record = item.record;
      });
    }
    let url: string,
      fmt: string | undefined,
      actualUrl: string | undefined,
      fallback = false,
      blobUrl: string | undefined;
    if (
      job.output.format === "original" &&
      networkUrl(item.record.displayed) &&
      item.attempts < 4
    ) {
      const vs = candidates(item.record, job.output.quality);
      const previousIndex = item.actualUrl
        ? vs.findIndex((v) => v.url === item.actualUrl)
        : -1;
      let index = Math.min(
        Math.max(
          item.attempts - 1,
          previousIndex >= 0 && item.attempts > 1 ? previousIndex + 1 : 0,
        ),
        vs.length - 1,
      );
      for (; index < vs.length; index++) {
        const initial = vs[index];
        if (!initial) break;
        let candidate: Variant = initial;
        fmt = candidate.format;
        try {
          const probe = await probeImage(candidate.url);
          retrieval.push(probe.attempt);
          if ([429, 503].includes(probe.attempt.status || 0))
            throw new DownloadFailure(
              "rate-limited",
              `HTTP ${probe.attempt.status} · host backoff active`,
            );
          if (
            [401, 403, 404, 410].includes(probe.attempt.status || 0) &&
            !item.refreshAttempted
          ) {
            await updateJob(job.id, (j) => {
              j.items.find((i) => i.id === itemId)!.refreshAttempted = true;
            });
            item.refreshAttempted = true;
            const fresh = await freshMedia(item.record, retrieval);
            if (fresh) {
              const replacement = candidates(fresh, job.output.quality).find(
                (v) => !item.record.variants.some((old) => old.url === v.url),
              );
              if (replacement) {
                candidate = replacement;
                vs[index] = replacement;
                fmt = replacement.format;
              }
            }
          }
          const actual = probe.format;
          if (!probe.error) {
            fmt = actual;
            if (fmt !== candidate.format) {
              await serialized(`records:${job.tabId}`, async () => {
                const current = (await getRecords(job.tabId)).find(
                  (r) => r.id === item.record.id,
                );
                if (!current) return;
                for (const v of current.variants)
                  if (v.url === candidate.url) {
                    v.format = actual;
                    if (!v.method.includes("verified MIME"))
                      v.method += " · verified MIME";
                  }
                if (eligibility(current, settings).state !== "accepted")
                  current.selected = false;
                await put("records", [current]);
              });
              notify(job.tabId);
            }
          }
        } catch (error) {
          if (/HTTP (429|503)/.test(String(error))) throw error;
          /* Native download may have access even when the HEAD request fails. */
        }
        if (
          !job.allowedFormats ||
          job.allowedFormats.includes(normalizedFormat(fmt))
        )
          break;
      }
      const finalUrl = vs[index]?.url;
      if (!finalUrl)
        throw new DownloadFailure(
          "permanent",
          "No eligible format for this candidate; enable its actual format in Preferences",
        );
      url = finalUrl;
      actualUrl = url;
      fallback = index > 0;
    } else {
      const result = await converted(
        item.record,
        job.output,
        job.allowedFormats,
        retrieval,
        !item.refreshAttempted,
      );
      url = result.blobUrl;
      blobUrl = url;
      pendingBlob = blobUrl;
      fmt = result.format;
      actualUrl = result.url;
      fallback = result.fallback;
    }
    retrieval.push({
      strategy: blobUrl ? "extension" : "native",
      url: actualUrl || url,
      result: blobUrl
        ? "Readable bytes prepared"
        : "Handed to Chrome download manager; byte access may differ",
      at: Date.now(),
    });
    await updateJob(job.id, (j) => {
      j.items.find((i) => i.id === itemId)!.retrieval = retrieval.slice(-20);
    });
    const latest = (await getJobs()).find((j) => j.id === job.id)!;
    if (latest.state !== "running") {
      if (blobUrl) await processImage({ operation: "REVOKE", url: blobUrl });
      await updateJob(job.id, (j) => {
        j.items.find((i) => i.id === itemId)!.state =
          j.state === "cancelled" ? "cancelled" : "queued";
      });
      return;
    }
    const file = outputPath(
      job.folder,
      (item.sequence === undefined ? filename : sequentialFilename)(
        { ...item.record, displayed: actualUrl || item.record.displayed },
        item.sequence ?? job.items.findIndex((i) => i.id === itemId),
        fmt,
        job.delivery?.prefix,
      ),
    );
    await updateJob(job.id, (j) => {
      j.items.find((i) => i.id === itemId)!.file = file;
    });
    const id = await chrome.downloads.download({
      url,
      filename: file,
      conflictAction: "uniquify",
      saveAs: job.delivery?.saveAs ?? false,
    });
    pendingBlob = undefined; // The browser owns the URL until download reconciliation.
    const dispatched = await updateJob(job.id, (j) =>
      Object.assign(
        j.items.find((i) => i.id === itemId)!,
        {
          state: j.state === "cancelled" ? "cancelled" : "downloading",
          downloadId: id,
          actualUrl,
          fallback,
          blobUrl,
          file,
        },
      ),
    );
    if (dispatched.state === "cancelled")
      await chrome.downloads.cancel(id).catch(() => {});
    else if (dispatched.state === "paused")
      await chrome.downloads.pause(id).catch(() => {});
    await reconcileDownload(id);
  } catch (e) {
    if (pendingBlob)
      await processImage({ operation: "REVOKE", url: pendingBlob }).catch(
        () => {},
      );
    const current = (await getJobs()).find((j) => j.id === job.id);
    const attempts = current?.items.find((i) => i.id === itemId)?.attempts || 1;
    await updateJob(job.id, (j) => {
      const i = j.items.find((i) => i.id === itemId)!;
      if (userCancelled(e)) {
        i.state = "cancelled";
        i.error = "Cancelled in Chrome Save as";
        cancellationSummary(j);
        return;
      }
      i.state =
        j.state === "cancelled"
          ? "cancelled"
          : attempts < 4 && !permanentFailure(e)
            ? "queued"
            : "failed";
      i.retrieval = retrieval.slice(-20);
      if (retrieval.some((t) => t.strategy === "refresh"))
        i.refreshAttempted = true;
      i.error = String(e);
      i.nextAt = Date.now() + Math.min(60000, 1000 * 2 ** attempts);
    });
  }
}
async function runZip(job: DownloadJob) {
  let pendingArchive: string | undefined;
  const archiveKey = `${job.id}:${job.zipPart}`;
  try {
    await offscreen();
    const batch = job.items
      .filter((i) => i.state === "queued" && (i.nextAt || 0) <= Date.now())
      .slice(0, 100);
    if (!batch.length) return;
    const prepared: string[] = [];
    let bytes = 0;
    await processImage({ operation: "ZIP_BEGIN", key: archiveKey });
    for (const item of batch) {
      const latest = (await getJobs()).find((j) => j.id === job.id)!;
      if (latest.state !== "running") break;
      let claimed = false;
      await updateJob(job.id, (j) => {
        const i = j.items.find((i) => i.id === item.id)!;
        if (j.state !== "running" || i.state !== "queued") return;
        claimed = true;
        i.state = "fetching";
        i.attempts++;
        i.error = undefined;
      });
      if (!claimed) break;
      let preparedBlob: string | undefined;
      const trace: RetrievalAttempt[] = [];
      try {
        if (job.output.quality === "best" && item.attempts === 0)
          item.record = await enrich(item.record);
        const result = await converted(
          item.record,
          {
            ...job.output,
            zip: false,
          },
          job.allowedFormats,
          trace,
          !item.refreshAttempted,
        );
        await updateJob(job.id, (j) => {
          j.items.find((i) => i.id === item.id)!.retrieval = trace.slice(-20);
        });
        preparedBlob = result.blobUrl;
        if (prepared.length && !archiveFits(bytes, result.bytes)) {
          await processImage({ operation: "REVOKE", url: result.blobUrl });
          await updateJob(job.id, (j) => {
            j.items.find((i) => i.id === item.id)!.state = "queued";
          });
          break;
        }
        if (result.bytes > 250 * 1024 * 1024) {
          await processImage({ operation: "REVOKE", url: result.blobUrl });
          throw Error(
            "Single image exceeds 250 MB archive input limit; use individual download",
          );
        }
        const name = (
          item.sequence === undefined ? filename : sequentialFilename
        )(
          { ...item.record, displayed: result.url },
          item.sequence ?? job.items.findIndex((i) => i.id === item.id),
          result.format,
          job.delivery?.prefix,
        );
        await processImage({
          operation: "ZIP_ADD",
          key: archiveKey,
          url: result.blobUrl,
          name,
        });
        preparedBlob = undefined; // ZIP_ADD consumes the temporary image URL.
        prepared.push(item.id);
        bytes += result.bytes;
        await updateJob(job.id, (j) =>
          Object.assign(
            j.items.find((i) => i.id === item.id)!,
            { actualUrl: result.url, fallback: result.fallback, file: name },
          ),
        );
      } catch (e) {
        if (preparedBlob)
          await processImage({ operation: "REVOKE", url: preparedBlob }).catch(
            () => {},
          );
        await updateJob(job.id, (j) => {
          const i = j.items.find((i) => i.id === item.id)!;
          i.state =
            j.state === "cancelled"
              ? "cancelled"
              : i.attempts < 4 && !permanentFailure(e)
                ? "queued"
                : "failed";
          i.retrieval = trace.slice(-20);
          if (trace.some((t) => t.strategy === "refresh"))
            i.refreshAttempted = true;
          i.error = String(e);
          i.nextAt = Date.now() + Math.min(60000, 1000 * 2 ** i.attempts);
        });
        if (/429|503/.test(String(e))) break;
      }
    }
    if (prepared.length) {
      const result = await processImage({
        operation: "ZIP_END",
        key: archiveKey,
      });
      pendingArchive = result.blobUrl;
      const current = (await getJobs()).find((j) => j.id === job.id)!;
      if (current.state !== "running") {
        await processImage({ operation: "REVOKE", url: result.blobUrl });
        await updateJob(job.id, (j) => {
          for (const i of j.items)
            if (prepared.includes(i.id))
              i.state = j.state === "cancelled" ? "cancelled" : "queued";
        });
        return;
      }
      const id = await chrome.downloads.download({
        url: result.blobUrl,
        filename: outputPath(
          job.folder,
          `images-part-${String(job.zipPart + 1).padStart(3, "0")}.zip`,
        ),
        conflictAction: "uniquify",
        saveAs: job.delivery?.saveAs ?? false,
      });
      pendingArchive = undefined;
      const dispatched = await updateJob(job.id, (j) => {
        j.archiveIds.push(id);
        j.archives ??= [];
        j.archives.push({
          id,
          itemIds: prepared,
          blobUrl: result.blobUrl,
          state: "downloading",
        });
        j.zipPart++;
        for (const i of j.items)
          if (prepared.includes(i.id))
            Object.assign(i, {
              state: j.state === "cancelled" ? "cancelled" : "downloading",
              downloadId: id,
            });
      });
      if (dispatched.state === "cancelled")
        await chrome.downloads.cancel(id).catch(() => {});
      else if (dispatched.state === "paused")
        await chrome.downloads.pause(id).catch(() => {});
      await reconcileDownload(id);
    } else await processImage({ operation: "ZIP_ABORT", key: archiveKey });
  } catch (e) {
    if (pendingArchive)
      await processImage({ operation: "REVOKE", url: pendingArchive }).catch(
        () => {},
      );
    await processImage({ operation: "ZIP_ABORT", key: archiveKey }).catch(
      () => {},
    );
    await updateJob(job.id, (j) => {
      for (const i of j.items)
        if (i.state === "fetching") {
          i.state =
            j.state === "cancelled" || userCancelled(e)
              ? "cancelled"
              : "failed";
          i.error = String(e);
        }
      if (userCancelled(e)) cancellationSummary(j);
    });
  }
}
async function reconcileDownload(id: number) {
  const [download] = await chrome.downloads.search({ id });
  if (!download || download.state === "in_progress") return;
  for (const job of await getJobs()) {
    if (!job.items.some((i) => i.downloadId === id)) continue;
    const revoke: string[] = [];
    await updateJob(job.id, (j) => {
      const archive = j.archives?.find((a) => a.id === id);
      if (archive) {
        archive.state = download.state === "complete" ? "done" : "failed";
        archive.error = download.error;
        revoke.push(archive.blobUrl);
      }
      for (const i of j.items) {
        if (i.downloadId !== id) continue;
        if (i.state === "cancelled" || i.state === "done") {
          if (i.blobUrl) {
            revoke.push(i.blobUrl);
            i.blobUrl = undefined;
          }
          continue;
        }
        if (download.state === "complete") {
          i.state = "done";
          i.error = undefined;
        } else {
          i.error = download.error || "Download interrupted";
          if (j.state === "cancelled" || userCancelled(download.error))
            i.state = "cancelled";
          else if (
            !j.output.zip &&
            j.output.format === "original" &&
            i.attempts < 4 &&
            (!permanentFailure(download.error) ||
              (() => {
                const variants = candidates(i.record, j.output.quality);
                const index = variants.findIndex((v) => v.url === i.actualUrl);
                return index >= 0 && index + 1 < variants.length;
              })())
          ) {
            i.state = "queued";
            i.nextAt = Date.now() + Math.min(60000, 2000 * 2 ** i.attempts);
            i.downloadId = undefined;
          } else i.state = "failed";
        }
        if (i.blobUrl) {
          revoke.push(i.blobUrl);
          i.blobUrl = undefined;
        }
      }
      if (userCancelled(download.error) && j.state !== "cancelled")
        cancellationSummary(j);
    });
    for (const url of revoke)
      processImage({ operation: "REVOKE", url }).catch(() => {});
  }
  pump();
}
let recovery: Promise<void> | undefined;
function recover(): Promise<void> {
  return (recovery ??= recoverJobs().catch((e) => {
    recovery = undefined;
    throw e;
  }));
}
async function recoverJobs() {
  await init();
  for (const j of await getJobs()) {
    let changed = false;
    for (const i of j.items) {
      if (i.state === "fetching") {
        const recent = i.file
          ? await chrome.downloads.search({
              startedAfter: new Date(j.created - 1000).toISOString(),
              limit: 1000,
            })
          : [];
        const found = recent.find(
          (d) =>
            d.filename.replaceAll("\\", "/").endsWith(i.file!) &&
            d.state !== "interrupted",
        );
        if (found) {
          i.downloadId = found.id;
          i.state = "downloading";
        } else i.state = "queued";
        changed = true;
      }
      if (i.state === "downloading" && i.downloadId) {
        const ds = await chrome.downloads.search({ id: i.downloadId });
        if (!ds.length) {
          i.state = "failed";
          i.error = "Browser download no longer available";
          changed = true;
        }
      }
    }
    if (changed) await put("jobs", [j]);
    for (const id of new Set(
      j.items.map((i) => i.downloadId).filter((id): id is number => !!id),
    ))
      await reconcileDownload(id);
  }
  if (
    (
      await chrome.runtime.getContexts({
        documentUrls: [chrome.runtime.getURL("offscreen.html")],
      })
    ).length
  ) {
    const jobs = await getJobs();
    const retain = new Set<string>();
    for (const job of jobs) {
      for (const item of job.items)
        if (item.state === "downloading" && item.blobUrl)
          retain.add(item.blobUrl);
      for (const archive of job.archives || [])
        if (archive.state === "downloading") retain.add(archive.blobUrl);
    }
    // Include native handoffs whose browser ID was not committed before termination.
    for (const download of await chrome.downloads.search({
      state: "in_progress",
    }))
      if (download.url.startsWith(`blob:${chrome.runtime.getURL("")}`))
        retain.add(download.url);
    await processImage({ operation: "CLEANUP", retain: [...retain] });
  }
  pump();
}
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.target === "offscreen") return false;
  // Preserve the click's user activation; do not await storage before opening a panel.
  if (m?.type === "OPEN") {
    const id = trusted(s)
      ? m.tabId
      : s.id === chrome.runtime.id
        ? s.tab?.id
        : undefined;
    if (!Number.isInteger(id)) {
      reply({ error: "Untrusted or missing tab" });
      return false;
    }
    chrome.sidePanel
      .open({ tabId: id })
      .then(() => { reply(true); })
      .catch((e) => { reply({ error: String(e) }); });
    return true;
  }
  if (!m || typeof m.type !== "string") {
    reply({ error: "Invalid message" });
    return false;
  }
  (async () => {
    await recover();
    const ui = trusted(s);
    const role = senderRole(String(m.type));
    // Table-driven sender authorization; per-method refinements (frameId,
    // origin checks) still live in the individual handlers.
    if (role === "ui" && !ui)
      throw Error("This command requires the Zephyer extension page");
    if (role === "content" && ui) throw Error("Content handshake required");
    let tabId = ui ? m.tabId : s.tab?.id;
    let targetCollection: Collection | undefined;
    if (String(m.type).startsWith("COLLECTION_")) {
      if (!ui) throw Error("Gallery commands require an extension page");
      targetCollection = await requireCollection(m.collectionId);
      tabId = targetCollection.tabId;
    }
    const recordsFor = () =>
      targetCollection
        ? collectionRecords(targetCollection.id)
        : getRecords(tabId);
    const requestedRecords = async (ids: string[]) =>
      (await getRecordsByIds([...new Set(ids)])).filter((r) =>
        targetCollection
          ? r.collectionId === targetCollection.id
          : r.tabId === tabId && !r.detached,
      );
    const changed = () => {
      if (targetCollection) {
        chrome.runtime
          .sendMessage({
            type: "COLLECTION_NOTICE",
            collectionId: targetCollection.id,
          })
          .catch(() => {});
        if (targetCollection.state === "live") notify(targetCollection.tabId);
      } else notify(tabId);
    };
    if (!ui && (!s.tab || s.id !== chrome.runtime.id))
      throw Error("Untrusted sender");
    switch (m.type) {
      case "ACTIVATION_STATUS":
      case "ACTIVATION_RETRY":
        if (!ui || !Number.isInteger(tabId))
          throw Error("Extension page and valid tab required");
        if (m.type === "ACTIVATION_RETRY") {
          await activateTab(tabId);
          return true;
        }
        return (await activationStatus(tabId)) || null;
      case "CAPABILITIES":
        if (!ui && s.frameId !== 0) throw Error("Top-level action required");
        return chrome.tabs.sendMessage(
          tabId,
          { type: "CAPABILITIES" },
          { frameId: 0 },
        );
      case "VERIFY_RETRY": {
        if (
          !Array.isArray(m.ids) ||
          m.ids.length > 200 ||
          (!ui && s.frameId !== 0)
        )
          throw Error("Invalid verification retry");
        const rows =
          m.collectionId && ui
            ? await collectionRecords(
                (await requireCollection(m.collectionId)).id,
              )
            : await getRecords(tabId);
        for (const row of rows.filter(
          (r) =>
            m.ids.includes(r.id) &&
            !r.detached &&
            r.variants.some((v) => v.format === "unknown" && networkUrl(v.url)),
        )) {
          if (!powerFor(await chrome.tabs.get(row.tabId)).effectiveEnabled)
            throw Error(
              "Activate this tab and enable its website before verification",
            );
          verificationGrants.add(row.id);
          for (const key of verificationSeen)
            if (key.startsWith(row.id + ":")) verificationSeen.delete(key);
          for (const v of row.variants) clearProbe(v.url);
          scheduleVerification(row);
        }
        return true;
      }
      case "OPEN_GALLERY":
        if (!ui && s.frameId !== 0) throw Error("Top-level action required");
        if (!activatedTabs.has(tabId))
          throw Error("Click the extension icon to activate this tab");
        return serialized(`records:${tabId}`, () => openGallery(tabId));
      case "ENABLE_PHOTO_FORMATS":
        if (!ui) throw Error("Extension page required");
        return serialized("appearance-settings", async () => {
          await commitSettings({
            ...settings,
            allowedFormats: [
              ...new Set([...settings.allowedFormats, "webp", "avif"]),
            ],
          });
          return true;
        });
      case "AUTO_COLLECTION":
        if (typeof m.enabled !== "boolean" || (!ui && s.frameId !== 0))
          throw Error("Invalid automatic collection setting");
        return serialized("appearance-settings", async () => {
          await commitSettings({ ...settings, automaticCollection: m.enabled });
          return true;
        });
      case "SCAN_NOW": {
        if (!ui && s.frameId !== 0) throw Error("Top-level action required");
        if (onePass.has(tabId)) return true;
        if (!powerFor(await chrome.tabs.get(tabId)).effectiveEnabled)
          throw Error("Click the extension icon and enable this website first");
        const passToken = crypto.randomUUID();
        onePass.set(tabId, passToken);
        await publishPower(tabId);
        try {
          const frames =
            (await chrome.webNavigation.getAllFrames({ tabId })) || [];
          const results = await Promise.allSettled(
            frames.map((f) =>
              chrome.tabs.sendMessage(
                tabId,
                { type: "SCAN_NOW" },
                { frameId: f.frameId },
              ),
            ),
          );
          if (!results.some((r) => r.status === "fulfilled" && !r.value?.error))
            throw Error("No accessible frame completed discovery");
          const deadline = Date.now() + 12000;
          while (
            Date.now() < deadline &&
            (verificationControllers.has(tabId) ||
              verificationQueue.some((r) => r.tabId === tabId))
          )
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
          if (onePass.get(tabId) === passToken) onePass.delete(tabId);
          const currentTab = await chrome.tabs
            .get(tabId)
            .catch(() => undefined);
          if (!currentTab || !powerFor(currentTab).collecting) {
            for (const controller of verificationControllers.ownedBy(tabId))
              controller.abort();
            for (let i = verificationQueue.length - 1; i >= 0; i--) {
              const entry = verificationQueue[i];
              if (entry?.tabId === tabId) verificationQueue.splice(i, 1);
            }
            for (const key of verificationSeen)
              if (key.startsWith(`${tabId}:`)) verificationSeen.delete(key);
          }
          await publishPower(tabId);
        }
        return true;
      }
      case "COLLECTION_META": {
        await retainGallery(s.tab?.id, targetCollection!.id, s.url);
        const rows = await recordsFor();
        return {
          collection: targetCollection,
          settings,
          scan:
            targetCollection!.state === "live"
              ? scans.get(targetCollection!.tabId) || idleScan
              : targetCollection!.scan || idleScan,
          ids: rows.map((r) => r.id),
          changedIds: rows
            .filter((r) => (r.collectionRevision || 0) > (Number(m.since) || 0))
            .map((r) => r.id),
          jobs: (await getJobs())
            .filter((j) => j.collectionId === targetCollection!.id)
            .map((j) => ({
              ...j,
              items: j.items.map((i) => ({
                ...i,
                record: { name: i.record.name },
              })),
            })),
        };
      }
      case "COLLECTION_BATCH": {
        if (
          !Array.isArray(m.ids) ||
          m.ids.length > 200 ||
          !m.ids.every(
            (id: unknown) => typeof id === "string" && id.length < 300,
          )
        )
          throw Error("Invalid collection batch");
        return {
          records: (await getRecordsByIds(m.ids))
            .filter((r) => r.collectionId === targetCollection!.id)
            .map((r) => decorate(r, settings)),
        };
      }
      case "COLLECTION_PREVIEW": {
        const r = (await getRecordsByIds([m.id])).find(
          (r) => r.collectionId === targetCollection!.id,
        );
        if (!r || !allowedVariants(r, settings).some((v) => v.url === m.url))
          throw Error("Invalid preview source");
        const output = {
          ...defaultOutput,
          format: m.full ? "original" : "webp",
          width: m.full ? 0 : 512,
          height: m.full ? 0 : 512,
          firstFrame: true,
        } as Output;
        if (
          typeof m.requestId !== "string" ||
          m.requestId.length > 100 ||
          !s.tab?.id
        )
          throw Error("Invalid preview request");
        if (previewRequests.has(m.requestId))
          throw Error("Preview request already active");
        const token = { owner: s.tab.id, cancelled: false };
        previewRequests.set(m.requestId, token);
        try {
          let result;
          try {
            result = await processCandidate(
              r,
              m.url,
              output,
              settings.allowedFormats,
              m.requestId,
            );
          } catch (error) {
            if (token.cancelled) throw error;
            const fresh = /HTTP (401|403|404|410)/.test(String(error))
              ? await freshMedia(r, [])
              : undefined;
            const candidate = fresh?.variants.find(
              (v) =>
                !r.variants.some((old) => old.url === v.url) &&
                settings.allowedFormats.includes(v.format),
            );
            if (!fresh || !candidate || token.cancelled)
              throw Error(
                String(error) +
                  " · preview needs readable image bytes; try an original download or reopen the source",
                { cause: error },
              );
            result = await processCandidate(
              fresh,
              candidate.url,
              output,
              settings.allowedFormats,
              m.requestId,
            );
          }
          if (token.cancelled) {
            await processImage({ operation: "REVOKE", url: result.blobUrl });
            throw Error("Preview cancelled");
          }
          previewUrls.set(result.blobUrl, s.tab.id);
          return result;
        } finally {
          previewRequests.delete(m.requestId);
        }
      }
      case "PREVIEW_CANCEL": {
        if (!ui) throw Error("Invalid preview cancellation");
        const request = previewRequests.get(m.requestId);
        if (request && request.owner === s.tab?.id) {
          request.cancelled = true;
          await processImage({ operation: "CANCEL", requestId: m.requestId });
        }
        return true;
      }
      case "PREVIEW_RELEASE":
        if (!ui || previewUrls.get(m.url) !== s.tab?.id)
          throw Error("Invalid preview URL");
        previewUrls.delete(m.url);
        await processImage({ operation: "REVOKE", url: m.url });
        return true;
      case "APPEARANCE": {
        if (
          !ui ||
          !m.appearance ||
          Object.keys(m.appearance).some(
            (k) => !["theme", "dockOrientation"].includes(k),
          ) ||
          ("theme" in m.appearance && !validTheme(m.appearance.theme)) ||
          ("dockOrientation" in m.appearance &&
            !["horizontal", "vertical"].includes(m.appearance.dockOrientation))
        )
          throw Error("Invalid appearance preferences");
        return serialized("appearance-settings", async () => {
          await commitSettings({ ...settings, ...m.appearance });
          for (const t of await chrome.tabs.query({})) if (t.id) notify(t.id);
          return true;
        });
      }
      case "SITE_POWER": {
        if (
          typeof m.enabled !== "boolean" ||
          !Number.isInteger(tabId) ||
          (!ui && s.frameId !== 0)
        )
          throw Error("Invalid website power command");
        return serialized("appearance-settings", async () => {
          const tab = await chrome.tabs.get(tabId),
            power = powerFor(tab);
          if (!power.hostname) throw Error("Chrome restricts this page");
          if (!settings.enabled)
            throw Error(
              "Globally paused · enable detection in Preferences first",
            );
          const disabledSites = settings.disabledSites.filter(
            (h) => h !== power.hostname,
          );
          if (!m.enabled) disabledSites.push(power.hostname);
          await commitSettings({ ...settings, disabledSites });
          return { power: powerFor(tab), settings };
        });
      }
      case "OPEN_OPTIONS":
        await chrome.runtime.openOptionsPage();
        return true;
      case "DOCK_GET":
      case "DOCK_SAVE":
      case "DOCK_RESET": {
        if (!ui && s.frameId !== 0)
          throw Error("Only the top-level dock can change its layout");
        const topUrl = ui
          ? Number.isInteger(tabId)
            ? (await chrome.tabs.get(tabId)).url
            : undefined
          : s.tab?.url;
        let hostname = "";
        try {
          hostname = new URL(topUrl || "").hostname;
        } catch {}
        if (m.type !== "DOCK_RESET" || !m.all) {
          if (!hostname || !networkUrl(topUrl || ""))
            throw Error("Unsupported dock page");
        }
        return serialized("dock-layouts", async () => {
          const saved = await chrome.storage.local.get("dockLayouts");
          const layouts = { ...(saved["dockLayouts"] || {}) };
          if (m.type === "DOCK_GET")
            return {
              layout: validLayout(layouts[hostname]) ? layouts[hostname] : null,
            };
          if (m.type === "DOCK_SAVE") {
            if (ui || !validLayout(m.layout))
              throw Error("Invalid dock layout");
            layouts[hostname] = {
              x: m.layout.x,
              y: m.layout.y,
              state: m.layout.state,
              restoreState: m.layout.restoreState,
            };
            await chrome.storage.local.set({ dockLayouts: layouts });
            return true;
          }
          if (m.all) {
            if (!ui)
              throw Error("Reset all layouts requires the preferences page");
            await chrome.storage.local.set({ dockLayouts: {} });
            for (const tab of await chrome.tabs.query({}))
              if (tab.id)
                chrome.tabs
                  .sendMessage(
                    tab.id,
                    { type: "DOCK_LAYOUT", layout: null },
                    { frameId: 0 },
                  )
                  .catch(() => {});
          } else {
            Reflect.deleteProperty(layouts, hostname);
            await chrome.storage.local.set({ dockLayouts: layouts });
            for (const tab of await chrome.tabs.query({})) {
              try {
                if (tab.id && new URL(tab.url || "").hostname === hostname)
                  chrome.tabs
                    .sendMessage(
                      tab.id,
                      { type: "DOCK_LAYOUT", layout: null },
                      { frameId: 0 },
                    )
                    .catch(() => {});
              } catch {}
            }
          }
          return true;
        });
      }
      case "HELLO":
        if (s.frameId === 0 && s.tab?.url) sourceRoutes.set(tabId, s.tab.url);
        if (ui) throw Error("Content handshake required");
        if (activatedTabs.has(tabId))
          await serialized(`records:${tabId}`, () => ensureCollection(tabId));
        notify(tabId);
        return {
          power: powerFor(await chrome.tabs.get(tabId)),
          prefix: `${s.tab!.id}:${s.documentId || s.frameId}:`,
          settings,
        };
      case "DISCOVER": {
        if (ui || !Array.isArray(m.records) || m.records.length > 60)
          throw Error("Invalid discovery");
        const discoveryTab = await chrome.tabs.get(tabId);
        let discoveryUrl: URL | undefined;
        try {
          discoveryUrl = discoveryTab.url ? new URL(discoveryTab.url) : undefined;
        } catch {}
        if (
          !settings.instagramStoriesEnabled &&
          discoveryUrl &&
          /(^|\.)instagram\.com$/.test(discoveryUrl.hostname) &&
          discoveryUrl.pathname.startsWith("/stories/")
        )
          return;
        const discoveryPower = powerFor(discoveryTab);
        let acceptedDiscovery = false;
        await serialized(`records:${tabId}`, async () => {
          if (
            !discoveryPower.collecting ||
            !settings.enabled ||
            (powerRevisions.get(tabId) || 0) !== discoveryPower.revision ||
            (m.revision !== undefined && m.revision !== discoveryPower.revision)
          )
            return;
          const liveFrame = await chrome.webNavigation
            .getFrame({ tabId, frameId: s.frameId || 0 })
            .catch(() => null);
          if (
            !liveFrame ||
            (s.documentId &&
              (liveFrame as any).documentId &&
              s.documentId !== (liveFrame as any).documentId)
          )
            return;
          const collection = await ensureCollection(tabId);
          const existingIds = m.records
            .map((r: any) => r?.id)
            .filter((id: unknown) => typeof id === "string" && id.length < 300);
          const existing = new Map(
            (await getRecordsByIds(existingIds))
              .filter((r) => r.collectionId === collection.id && !r.detached)
              .map((r) => [r.id, r]),
          );
          const values = m.records
            .map((r: any) => recordFrom(r, s))
            .filter(Boolean) as ImageRecord[];
          for (const r of values) {
            const old = existing.get(r.id);
            r.collectionId = collection.id;
            r.discoveredOrder = old?.discoveredOrder;
            if (old) {
              r.selected = old.selected;
              r.variants = mergeVariants(old.variants, r.variants);
              r.anchored = old.anchored || r.anchored;
              r.userIncluded = old.userIncluded;
              r.signals = {
                favicon: !!(old.signals?.favicon || r.signals?.favicon),
                emoji: !!(old.signals?.emoji || r.signals?.emoji),
                interfaceAsset: !!(
                  old.signals?.interfaceAsset || r.signals?.interfaceAsset
                ),
                avatar: !!(old.signals?.avatar || r.signals?.avatar),
              };
            }
            if (eligibility(r, settings).state !== "accepted")
              r.selected = false;
          }
          await put("records", values);
          acceptedDiscovery = true;
          for (const r of values) scheduleVerification(r);
        });
        notify(tabId);
        return acceptedDiscovery;
      }
      case "RECORDS_BATCH":
        if (
          !ui ||
          !Number.isInteger(tabId) ||
          !Array.isArray(m.ids) ||
          m.ids.length > 200 ||
          !m.ids.every(
            (id: unknown) => typeof id === "string" && id.length < 300,
          )
        )
          throw Error("Invalid library batch");
        return {
          records: (await getRecordsByIds(m.ids))
            .filter((r) => r.tabId === tabId)
            .map((r) => decorate(r, settings)),
        };
      case "LIBRARY_META":
      case "SNAPSHOT": {
        if (!ui || !Number.isInteger(tabId)) throw Error("Invalid tab");
        let tab;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch {}
        return {
          ...(m.type === "LIBRARY_META"
            ? { recordIds: await getRecordIds(tabId) }
            : {
                records: (await getRecords(tabId)).map((r) =>
                  decorate(r, settings),
                ),
              }),
          jobs: (await getJobs())
            .filter((j) => j.tabId === tabId)
            .map((j) =>
              m.type === "LIBRARY_META"
                ? {
                    ...j,
                    items: j.items.map((i) => ({
                      ...i,
                      record: { name: i.record.name },
                    })),
                  }
                : j,
            ),
          scan: scans.get(tabId) || idleScan,
          selectMode: modes.get(tabId) || false,
          settings,
          power: powerFor(tab || { id: tabId }),
          url: tab?.url || "",
          error:
            tab && !networkUrl(tab.url || "")
              ? "Chrome restricts this page. Open a normal HTTP/HTTPS website."
              : undefined,
        };
      }
      case "COLLECTION_INCLUDE":
      case "INCLUDE": {
        if (!ui || typeof m.id !== "string")
          throw Error("Invalid include request");
        await serialized(`records:${tabId}`, async () => {
          const r = (await requestedRecords([m.id]))[0];
          if (!r) throw Error("Image is no longer available");
          if (!allowedVariants(r, settings).length)
            throw Error("Enable this format in Preferences first");
          r.userIncluded = true;
          await put("records", [r]);
        });
        changed();
        return true;
      }
      case "COLLECTION_SELECT":
      case "SELECT":
        if (
          !Array.isArray(m.ids) ||
          m.ids.some((v: any) => typeof v !== "string")
        )
          throw Error("Invalid selection");
        await serialized(`records:${tabId}`, async () => {
          const rs = m.ids.includes("*")
            ? await recordsFor()
            : await requestedRecords(m.ids);
          const ids = new Set(m.ids);
          const members = new Set(rs.map((r) => r.id));
          if (
            targetCollection &&
            m.ids.some(
              (id: unknown) => typeof id !== "string" || !members.has(id),
            )
          )
            throw Error("Image does not belong to this collection");
          const affected = rs.filter(
            (r) =>
              (ids.has("*") || ids.has(r.id)) &&
              (m.value === false ||
                eligibility(r, settings).state === "accepted"),
          );
          for (const r of affected)
            r.selected = typeof m.value === "boolean" ? m.value : !r.selected;
          await put("records", affected);
        });
        changed();
        return true;
      case "MODE":
        if (
          m.value &&
          scans.get(tabId)?.state === "running" &&
          ["carousel", "stories"].includes(scans.get(tabId)?.target || "")
        )
          throw Error("Pause or stop traversal before Select mode");
        if (m.value && !powerFor(await chrome.tabs.get(tabId)).effectiveEnabled)
          throw Error("Turn on this website before page selection");
        modes.set(tabId, !!m.value);
        notify(tabId);
        return true;
      case "SCAN":
        if (!ui && s.frameId !== 0)
          throw Error("Top-level scan action required");
        return serialized(`scan-command:${tabId}`, async () => {
          if (!["start", "pause", "resume", "stop"].includes(m.command))
            throw Error("Invalid scan command");
          if (["start", "resume"].includes(m.command)) {
            const tab = await chrome.tabs.get(tabId);
            if (!powerFor(tab).effectiveEnabled)
              throw Error(
                "Enable image detection for this website before scanning",
              );
          }
          if (m.command === "resume" && !sessionIds.has(tabId)) {
            m.command = "start";
            m.target = m.target || scans.get(tabId)?.target || "feed";
          }
          if (
            ["start", "resume"].includes(m.command) &&
            ["carousel", "stories"].includes(
              m.target || scans.get(tabId)?.target || "",
            ) &&
            modes.get(tabId)
          )
            throw Error("Exit Select mode before traversal");
          if (m.command === "start") {
            if (m.target && !["feed", "carousel", "stories"].includes(m.target))
              throw Error("Invalid scan target");
            if (["carousel", "stories"].includes(m.target) && modes.get(tabId))
              throw Error("Exit Select mode before traversal");
            if (
              m.target === "stories" &&
              (!settings.instagramStoriesEnabled || m.storyConsent !== true)
            )
              throw Error(
                "Enable optional Stories and confirm viewed-status notice first",
              );
          }
          if (["start", "resume"].includes(m.command)) {
            manualCollection.add(tabId);
            scanHolds.delete(tabId);
            scans.set(tabId, {
              ...(scans.get(tabId) || idleScan),
              state: "running",
            });
            await publishPower(tabId);
          }
          if (m.command === "start") {
            scans.set(tabId, {
              ...(scans.get(tabId) || idleScan),
              target: m.target || "feed",
            });
            frameScans.set(tabId, new Map());
            sessionIds.set(tabId, crypto.randomUUID());
            scanDocs.set(
              tabId,
              new Map(
                (
                  (await chrome.webNavigation.getAllFrames({ tabId })) || []
                ).map((f) => [f.frameId, (f as any).documentId || ""]),
              ),
            );
          }
          if (m.command === "stop") {
            scanHolds.delete(tabId);
            manualCollection.delete(tabId);
            sessionIds.delete(tabId);
            scanDocs.delete(tabId);
            frameScans.delete(tabId);
            scans.set(tabId, {
              ...(scans.get(tabId) || idleScan),
              state: "stopped",
              phase: "stopped",
              reason: "Scan stopped · collected images retained",
            });
            persistScans(true);
            await publishPower(tabId);
            notify(tabId);
          }
          try {
            if (m.command === "pause") scanHolds.add(tabId);
            const response = await chrome.tabs.sendMessage(tabId, {
              type: "SCAN",
              command: m.command,
              sessionId: sessionIds.get(tabId),
              target: m.target || scans.get(tabId)?.target || "feed",
              storyConsent: m.storyConsent,
              selectionMode: modes.get(tabId) || false,
            });
            if (response?.error) throw Error(response.error);
          } catch (e) {
            if (["start", "resume"].includes(m.command)) {
              manualCollection.delete(tabId);
              sessionIds.delete(tabId);
              frameScans.delete(tabId);
              scanDocs.delete(tabId);
              scans.set(tabId, {
                ...(scans.get(tabId) || idleScan),
                state: "stopped",
                phase: "stopped",
                reason: "Scan could not start · retry on an accessible webpage",
              });
              persistScans(true);
              await publishPower(tabId);
              notify(tabId);
            }
            throw e;
          }
          return true;
        });
      case "SCAN_PROGRESS": {
        return serialized(`scan:${tabId}`, async () => {
          if (ui) throw Error("Invalid scan progress");
          if (!m.scan?.sessionId || m.scan.sessionId !== sessionIds.get(tabId))
            return false;
          if (!scanDocs.get(tabId)?.has(s.frameId || 0)) return false;
          const expectedDoc = scanDocs.get(tabId)?.get(s.frameId || 0);
          if (expectedDoc && expectedDoc !== s.documentId) return false;
          if (
            !m.scan ||
            !["running", "paused", "complete", "stopped", "idle"].includes(
              m.scan.state,
            )
          )
            throw Error("Invalid scan");
          const frames =
            frameScans.get(tabId) || new Map<number, ScanSession>();
          const liveFrames = new Map(
            ((await chrome.webNavigation.getAllFrames({ tabId })) || []).map(
              (f) => [f.frameId, (f as any).documentId || ""],
            ),
          );
          for (const frame of frames.keys()) {
            const expected = scanDocs.get(tabId)?.get(frame);
            if (
              !liveFrames.has(frame) ||
              (expected &&
                liveFrames.get(frame) &&
                expected !== liveFrames.get(frame))
            ) {
              frames.delete(frame);
              scanDocs.get(tabId)?.delete(frame);
            }
          }
          if (
            m.scan.sessionId !== sessionIds.get(tabId) ||
            !scanDocs.get(tabId)?.has(s.frameId || 0)
          )
            return false;
          const previousState = scans.get(tabId)?.state;
          const runningAllowed = powerFor(
            await chrome.tabs.get(tabId),
          ).effectiveEnabled;
          frames.set(s.frameId || 0, {
            ...m.scan,
            ...(!runningAllowed && m.scan.state === "running"
              ? { state: "paused", phase: "paused" }
              : {}),
            reason: String(m.scan.reason).slice(0, 180),
          });
          frameScans.set(tabId, frames);
          const fs = [...frames.values()];
          const state = scanHolds.has(tabId)
            ? "paused"
            : fs.some((f) => f.state === "running")
              ? "running"
              : fs.some((f) => f.state === "paused")
                ? "paused"
                : fs.some((f) => f.state === "stopped")
                  ? "stopped"
                  : "complete";
          const top = frames.get(0) || m.scan;
          scans.set(tabId, {
            ...top,
            pageUrl: s.tab?.url,
            state,
            reason:
              state === "running"
                ? `${top.reason} · ${fs.filter((f) => f.state === "running").length} frames active`
                : top.reason,
          });
          const collected = await getRecords(tabId);
          if (m.scan.sessionId !== sessionIds.get(tabId)) return false;
          const summary = scans.get(tabId)!;
          summary.accepted = collected.filter(
            (r) => eligibility(r, settings).state === "accepted",
          ).length;
          summary.excluded = collected.filter(
            (r) => eligibility(r, settings).state === "excluded",
          ).length;
          summary.pending =
            collected.length - summary.accepted - summary.excluded;
          summary.count = collected.length;
          persistScans();
          if (!["running", "paused"].includes(summary.state)) {
            manualCollection.delete(tabId);
          }
          if (previousState !== summary.state) await publishPower(tabId);
          notify(tabId);
          return true;
        });
      }
      case "OFFSCREEN_IDLE":
        if (!ui || s.url !== chrome.runtime.getURL("offscreen.html"))
          throw Error("Invalid offscreen sender");
        await serialized("offscreen", async () => {
          if (!processingImages) await chrome.offscreen.closeDocument();
        });
        return true;
      case "PREFERENCES":
      case "SETTINGS": {
        if (!ui) throw Error("Settings require extension page");
        if (
          m.type === "PREFERENCES" &&
          (!m.patch ||
            Array.isArray(m.patch) ||
            typeof m.patch !== "object" ||
            Object.keys(m.patch).some((k) => !Object.hasOwn(defaults, k)))
        )
          throw Error("Invalid preference patch");
        return serialized("appearance-settings", async () => {
          const v =
            m.type === "PREFERENCES" ? { ...settings, ...m.patch } : m.settings;
          if (m.type === "PREFERENCES" && m.disabledSitesBase !== undefined) {
            if (
              !Array.isArray(m.disabledSitesBase) ||
              !m.disabledSitesBase.every(validHostname) ||
              !Array.isArray(m.patch.disabledSites)
            )
              throw Error("Invalid website rule baseline");
            v.disabledSites = mergeSiteRules(
              settings.disabledSites,
              m.disabledSitesBase,
              m.patch.disabledSites,
            );
          }
          if (v)
            for (const key of [
              "scanMinutes",
              "scanImages",
              "concurrency",
            ] as const) {
              const error = preferenceError(key, v);
              if (error) throw Error(error);
            }
          if (v && !validDownloadPreferences(v)) {
            normalizeDownloadFolder(v.downloadFolder);
            throw Error(
              "Invalid download preferences: check filename prefix and download toggles",
            );
          }
          if (
            !v ||
            !validDiscoverySettings(v) ||
            !validDownloadPreferences(v) ||
            typeof v.enabled !== "boolean" ||
            (v.instagramStoriesEnabled !== undefined &&
              typeof v.instagramStoriesEnabled !== "boolean") ||
            (v.automaticCollection !== undefined &&
              typeof v.automaticCollection !== "boolean") ||
            typeof v.alwaysVisible !== "boolean" ||
            !Array.isArray(v.disabledSites) ||
            v.disabledSites.some((s: any) => !validHostname(s)) ||
            ![v.scanMinutes, v.scanImages, v.concurrency].every(
              Number.isFinite,
            ) ||
            v.scanMinutes < 0 ||
            v.scanImages < 0 ||
            v.concurrency < 1 ||
            v.concurrency > 8 ||
            !validTheme(v.theme) ||
            !["horizontal", "vertical"].includes(v.dockOrientation)
          )
            throw Error("Invalid preferences");
          const nextSettings = {
            ...defaults,
            ...v,
            concurrency: Math.floor(v.concurrency),
            downloadFolder: normalizeDownloadFolder(v.downloadFolder),
          };
          await commitSettings(nextSettings);
          for (const t of await chrome.tabs.query({}))
            if (t.id)
              await serialized(`records:${t.id}`, async () => {
                const rs = await getRecords(t.id!);
                for (const r of rs)
                  if (eligibility(r, settings).state !== "accepted")
                    r.selected = false;
                await put("records", rs);
              });
          for (const t of await chrome.tabs.query({})) if (t.id) notify(t.id);
          pump();
          return true;
        });
      }
      case "COLLECTION_DOWNLOAD":
      case "DOWNLOAD": {
        return serialized("create-download", async () => {
          if (
            m.requestId !== undefined &&
            (typeof m.requestId !== "string" || m.requestId.length > 100)
          )
            throw Error("Invalid submission ID");
          if (m.requestId) {
            const existing = (await getJobs()).find(
              (j) =>
                j.clientRequestId === m.requestId &&
                j.tabId === tabId &&
                (!targetCollection || j.collectionId === targetCollection.id),
            );
            if (existing) return { id: existing.id };
          }
          const jobSettings = structuredClone(settings);
          if (
            !Array.isArray(m.ids) ||
            !m.ids.length ||
            !m.ids.every(
              (id: unknown) => typeof id === "string" && id.length < 300,
            )
          )
            throw Error("Select at least one valid image");
          const output = validateOutput(m.output);
          const ids = new Set(m.ids);
          const rs = (await requestedRecords(m.ids))
            .filter(
              (r) =>
                ids.has(r.id) &&
                eligibility(r, jobSettings).state === "accepted",
            )
            .map((r) => {
              const variants = allowedVariants(r, jobSettings);
              if (
                (output.quality === "displayed" &&
                  !variants.some((v) => v.url === r.displayed)) ||
                (!["best", "displayed"].includes(output.quality) &&
                  !variants.some((v) => v.url === output.quality))
              )
                throw Error(
                  "Selected quality format is disabled. Choose Best available or enable its format in Preferences.",
                );
              return {
                ...r,
                variants,
                displayed: variants.some((v) => v.url === r.displayed)
                  ? r.displayed
                  : variants[0]?.url || "",
              };
            });
          const order = new Map<string, number>(
            m.ids.map((id: string, index: number) => [id, index]),
          );
          rs.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
          if (!rs.length) throw Error("No selected images in this document");
          if (rs.length !== ids.size)
            throw Error(
              "Some requested images are unavailable or excluded; refresh your selection",
            );
          const sequenceState = await chrome.storage.local.get("sequenceNext");
          const firstSequence =
            Number.isSafeInteger(sequenceState["sequenceNext"]) &&
            sequenceState["sequenceNext"] > 0
              ? sequenceState["sequenceNext"]
              : 1;
          if (!Number.isSafeInteger(firstSequence + rs.length))
            throw Error("Sequence number limit reached");
          // Reserve before writing the job: a crash may leave a gap, but never reuses a number.
          await chrome.storage.local.set({
            sequenceNext: firstSequence + rs.length,
          });
          const first = rs[0];
          if (!first) throw Error("No eligible records in selection");
          const domain = (() => {
            try {
              return new URL(first.pageUrl).hostname;
            } catch {
              return "images";
            }
          })();
          const jobCollectionId = targetCollection?.id || first.collectionId;
          const job: DownloadJob = {
            clientRequestId: m.requestId,
            ...(jobCollectionId ? { collectionId: jobCollectionId } : {}),
            allowedFormats: [...jobSettings.allowedFormats],
            id: crypto.randomUUID(),
            tabId: targetCollection?.tabId ?? tabId,
            created: Date.now(),
            delivery: {
              saveAs: jobSettings.askWhereToSave,
              prefix: jobSettings.sequencePrefix,
            },
            folder: jobSettings.groupDownloads
              ? outputPath(
                  jobSettings.downloadFolder,
                  `${sanitize(domain)}/${new Date().toISOString().replace(/[:.]/g, "-")}`,
                )
              : jobSettings.downloadFolder,
            output: structuredClone(output),
            state: "running",
            items: rs.map((r, index) => ({
              sequence: firstSequence + index,
              id: r.id,
              record: structuredClone(r),
              state: r.variants.length ? "queued" : "failed",
              attempts: 0,
              error: r.variants.length ? undefined : r.status,
            })),
            archiveIds: [],
            zipPart: 0,
          };
          await put("jobs", [job]);
          changed();
          pump();
          return { id: job.id };
        });
      }
      case "JOB": {
        return serialized(`command:${m.id}`, async () => {
          if (!ui) throw Error("Queue controls require extension page");
          const current = (await getJobs()).find((j) => j.id === m.id);
          if (!current) throw Error("Unknown job");
          if (m.command === "resume" && current.state !== "paused")
            throw Error("Only paused jobs can be resumed");
          if (m.command === "pause" && current.state !== "running")
            throw Error("Only running jobs can be paused");
          if (m.command === "retry" && current.state === "cancelled")
            throw Error(
              "Cancelled jobs cannot be retried; create a new download",
            );
          if (
            m.command === "retry" &&
            !current.items.some((i) => i.state === "failed")
          )
            throw Error("No failed files to retry");
          if (m.command === "cancel") {
            await updateJob(current.id, (j) => {
              j.state = "cancelled";
              for (const i of j.items)
                if (i.state !== "done" && i.state !== "failed")
                  i.state = "cancelled";
            });
            for (const id of new Set(
              current.items
                .map((i) => i.downloadId)
                .filter((v): v is number => !!v),
            ))
              chrome.downloads.cancel(id).catch(() => {});
          } else if (m.command === "pause") {
            await updateJob(current.id, (j) => {
              j.state = "paused";
            });
            for (const id of new Set(
              current.items
                .filter((i) => i.state === "downloading")
                .map((i) => i.downloadId)
                .filter((v): v is number => !!v),
            ))
              chrome.downloads.pause(id).catch(() => {});
          } else if (m.command === "resume" || m.command === "retry") {
            await updateJob(current.id, (j) => {
              j.state = "running";
              if (m.command === "retry")
                for (const i of j.items)
                  if (i.state === "failed") {
                    i.state = "queued";
                    i.attempts = 0;
                    i.nextAt = 0;
                    i.downloadId = undefined;
                  }
            });
            for (const id of new Set(
              current.items
                .filter((i) => i.state === "downloading")
                .map((i) => i.downloadId)
                .filter((v): v is number => !!v),
            ))
              chrome.downloads.resume(id).catch(() => {});
            pump();
          } else throw Error("Invalid queue command");
          return true;
        });
      }
      default:
        throw Error("Unsupported message");
    }
  })()
    .then(reply)
    .catch((e) => { reply({ error: e instanceof Error ? e.message : String(e) }); });
  return true;
});
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state || delta.error)
    void recover()
      .then(() => reconcileDownload(delta.id))
      .catch(console.error);
});
async function clear(tabId: number, resetPage = true) {
  releaseTab(tabId);
  await init();
  powerRevisions.set(tabId, (powerRevisions.get(tabId) || 0) + 1);
  await serialized(`records:${tabId}`, async () => {
    await detach(tabId);
    await removeTab(tabId);
  });
  await serialized("scan-recovery", () =>
    chrome.storage.local.set({ scanRecovery: Object.fromEntries(scans) }),
  );
  if (resetPage)
    chrome.tabs.sendMessage(tabId, { type: "RESET" }).catch(() => {});
  notify(tabId);
}
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) {
    sourceRoutes.set(d.tabId, d.url);
    releasePreviews(d.tabId);
    void init().then(() => galleryNavigated(d.tabId, d.url));
    void clear(d.tabId, false);
  }
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  const previous = sourceRoutes.get(d.tabId);
  sourceRoutes.set(d.tabId, d.url);
  if (
    previous &&
    socialDocumentKey(previous) &&
    socialDocumentKey(previous) === socialDocumentKey(d.url)
  ) {
    chrome.tabs
      .sendMessage(d.tabId, { type: "ROUTE_UPDATE" }, { frameId: 0 })
      .catch(() => {});
    notify(d.tabId);
  } else void clear(d.tabId);
});
chrome.tabs.onRemoved.addListener((id) => {
  releaseTab(id);
  void init().then(() =>
    serialized(`records:${id}`, async () => {
      await closeTab(id);
      await removeTab(id);
    }),
  );
  void serialized("scan-recovery", () =>
    chrome.storage.local.set({ scanRecovery: Object.fromEntries(scans) }),
  );
});
chrome.runtime.onInstalled.addListener(async () => {
  await init();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({
      id: "zephyer-library",
      title: "Open Zephyer image library",
      contexts: ["image", "page"],
    }),
  );
  await chrome.alarms.create("zephyer-recover", { periodInMinutes: 1 });
});
chrome.contextMenus.onClicked.addListener((i, t) => {
  if (i.menuItemId === "zephyer-library" && t?.id)
    void chrome.sidePanel.open({ tabId: t.id });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "zephyer-recover") return;
  pump();
  void getJobs().then((jobs) =>
    Promise.all(
      jobs
        .flatMap((j) => j.items)
        .filter((i) => i.state === "downloading" && i.downloadId)
        .map((i) => reconcileDownload(i.downloadId!)),
    ),
  );
});
chrome.runtime.onStartup.addListener(() => {
  // Chrome can drop alarms across browser restarts; re-create before recovering.
  void chrome.alarms.create("zephyer-recover", { periodInMinutes: 1 });
  void recover();
});
void recover();

async function publishPower(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (tab)
    await chrome.tabs
      .sendMessage(tabId, {
        type: "POWER_STATE",
        settings,
        power: powerFor(tab),
      })
      .catch(() => {});
}
export async function activateTab(tabId: number) {
  await recover();
  return activateReliably(tabId, async () => {
    const tab = await chrome.tabs.get(tabId);
    if (!networkUrl(tab.url || "")) throw Error("Chrome restricts this page");
    const wasActive = activatedTabs.has(tabId);
    await activate(tabId);
    if (!wasActive)
      powerRevisions.set(tabId, (powerRevisions.get(tabId) || 0) + 1);
    await serialized(`records:${tabId}`, () => ensureCollection(tabId));
    await publishPower(tabId);
    notify(tabId);
  });
}
chrome.action.onClicked.addListener((tab) => {
  if (tab.id)
    void activateTab(tab.id).catch(() => showTroubleshooting(tab.id!));
});

function releasePreviews(tabId: number) {
  for (const [id, request] of previewRequests)
    if (request.owner === tabId) {
      request.cancelled = true;
      void processImage({ operation: "CANCEL", requestId: id }).catch(() => {});
    }
  for (const [url, owner] of previewUrls)
    if (owner === tabId) {
      previewUrls.delete(url);
      void processImage({ operation: "REVOKE", url }).catch(() => {});
    }
}

// Worker-local entry point shared by the toolbar listener and browser harness. Not exposed to webpages.
Object.assign(globalThis, { activateZephyerTab: activateTab });
