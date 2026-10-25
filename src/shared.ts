// Theme ids live here so the settings contract does not depend on the
// presentation layer; appearance.ts owns the palettes keyed by these ids.
export const themeIdList = [
  "graphite",
  "porcelain",
  "midnight",
  "forest",
  "dusk",
  "sand",
] as const;
export type ThemeId = (typeof themeIdList)[number];
export type Eligibility = {
  state: "accepted" | "excluded" | "pending";
  reasons: string[];
};
export type ScanTarget = "feed" | "carousel" | "stories";export type MediaContext = {
  platform: "instagram" | "facebook" | "x" | "pinterest";
  contentId: string;
  slideId: string;
  kind: "photo" | "avatar" | "story";
};
export type SiteCapability = {
  platform: MediaContext["platform"] | "generic";
  page:
    "feed" | "profile" | "post" | "carousel" | "viewer" | "stories" | "blocked";
  targets: ScanTarget[];
};
export type ActivationStatus = {
  tabId: number;
  documentId?: string;
  stage:
    "checking" | "injecting" | "initializing" | "mounting" | "ready" | "failed";
  category?:
    | "access-withheld"
    | "restricted"
    | "missing-receiver"
    | "initialization"
    | "navigation"
    | "rendering"
    | undefined;
  detail: string;
  updated: number;
};
export type RetrievalAttempt = {
  strategy: "probe" | "extension" | "page" | "native" | "refresh";
  url: string;
  status?: number;
  result: string;
  at: number;
};
export type DockLayout = {
  x: number;
  y: number;
  state: "compact" | "expanded" | "minimized";
  restoreState: "compact" | "expanded";
};
export type Variant = {
  url: string;
  width: number;
  height: number;
  format: string;
  method: string;
  verified: boolean;
  bytes?: number | undefined;
  probeError?: string | undefined;
};
export type Collection = {
  id: string;
  epoch: string;
  tabId: number;
  documentId: string;
  url: string;
  title: string;
  state: "live" | "detached";
  revision: number;
  nextOrder: number;
  scan?: ScanSession | undefined;
};
export type ImageRecord = {
  media?: MediaContext | undefined;
  collectionId?: string;
  collectionRevision?: number;
  discoveredOrder?: number | undefined;
  detached?: boolean;
  eligibility?: Eligibility;
  userIncluded?: boolean | undefined;
  signals?: {
    interfaceAsset: boolean;
    avatar: boolean;
    favicon?: boolean;
    emoji?: boolean;
  };
  id: string;
  tabId: number;
  documentId: string;
  frameId: number;
  pageUrl: string;
  source: string;
  name: string;
  variants: Variant[];
  displayed: string;
  width: number;
  height: number;
  selected: boolean;
  status: string;
  anchored: boolean;
  updated: number;
};
export type Settings = {
  instagramStoriesEnabled: boolean;
  automaticCollection: boolean;
  downloadFolder: string;
  groupDownloads: boolean;
  askWhereToSave: boolean;
  sequencePrefix: string;
  allowedFormats: string[];
  smartCleanup: boolean;
  hideSmall: boolean;
  hideBranding: boolean;
  hideAvatars: boolean;
  minImageSize: number;
  showUpcoming: boolean;
  enabled: boolean;
  disabledSites: string[];
  alwaysVisible: boolean;
  scanMinutes: number;
  scanImages: number;
  concurrency: number;
  theme: ThemeId;
  dockOrientation: "horizontal" | "vertical";
};
export const defaults: Settings = {
  instagramStoriesEnabled: false,
  automaticCollection: true,
  downloadFolder: "Zephyer",
  groupDownloads: true,
  askWhereToSave: false,
  sequencePrefix: "",
  allowedFormats: ["jpeg", "png"],
  smartCleanup: true,
  hideSmall: true,
  hideBranding: true,
  hideAvatars: false,
  minImageSize: 96,
  showUpcoming: true,
  enabled: true,
  disabledSites: [],
  alwaysVisible: false,
  scanMinutes: 10,
  scanImages: 10000,
  concurrency: 4,
  theme: "graphite",
  dockOrientation: "horizontal",
};
export type Output = {
  // "best" and "displayed" are conventional values; a job may also pin an
  // explicit variant URL, so the type is a plain string.
  quality: string;
  format: "original" | "jpeg" | "png" | "webp";
  width: number;
  height: number;
  qualityValue: number;
  upscale: boolean;
  background: string;
  firstFrame: boolean;
  zip: boolean;
};
export const defaultOutput: Output = {
  quality: "best",
  format: "original",
  width: 0,
  height: 0,
  qualityValue: 0.92,
  upscale: false,
  background: "#ffffff",
  firstFrame: false,
  zip: false,
};
export type ItemState =
  "queued" | "fetching" | "downloading" | "done" | "failed" | "cancelled";
