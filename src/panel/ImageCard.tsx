import React, { useEffect, useState } from "react";
import { Icon } from "../appearance-react";
import { allowedVariants } from "../discovery";
import type { ImageRecord, Settings } from "../shared";

export function ImageCard({
  record: r,
  settings,
  onSelect,
  onDownload,
  onInclude,
  canInclude,
}: {
  record: ImageRecord;
  settings: Settings;
  onSelect: () => void;
  onDownload: () => void;
  onInclude: () => void;
  canInclude: boolean;
}) {
  const review = !!r.eligibility && r.eligibility.state !== "accepted";
  const variants = review ? r.variants : allowedVariants(r, settings);
  const previewUrl = variants.some((v) => v.url === r.displayed)
    ? r.displayed
    : variants[0]?.url || "";
  const best = [...variants].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  )[0];
  const [broken, setBroken] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    setBroken(false);
    setPreview(false);
  }, [r.id, previewUrl]);
  return (
    <article className={`image-card ${r.selected ? "chosen" : ""}`}>
      <button
        className="preview"
        aria-label={`${review ? "Preview" : "Select"} ${r.name || "image"}`}
        aria-pressed={review ? undefined : r.selected}
        onClick={
          review
            ? () => {
                setPreview(true);
              }
            : onSelect
        }
      >
        {previewUrl && !broken && (!review || preview) ? (
          <img
            src={previewUrl}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              setBroken(true);
            }}
          />
        ) : (
          <span className="unavailable">
            {review && !preview ? "Click to preview" : "Preview unavailable"}
          </span>
        )}
        <span className="checkbox">
          {r.selected ? <Icon name="check" /> : null}
        </span>
        <span className="format">{best?.format || "unknown"}</span>
      </button>
      <div className="card-meta">
        <strong title={r.name || r.displayed}>
          {r.name || "Untitled image"}
        </strong>
        <span>
          {best?.width || r.width || "?"} × {best?.height || r.height || "?"} ·{" "}
          {best?.bytes
            ? `${Math.round(best.bytes / 1024)} KB`
            : best?.verified
              ? "verified"
              : "unverified"}
        </span>
        <div>
          <small title={r.source}>{r.source}</small>
          <button
            title={
              review
                ? canInclude
                  ? "Include this image"
                  : "Enable this format in Preferences"
                : "Download this image"
            }
            disabled={review && !canInclude}
            onClick={review ? onInclude : onDownload}
            aria-label={review ? "Include this image" : "Download this image"}
          >
            <Icon name={review ? "all" : "download"} />
          </button>
        </div>
        {r.status !== "ready" && <small className="failure">{r.status}</small>}
        {review && (
          <small
            className="exclusion-reason"
            title={r.eligibility?.reasons.join(" · ")}
          >
            {r.eligibility?.reasons.join(" · ")}
          </small>
        )}
      </div>
    </article>
  );
}
