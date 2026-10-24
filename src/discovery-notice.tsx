import React, { useRef, useState } from "react";
import { rpc, type ImageRecord, type Settings } from "./shared";
export function DiscoveryNotice({
  records,
  settings,
  tabId,
  collectionId,
  onError,
}: {
  records: ImageRecord[];
  settings: Settings;
  tabId?: number;
  collectionId?: string;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const formats = ["webp", "avif"].filter(
    (f) =>
      !settings.allowedFormats.includes(f) &&
      records.some((r) => r.variants.some((v) => v.format === f)),
  );
  const unknown = records.filter((r) => r.eligibility?.state === "pending");
  async function run(message: object) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      await rpc(message as any);
    } catch (e) {
      onError(String(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  if (!formats.length && !unknown.length) return null;
  return (
    <section className="discovery-notice" aria-label="Discovery help">
      {!!formats.length && (
        <>
          <p>
            Some photos use {formats.map((f) => f.toUpperCase()).join(" / ")}.
            Enabling these formats changes discovery on all websites; download
            conversion is separate.
          </p>
          <button
            disabled={busy}
            onClick={() => void run({ type: "ENABLE_PHOTO_FORMATS" })}
          >
            Enable WebP/AVIF
          </button>
        </>
      )}
      {!!unknown.length && (
        <>
          <p>
            {unknown.length} images await format verification. Network or access
            restrictions can prevent verification.
          </p>
          {unknown.some((r) => r.variants.some((v) => v.probeError)) && (
            <p>
              {
                unknown
                  .find((r) => r.variants.some((v) => v.probeError))
                  ?.variants.find((v) => v.probeError)?.probeError
              }
            </p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run({
                type: "VERIFY_RETRY",
                tabId,
                collectionId,
                ids: unknown.slice(0, 200).map((r) => r.id),
              })
            }
          >
            Retry verification{unknown.length > 200 ? " (first 200)" : ""}
          </button>
        </>
      )}
    </section>
  );
}