export type JobItem = {
  refreshAttempted?: boolean;
  retrieval?: RetrievalAttempt[];
  sequence?: number;
  id: string;
  record: ImageRecord;
  state: ItemState;
  attempts: number;
  downloadId?: number | undefined;
  actualUrl?: string | undefined;
  fallback?: boolean;
  error?: string | undefined;
  file?: string;
  blobUrl?: string | undefined;
  nextAt?: number | undefined;
};
export type DownloadJob = {
  clientRequestId?: string;
  collectionId?: string;
  delivery?: { saveAs: boolean; prefix: string };
  allowedFormats?: string[];
  id: string;
  tabId: number;
  created: number;
  folder: string;
  output: Output;
  state: "running" | "paused" | "cancelled" | "done";
  items: JobItem[];
  archiveIds: number[];
  archives?: {
    id: number;
    itemIds: string[];
    blobUrl: string;
    state: "downloading" | "done" | "failed";
    error?: string | undefined;
  }[];
  zipPart: number;
  summary?: string;
};
export type ScanSession = {
  target?: ScanTarget;
  skipped?: number;
  pageUrl?: string;
  sessionId?: string;
  phase?: "scanning" | "waiting" | "paused" | "complete" | "stopped";
  accepted?: number;
  excluded?: number;
  pending?: number;
  state: "idle" | "running" | "paused" | "stopped" | "complete";
  reason: string;
  count: number;
  steps: number;
  started: number;
};
export type Snapshot = {
  power: PagePowerState;
  records: ImageRecord[];
  jobs: DownloadJob[];
  scan: ScanSession;
  selectMode: boolean;
  settings: Settings;
  url: string;
  error?: string;
};
export type PagePowerState = {
  collectionId?: string;
  activated: boolean;
  collecting: boolean;
  hostname: string;
  globalEnabled: boolean;
  siteEnabled: boolean;
  effectiveEnabled: boolean;
  reason: "on" | "site-off" | "global-off" | "restricted" | "inactive";
  revision: number;
  epoch: string;
};
// UI transport omits the immutable source snapshots already owned by the queue.
export type QueueView = Omit<DownloadJob, "items"> & {
  items: (Omit<JobItem, "record"> & { record: Pick<ImageRecord, "name"> })[];
};
export type LibrarySnapshot = Omit<Snapshot, "jobs"> & { jobs: QueueView[] };
export type LibraryMetadata = Omit<LibrarySnapshot, "records"> & {
  recordIds: string[];
};
export const idleScan: ScanSession = {
  state: "idle",
  reason: "Ready to scan",
  count: 0,
  steps: 0,
  started: 0,
};
export type ScanCommand = "start" | "pause" | "resume" | "stop";
export type Message =
  | { type: "ENABLE_PHOTO_FORMATS" }
  | { type: "PING" }
  | { type: "ACTIVATION_STATUS"; tabId: number }
  | { type: "ACTIVATION_RETRY"; tabId: number }
  | { type: "CAPABILITIES"; tabId?: number }
  | {
      type: "VERIFY_RETRY";
      tabId?: number;
      collectionId?: string;
      ids: string[];
    }
  | { type: "OPEN_GALLERY"; tabId?: number }
  | { type: "AUTO_COLLECTION"; enabled: boolean }
  | { type: "SCAN_NOW"; tabId?: number }
  | { type: "COLLECTION_META"; collectionId: string; since?: number }
  | { type: "COLLECTION_BATCH"; collectionId: string; ids: string[] }
  | {
      type: "COLLECTION_SELECT";
      collectionId: string;
      ids: string[];
      value?: boolean;
    }
  | { type: "COLLECTION_INCLUDE"; collectionId: string; id: string }
  | {
      type: "COLLECTION_DOWNLOAD";
      collectionId: string;
      ids: string[];
      output: Output;
    }
  | {
      type: "COLLECTION_PREVIEW";
      collectionId: string;
      id: string;
      url: string;
      full?: boolean;
      requestId: string;
    }
  | { type: "PREVIEW_RELEASE"; url: string }
  | { type: "PREVIEW_CANCEL"; requestId: string }
  | {
      type: "PREFERENCES";
      patch: Partial<Settings>;
      disabledSitesBase?: string[];
    }
  | { type: "SITE_POWER"; enabled: boolean; tabId?: number }
  | { type: "INCLUDE"; tabId: number; id: string }
  | { type: "HELLO" }
  | {
      type: "APPEARANCE";
      appearance: {
        theme?: ThemeId;
        dockOrientation?: "horizontal" | "vertical";
      };
    }
  | { type: "DOCK_GET"; tabId?: number }
  | { type: "DOCK_SAVE"; layout: DockLayout }
  | { type: "DOCK_RESET"; all?: boolean; tabId?: number }
  | { type: "OPEN_OPTIONS" }
  | { type: "DISCOVER"; records: ImageRecord[]; revision?: number }
  | { type: "SNAPSHOT"; tabId: number }
  | { type: "LIBRARY_META"; tabId: number }
  | { type: "RECORDS_BATCH"; tabId: number; ids: string[] }
  | { type: "SELECT"; ids: string[]; value?: boolean; tabId?: number }
  | { type: "MODE"; value: boolean; tabId?: number }
  | {
      type: "SCAN";
      command: ScanCommand;
      tabId?: number;
      target?: ScanTarget;
      storyConsent?: boolean;
    }
  | { type: "SCAN_PROGRESS"; scan: ScanSession }
  | { type: "DOWNLOAD"; ids: string[]; output: Output; tabId?: number }
  | {
      type: "JOB";
      id: string;
      command: "pause" | "resume" | "cancel" | "retry";
    }
  | { type: "OPEN" }
  | { type: "SETTINGS"; settings: Settings }
  | { type: "PAGE_BYTES"; url: string }
  | { type: "NOTICE" }
  | { type: "RESET" }
  | {
      type: "UI_STATE";
      power: PagePowerState;
      ids: string[];
      count: number;
      mode: boolean;
      scan: ScanSession;
      settings: Settings;
    };
