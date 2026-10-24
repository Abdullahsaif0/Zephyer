import React, { useEffect, useRef, useState } from "react";
import {
  type ImageRecord,
  type Settings,
  type Output,
  type QueueView,
} from "./shared";
import { allowedVariants } from "./discovery";
import { Icon } from "./appearance-react";
import { preview, releasePreview } from "./gallery-preview";
import type { GalleryCommand } from "./gallery";
export function Photo({
  record,
  collectionId,
  settings,
  selecting,
  review,
  open,
  choose,
  include,
}: {
  record: ImageRecord;
  collectionId: string;
  settings: Settings;
  selecting: boolean;
  review: boolean;
  open: () => void;
  choose: () => void;
  include: () => void;
}) {
  const revealKey = `${record.id}:${review}`;
  const [revealedKey, setRevealedKey] = useState("");
  const revealed = !review || revealedKey === revealKey;
  const source =
    allowedVariants(record, settings).find((v) => v.url === record.displayed) ||
    allowedVariants(record, settings)[0];
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError("");
    setUrl("");
    if (!revealed || !source) return;
    const controller = new AbortController();
    let owned = "";
    if (
      source.verified &&
      source.width > 0 &&
      source.width <= 1024 &&
      source.height > 0 &&
      source.height <= 1024 &&
      attempt === 0
    ) {
      setUrl(source.url);
      return () => controller.abort();
    }
    void preview(
      record,
      collectionId,
      settings,
      false,
      "displayed",
      controller.signal,
    )
      .then((r) => {
        if (controller.signal.aborted) {
          releasePreview(r.url);
          return;
        }
        owned = r.url;
        setUrl(r.url);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => {
      controller.abort();
      if (owned) releasePreview(owned);
    };
  }, [
    record.id,
    source?.url,
    revealed,
    attempt,
    settings.allowedFormats.join(","),
  ]);
  const allowed = record.eligibility?.state === "accepted";
  return (
    <div
      className="photo-tile"
      role="listitem"
      data-image-id={record.id}
      data-selected={record.selected}
    >
      <button
        className="photo-open"
        aria-label={
          selecting
            ? `${record.selected ? "Deselect" : "Select"} ${record.name || "image"}`
            : `View ${record.name || "image"}`
        }
        onClick={() =>
          selecting && allowed
            ? choose()
            : !revealed
              ? setRevealedKey(revealKey)
              : open()
        }
      >
        {url && !error ? (
          <img
            src={url}
            alt={record.name || "Collected image"}
            decoding="async"
            onError={() => {
              if (attempt === 0) setAttempt(1);
              else setError("Preview unavailable");
            }}
          />
        ) : (
          <span className="photo-placeholder">
            <Icon name="image" />
            {!revealed
              ? "Click to preview"
              : error
                ? "Preview unavailable"
                : !source
                  ? "Enable this format to preview"
                  : "Loading…"}
          </span>
        )}
      </button>
      {allowed && (
        <button
          className="photo-check"
          aria-label={record.selected ? "Deselect image" : "Select image"}
          aria-pressed={record.selected}
          onClick={choose}
        >
          <Icon name={record.selected ? "check" : "select"} />
        </button>
      )}
      {error && (
        <button
          className="photo-retry"
          title={error}
          onClick={() => setAttempt((n) => n + 1)}
        >
          <Icon name="retry" />
          Retry
        </button>
      )}
      {review && (
        <div className="photo-review">
          <span>{record.eligibility?.reasons.join(" · ")}</span>
          <button
            disabled={!allowedVariants(record, settings).length}
            onClick={include}
          >
            Include this image
          </button>
        </div>
      )}
    </div>
  );
}
export function Viewer({
  record,
  settings,
  collectionId,
  index,
  total,
  close,
  move,
  choose,
  download,
  disabled,
}: {
  record: ImageRecord;
  settings: Settings;
  collectionId: string;
  index: number;
  total: number;
  close: () => void;
  move: (n: number) => void;
  choose: () => void;
  download: (q: string) => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    drag = useRef<
      | { id: number; x: number; y: number; left: number; top: number }
      | undefined
    >(undefined);
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [quality, setQuality] = useState("best"),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [fallback, setFallback] = useState(false),
    [info, setInfo] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    setQuality("best");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAttempt(0);
  }, [record.id]);
  useEffect(() => {
    const controller = new AbortController();
    let owned = "";
    setUrl("");
    setError("");
    void preview(
      record,
      collectionId,
      settings,
      true,
      quality,
      controller.signal,
    )
      .then((r) => {
        if (controller.signal.aborted) {
          releasePreview(r.url);
          return;
        }
        owned = r.url;
        setUrl(r.url);
        setFallback(r.fallback);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => {
      controller.abort();
      if (owned) releasePreview(owned);
    };
  }, [record.id, quality, attempt, settings.allowedFormats.join(",")]);
  function changeZoom(value: number) {
    setZoom(Math.max(1, Math.min(8, value)));
    setPan({ x: 0, y: 0 });
  }
  function pointerMove(e: React.PointerEvent) {
    const d = drag.current,
      el = stage.current,
      im = image.current;
    if (!d || d.id !== e.pointerId || !el || !im) return;
    const fit = Math.min(
        el.clientWidth / im.naturalWidth,
        el.clientHeight / im.naturalHeight,
      ),
      mx = Math.max(0, (im.naturalWidth * fit * zoom - el.clientWidth) / 2),
      my = Math.max(0, (im.naturalHeight * fit * zoom - el.clientHeight) / 2);
    setPan({
      x: Math.max(-mx, Math.min(mx, d.left + e.clientX - d.x)),
      y: Math.max(-my, Math.min(my, d.top + e.clientY - d.y)),
    });
  }
  return (
    <dialog
      ref={dialog}
      className="photo-viewer"
      aria-label="Full image viewer"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches("input,select,textarea")) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          changeZoom(zoom + 0.5);
        } else if (e.key === "-") {
          e.preventDefault();
          changeZoom(zoom - 0.5);
        }
      }}
    >
      <div className="viewer-top">
        <button aria-label="Close full image" autoFocus onClick={close}>
          <Icon name="close" />
        </button>
        <span>
          {index + 1} / {total}
        </span>
        <div>
          <button
            aria-pressed={record.selected}
            disabled={record.eligibility?.state !== "accepted"}
            onClick={choose}
          >
            <Icon name={record.selected ? "check" : "select"} />
            {record.selected ? "Selected" : "Select"}
          </button>
          <button
            aria-label="Image details"
            aria-pressed={info}
            onClick={() => setInfo(!info)}
          >
            <Icon name="details" />
          </button>
        </div>
      </div>
      <div
        className="viewer-stage"
        ref={stage}
        data-zoomed={zoom > 1}
        onDoubleClick={() => changeZoom(zoom === 1 ? 2 : 1)}
        onPointerDown={(e) => {
          if (zoom <= 1 || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            left: pan.x,
            top: pan.y,
          };
        }}
        onPointerMove={pointerMove}
        onPointerUp={() => (drag.current = undefined)}
        onPointerCancel={() => (drag.current = undefined)}
      >
        {url && !error ? (
          <img
            ref={image}
            src={url}
            alt={record.name || "Full image"}
            draggable={false}
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
            onError={() =>
              setError("Preview unavailable · the source may have expired")
            }
          />
        ) : (
          <div className="viewer-placeholder">
            <Icon name="image" />
            <p>
              {error
                ? "Preview unavailable. The source may be protected or no longer accessible."
                : "Loading full image…"}
            </p>
            {error && (
              <button onClick={() => setAttempt((n) => n + 1)}>
                <Icon name="retry" />
                Retry preview
              </button>
            )}
          </div>
        )}
      </div>
      <button
        className="viewer-previous"
        aria-label="Previous image"
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        <Icon name="arrow" />
      </button>
      <button
        className="viewer-next"
        aria-label="Next image"
        disabled={index === total - 1}
        onClick={() => move(1)}
      >
        <Icon name="arrow" />
      </button>
      {info && (
        <section className="viewer-details">
          <h2>{record.name || "Image details"}</h2>
          <p>
            {record.width && record.height
              ? `${record.width} × ${record.height}`
              : "Dimensions not verified"}
          </p>
          <p>{record.source}</p>
          <a
            href={/^https?:/.test(record.pageUrl) ? record.pageUrl : undefined}
            target="_blank"
            rel="noreferrer"
          >
            Source website
          </a>
          {allowedVariants(record, settings).map((v) => (
            <p key={v.url}>
              {v.format.toUpperCase()} ·{" "}
              {v.width
                ? v.width + " × " + (v.height || "unknown")
                : "Unknown dimensions"}{" "}
              · {v.verified ? "Verified" : "Unverified"}
              {v.bytes ? ` · ${(v.bytes / 1024).toFixed(0)} KB` : ""}
            </p>
          ))}
        </section>
      )}
      <div className="viewer-bottom">
        <div>
          <button
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => changeZoom(zoom - 0.5)}
          >
            <Icon name="zoomOut" />
          </button>
          <button onClick={() => changeZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 8}
            onClick={() => changeZoom(zoom + 0.5)}
          >
            <Icon name="zoomIn" />
          </button>
        </div>
        <label>
          Quality
          <select
            aria-label="Viewer quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
          >
            <option value="best">Best available</option>
            <option value="displayed">Displayed version</option>
            {allowedVariants(record, settings).map((v) => (
              <option key={v.url} value={v.url}>
                {v.width ? `${v.width} × ${v.height || "?"}` : "Unknown size"} ·{" "}
                {v.format}
              </option>
            ))}
          </select>
        </label>
        {fallback && (
          <span className="viewer-fallback">Fallback source used</span>
        )}
        <button
          className="primary"
          disabled={disabled || record.eligibility?.state !== "accepted"}
          onClick={() => download(quality)}
        >
          <Icon name="download" />
          Download
        </button>
      </div>
    </dialog>
  );
}
export function OutputSettings({
  output: o,
  change,
}: {
  output: Output;
  change: <K extends keyof Output>(key: K, value: Output[K]) => void;
}) {
  return (
    <div className="photos-output">
      <p>
        Applies to new downloads. Originals stay unchanged unless you choose
        conversion.
      </p>
      <label>
        Output format
        <select
          value={o.format}
          onChange={(e) => change("format", e.target.value as Output["format"])}
        >
          <option value="original">Original bytes</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="webp">WebP</option>
        </select>
      </label>
      <label>
        Source quality
        <select
          value={o.quality}
          onChange={(e) => change("quality", e.target.value)}
        >
          <option value="best">Best available</option>
          <option value="displayed">Displayed version</option>
        </select>
      </label>
      {o.format !== "original" && (
        <>
          <label>
            Maximum width
            <input
              type="number"
              min="0"
              max="16000"
              value={o.width || ""}
              onChange={(e) =>
                change(
                  "width",
                  Math.max(0, Math.min(16000, Number(e.target.value) || 0)),
                )
              }
            />
          </label>
          <label>
            Maximum height
            <input
              type="number"
              min="0"
              max="16000"
              value={o.height || ""}
              onChange={(e) =>
                change(
                  "height",
                  Math.max(0, Math.min(16000, Number(e.target.value) || 0)),
                )
              }
            />
          </label>
          {["jpeg", "webp"].includes(o.format) && (
            <label>
              Quality {Math.round(o.qualityValue * 100)}%
              <input
                type="range"
                min="10"
                max="100"
                value={o.qualityValue * 100}
                onChange={(e) =>
                  change("qualityValue", Number(e.target.value) / 100)
                }
              />
            </label>
          )}
          {o.format === "jpeg" && (
            <label>
              Transparency fill
              <input
                type="color"
                value={o.background}
                onChange={(e) => change("background", e.target.value)}
              />
            </label>
          )}
          <label className="checklabel">
            <input
              type="checkbox"
              checked={o.upscale}
              onChange={(e) => change("upscale", e.target.checked)}
            />
            Allow upscaling
          </label>
          <label className="checklabel">
            <input
              type="checkbox"
              checked={o.firstFrame}
              onChange={(e) => change("firstFrame", e.target.checked)}
            />
            Allow first-frame/static conversion for animated/vector files
          </label>
        </>
      )}
      <button onClick={() => chrome.runtime.openOptionsPage()}>
        Destination and numbering preferences
      </button>
    </div>
  );
}
export function Jobs({
  jobs,
  command,
}: {
  jobs: QueueView[];
  command: (m: GalleryCommand) => Promise<void>;
}) {
  const [pages, setPages] = useState<Record<string, number>>({});
  return (
    <div className="photos-jobs">
      {!jobs.length ? (
        <p>No downloads from this collection yet.</p>
      ) : (
        jobs
          .slice()
          .reverse()
          .map((job) => (
            <article key={job.id}>
              <strong>
                {job.output.zip ? "ZIP archive" : "Image downloads"} ·{" "}
                {job.state}
              </strong>
              <p>
                {job.items.filter((i) => i.state === "done").length} /{" "}
                {job.items.length} saved
              </p>
              {job.summary && <p>{job.summary}</p>}
              <div>
                {job.state === "running" && (
                  <button
                    onClick={() =>
                      void command({
                        type: "JOB",
                        id: job.id,
                        command: "pause",
                      })
                    }
                  >
                    Pause
                  </button>
                )}
                {job.state === "paused" && (
                  <button
                    onClick={() =>
                      void command({
                        type: "JOB",
                        id: job.id,
                        command: "resume",
                      })
                    }
                  >
                    Resume
                  </button>
                )}
                {["running", "paused"].includes(job.state) && (
                  <button
                    onClick={() =>
                      void command({
                        type: "JOB",
                        id: job.id,
                        command: "cancel",
                      })
                    }
                  >
                    Cancel
                  </button>
                )}
                {job.state !== "cancelled" &&
                  job.items.some((i) => i.state === "failed") && (
                    <button
                      onClick={() =>
                        void command({
                          type: "JOB",
                          id: job.id,
                          command: "retry",
                        })
                      }
                    >
                      Retry failed
                    </button>
                  )}
              </div>
              <details>
                <summary>File results</summary>
                {job.items
                  .slice(
                    (pages[job.id] || 0) * 50,
                    (pages[job.id] || 0) * 50 + 50,
                  )
                  .map((i) => (
                    <p key={i.id}>
                      {i.file || i.record.name || "Image"} · {i.state}
                      {i.error ? ` · ${i.error}` : ""}
                      {i.fallback && " · fallback quality used"}
                      {!!i.retrieval?.length && (
                        <small>
                          {" "}
                          · {i.retrieval.at(-1)?.strategy}:{" "}
                          {i.retrieval.at(-1)?.result}
                        </small>
                      )}
                    </p>
                  ))}
                {job.items.length > 50 && (
                  <div>
                    <button
                      disabled={!(pages[job.id] || 0)}
                      onClick={() =>
                        setPages((p) => ({
                          ...p,
                          [job.id]: Math.max(0, (p[job.id] || 0) - 1),
                        }))
                      }
                    >
                      Previous results
                    </button>
                    <button
                      disabled={
                        ((pages[job.id] || 0) + 1) * 50 >= job.items.length
                      }
                      onClick={() =>
                        setPages((p) => ({
                          ...p,
                          [job.id]: (p[job.id] || 0) + 1,
                        }))
                      }
                    >
                      Next results
                    </button>
                  </div>
                )}
              </details>
            </article>
          ))
      )}
    </div>
  );
}
