import { rpc, type ImageRecord, type Settings, candidates } from "./shared";
import { allowedVariants } from "./discovery";
let active = 0;
const queue: (() => void)[] = [];
const owned = new Set<string>();
function drain() {
  while (active < 2 && queue.length) queue.shift()!();
}
export function releasePreview(url: string) {
  if (owned.delete(url))
    void rpc({ type: "PREVIEW_RELEASE", url }).catch(() => {});
}
addEventListener("pagehide", () => {
  for (const url of [...owned]) releasePreview(url);
});
export function preview(
  record: ImageRecord,
  collectionId: string,
  settings: Settings,
  full: boolean,
  quality: string,
  signal: AbortSignal,
): Promise<{ url: string; fallback: boolean }> {
  return new Promise((resolve, reject) => {
    const abortQueued = () => {
      const index = queue.indexOf(work);
      if (index >= 0) {
        queue.splice(index, 1);
        reject(new DOMException("Cancelled", "AbortError"));
      }
    };
    const work = () => {
      signal.removeEventListener("abort", abortQueued);
      if (signal.aborted) {
        reject(new DOMException("Cancelled", "AbortError"));
        drain();
        return;
      }
      active++;
      const requestId = crypto.randomUUID();
      const cancel = () =>
        void rpc({ type: "PREVIEW_CANCEL", requestId }).catch(() => {});
      signal.addEventListener("abort", cancel, { once: true });
      void (async () => {
        const variants = allowedVariants(record, settings);
        const ordered = full
          ? candidates({ ...record, variants }, quality)
          : [...variants].sort((a, b) => {
              const score = (v: typeof a) =>
                v.url === record.displayed
                  ? 0
                  : v.width && v.width >= 320
                    ? v.width
                    : 1e6;
              return score(a) - score(b);
            });
        let failure = "Preview unavailable";
        for (let i = 0; i < Math.min(3, ordered.length); i++) {
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const candidate = ordered[i];
          if (!candidate) break;
          try {
            const r = await rpc<{ blobUrl: string }>({
              type: "COLLECTION_PREVIEW",
              collectionId,
              id: record.id,
              url: candidate.url,
              full,
              requestId,
            });
            owned.add(r.blobUrl);
            if (signal.aborted) {
              releasePreview(r.blobUrl);
              throw new DOMException("Cancelled", "AbortError");
            }
            resolve({ url: r.blobUrl, fallback: i > 0 });
            return;
          } catch (e) {
            failure = String(e);
          }
        }
        throw Error(failure);
      })()
        .catch(reject)
        .finally(() => {
          signal.removeEventListener("abort", cancel);
          active--;
          drain();
        });
    };
    signal.addEventListener("abort", abortQueued, { once: true });
    queue.push(work);
    drain();
  });
}