/**
 * Typed protocol registry. `Message` above is the wire union; this table
 * declares, per message type, which sender role may send it. The registry is
 * the single source of truth for authorization — the background router reads
 * it at startup (senderRole), and the protocol exhaustive test verifies the
 * table matches the actual Message members exactly.
 */
export type SenderRole = "ui" | "content" | "any";
export const protocolRegistry = {
  ENABLE_PHOTO_FORMATS: "ui",
  PING: "any",
  ACTIVATION_STATUS: "ui",
  ACTIVATION_RETRY: "ui",
  CAPABILITIES: "content",
  VERIFY_RETRY: "ui",
  OPEN_GALLERY: "any",
  AUTO_COLLECTION: "ui",
  SCAN_NOW: "any",
  COLLECTION_META: "ui",
  COLLECTION_BATCH: "ui",
  COLLECTION_SELECT: "ui",
  COLLECTION_INCLUDE: "ui",
  COLLECTION_DOWNLOAD: "ui",
  COLLECTION_PREVIEW: "ui",
  PREVIEW_RELEASE: "ui",
  PREVIEW_CANCEL: "ui",
  PREFERENCES: "ui",
  SITE_POWER: "any",
  INCLUDE: "ui",
  HELLO: "content",
  APPEARANCE: "ui",
  DOCK_GET: "any",
  DOCK_SAVE: "any",
  DOCK_RESET: "any",
  OPEN_OPTIONS: "content",
  DISCOVER: "content",
  SNAPSHOT: "ui",
  LIBRARY_META: "ui",
  RECORDS_BATCH: "ui",
  SELECT: "any",
  MODE: "any",
  SCAN: "any",
  SCAN_PROGRESS: "content",
  DOWNLOAD: "any",
  JOB: "ui",
  OPEN: "ui",
  SETTINGS: "ui",
  PAGE_BYTES: "any",
  NOTICE: "any",
  RESET: "any",
  UI_STATE: "any",
} as const satisfies Record<Message["type"], SenderRole>;
export const senderRole = (type: string): SenderRole | undefined =>
  protocolRegistry[type as Message["type"]];
