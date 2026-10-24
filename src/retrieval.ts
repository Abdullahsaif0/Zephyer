import { boundedBlob, type RetrievalAttempt } from "./shared";
import { imageFormats, normalizedFormat, sniffImage } from "./discovery";
type Probe = {
  format: string;
  bytes?: number;
  error?: string;
  attempt: RetrievalAttempt;
};
const cache = new Map<string, { until: number; value: Probe }>();
const cooldowns = new Map<string, number>();
function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "local";
  }
}
function backoff(url: string, response: Response) {
  if (response.status !== 429 && response.status !== 503) return;
  const raw = response.headers.get("retry-after") || "";
  const seconds = Number(raw);
  const delay =
    raw && Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(raw) - Date.now();
  cooldowns.set(
    host(url),
    Date.now() +
      Math.max(1000, Math.min(60000, Number.isFinite(delay) ? delay : 5000)),
  );
}
function checkCooldown(url: string) {
  if ((cooldowns.get(host(url)) || 0) > Date.now())
    throw Error("HTTP 429 · host backoff active");
}
const isImage = (f: string) => imageFormats.includes(f as any);
export function clearProbe(url: string) {
  cache.delete(url);
}
export async function probeImage(
  url: string,
  signal?: AbortSignal,
): Promise<Probe> {
  const saved = cache.get(url);
  if (saved && saved.until > Date.now()) return saved.value;
  const attempt: RetrievalAttempt = {
    strategy: "probe",
    url,
    at: Date.now(),
    result: "Unverified",
  };
  let format = "unknown",
    bytes: number | undefined;
  try {
    checkCooldown(url);
    const options = () => ({
      credentials: "include" as const,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
    });
    try {
      const head = await fetch(url, { ...options(), method: "HEAD" });
      attempt.status = head.status;
      backoff(url, head);
      if (head.ok) {
        const f = normalizedFormat(head.headers.get("content-type") || "");
        if (isImage(f)) format = f;
        const size = Number(head.headers.get("content-length"));
        if (size > 0 && Number.isFinite(size)) bytes = size;
      }
    } catch {
      /* Unsupported HEAD is inconclusive. */
    }
    if (format === "unknown" && !signal?.aborted) {
      checkCooldown(url);
      const response = await fetch(url, {
        ...options(),
        headers: { Range: "bytes=0-4095" },
      });
      attempt.status = response.status;
      backoff(url, response);
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      const chunks: number[] = [];
      if (reader)
        try {
          while (chunks.length < 4096) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(...value.slice(0, 4096 - chunks.length));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      format = sniffImage(new Uint8Array(chunks));
    }
    attempt.result = isImage(format)
      ? `Verified ${format}`
      : "Response was not a recognized image";
  } catch (error) {
    if (String(error).includes('host backoff')) attempt.status = 429;
    attempt.result = signal?.aborted
      ? "Verification cancelled"
      : attempt.status
        ? `HTTP ${attempt.status} · verification unavailable`
        : "Network request failed · access, connectivity or browser policy may be responsible";
  }
  const value = {
    format,
    bytes,
    error: isImage(format) ? undefined : attempt.result,
    attempt,
  };
  if (!signal?.aborted && ![429, 503].includes(attempt.status || 0)) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(url, {
      until: Date.now() + (format === "unknown" ? 15000 : 300000),
      value,
    });
  }
  return value;
}
export async function fetchImageBytes(
  url: string,
  limit: number,
  signal?: AbortSignal,
) {
  checkCooldown(url);
  const response = await fetch(url, {
    credentials: "include",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  });
  backoff(url, response);
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`HTTP ${response.status} · byte retrieval failed`);
  }
  return boundedBlob(response, limit);
}