/**
 * Structured download-pipeline failures. Retry logic must branch on `kind`
 * (failureKind / permanentFailure / userCancelled), never on message text —
 * string matching is only permitted inside failureKind as the fallback for
 * bare Chromium `chrome.downloads` error strings, which arrive as text.
 */
export type FailureKind =
  | "permanent"
  | "cancelled"
  | "rate-limited"
  | "transient";
export class DownloadFailure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DownloadFailure";
    this.kind = kind;
  }
}
export const failureKind = (e: unknown): FailureKind => {
  if (e instanceof DownloadFailure) return e.kind;
  const s = String(e);
  if (/USER_CANCEL(?:L)?ED|user cancel(?:l)?ed|download cancel(?:l)?ed/i.test(s))
    return "cancelled";
  if (
    /HTTP (401|403)|SERVER_UNAUTHORIZED|SERVER_FORBIDDEN|requires .*conversion|exceeds|Invalid|Not an image|not a decodable|encoder unavailable|No .*candidates|No eligible format|Conversion failed/i.test(
      s,
    )
  )
    return "permanent";
  return "transient";
};
export const permanentFailure = (e: unknown) => failureKind(e) === "permanent";
export const userCancelled = (e: unknown) => failureKind(e) === "cancelled";

export const safeUrl = (url: string) => {
  try {
    return ["https:", "http:", "data:", "blob:"].includes(
      new URL(url).protocol,
    );
  } catch {
    return false;
  }
};
export const networkUrl = (url: string) => /^https?:\/\//i.test(url);
export const MAX_INLINE_URL = 8 * 1024 * 1024;
export function hash(s: string) {
  let h = 2166136261,
    second = 3339675911;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    second = Math.imul(second ^ s.charCodeAt(i), 2246822519);
  }
  return `${(h >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
export function absolute(raw: string, base: string) {
  if (!raw.trim()) return "";
  try {
    const u = new URL(raw, base);
    u.hash = "";
    return safeUrl(u.href) ? u.href : "";
  } catch {
    return "";
  }
}
export function formatOf(url: string) {
  if (url.startsWith("data:"))
    return (/^data:image\/([^;,]+)/.exec(url))?.[1] || "unknown";
  try {
    return (
      (/\.(avif|webp|png|jpe?g|gif|svg|bmp|ico|tiff?)$/i.exec(new URL(url).pathname))?.[1]
        ?.toLowerCase()
        .replace("jpg", "jpeg") || "unknown"
    );
  } catch {
    return "unknown";
  }
}
export function variant(
  url: string,
  method: string,
  width = 0,
  height = 0,
  verified = false,
): Variant {
  return { url, method, width, height, verified, format: formatOf(url) };
}
export function mergeVariants(a: Variant[], b: Variant[]) {
  const m = new Map(a.map((v) => [v.url, v]));
  for (const v of b) {
    const old = m.get(v.url);
    m.set(
      v.url,
      old
        ? {
            ...old,
            ...v,
            width: Math.max(old.width, v.width),
            height: Math.max(old.height, v.height),
            verified: old.verified || v.verified,
            format: v.method.includes("verified MIME")
              ? v.format
              : old.method.includes("verified MIME")
                ? old.format
                : v.format,
            method: v.method.includes("verified MIME")
              ? v.method
              : old.method.includes("verified MIME")
                ? old.method
                : v.method,
            bytes: v.bytes ?? old.bytes,
          }
        : v,
    );
  }
  return [...m.values()].slice(0, 80);
}
export function candidates(r: ImageRecord, q: string) {
  const vs = [...r.variants];
  const ratio = r.width && r.height ? r.height / r.width : 1;
  const score = (v: Variant) => v.width * v.height || v.width * v.width * ratio;
  vs.sort((a, b) => score(b) - score(a));
  if (q === "displayed")
    vs.sort(
      (a, b) => Number(b.url === r.displayed) - Number(a.url === r.displayed),
    );
  else if (q !== "best")
    vs.sort((a, b) => Number(b.url === q) - Number(a.url === q));
  return vs;
}
export function sanitize(s: string) {
  return (
    s
      // Control characters are deliberately stripped from filenames.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/, "")
      .replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i, "_$1$2")
      .slice(0, 110) || "image"
  );
}
export function filename(r: ImageRecord, index: number, fmt?: string) {
  let n = "image";
  try {
    n = decodeURIComponent(
      new URL(r.displayed).pathname.split("/").pop() || "image",
    );
  } catch {}
  n = sanitize(n.replace(/\.[a-z0-9]{1,5}$/i, ""));
  const ext = (fmt || formatOf(r.displayed))
    .replace("jpeg", "jpg")
    .replace("svg+xml", "svg");
  return `${String(index + 1).padStart(4, "0")}-${n}.${/^(jpg|png|webp|gif|svg|avif|bmp|ico|tiff?)$/.test(ext) ? ext : "img"}`;
}
export function resized(
  w: number,
  h: number,
  maxW: number,
  maxH: number,
  upscale = false,
) {
  const ratios = [maxW ? maxW / w : Infinity, maxH ? maxH / h : Infinity];
  let scale = Math.min(...ratios);
  if (!Number.isFinite(scale)) scale = 1;
  if (!upscale) scale = Math.min(1, scale);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
export function filterRecords(
  rs: ImageRecord[],
  query: string,
  min: number,
  fmt: string,
) {
  const q = query.toLowerCase();
  return rs.filter(
    (r) =>
      (!q ||
        `${r.name} ${r.source} ${r.displayed}`.toLowerCase().includes(q)) &&
      Math.max(r.width, ...r.variants.map((v) => v.width)) >= min &&
      (!fmt || r.variants.some((v) => v.format === fmt)),
  );
}
export async function rpc<T = any>(message: Message): Promise<T> {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error && !Array.isArray(result.records))
    throw new Error(result.error);
  return result;
}

export const ARCHIVE_LIMIT = 250 * 1024 * 1024;
export const archiveFits = (current: number, next: number) =>
  current + next <= ARCHIVE_LIMIT;

export async function boundedBlob(
  response: Response,
  limit: number,
): Promise<Blob> {
  if (Number(response.headers.get("Content-Length") || 0) > limit) {
    await response.body?.cancel().catch(() => {});
    throw Error(`Image transfer exceeds ${Math.round(limit / 1024 / 1024)} MB`);
  }
  const reader = response.body?.getReader();
  if (!reader)
    return new Blob([], { type: response.headers.get("Content-Type") || "" });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => {});
        throw Error(
          `Image transfer exceeds ${Math.round(limit / 1024 / 1024)} MB`,
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("Content-Type") || "" });
}
