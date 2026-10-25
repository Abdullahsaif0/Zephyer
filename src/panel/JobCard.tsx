import React from "react";
import { Icon } from "../appearance-react";
import type { QueueView } from "../shared";

export function JobCard({
  job: j,
  tabId,
  pendingCommands,
  onCommand,
  expandedJobs,
  setExpandedJobs,
  jobPages,
  setJobPages,
}: {
  job: QueueView;
  tabId: number;
  pendingCommands: string[];
  onCommand: (command: "pause" | "resume" | "cancel" | "retry") => void;
  expandedJobs: Record<string, boolean>;
  setExpandedJobs: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  jobPages: Record<string, number>;
  setJobPages: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  const pending = pendingCommands.includes(`${tabId}:JOB:${j.id}`);
  const done = j.items.filter((i) => i.state === "done").length;
  const failed = j.items.filter((i) => i.state === "failed").length;
  const pages = Math.max(0, Math.ceil(j.items.length / 50) - 1);
  const page = Math.min(jobPages[j.id] || 0, pages);
  return (
    <article className="job" key={j.id}>
      <div className="job-heading">
        <strong>{j.output.zip ? "ZIP archive" : "Image download"}</strong>
        <span className={"badge " + j.state}>{j.state}</span>
      </div>
      <p>
        {new Date(j.created).toLocaleString()} · {j.items.length} images
      </p>
      <progress max={j.items.length || 1} value={done} />
      <p>{j.summary || `${done} saved · ${failed} failed`}</p>
      <div className="button-row">
        {j.state === "running" && (
          <button disabled={pending} onClick={() => onCommand("pause")}>
            <Icon name="pause" /> Pause
          </button>
        )}
        {j.state === "paused" && (
          <button disabled={pending} onClick={() => onCommand("resume")}>
            <Icon name="play" /> Resume
          </button>
        )}
        {["running", "paused"].includes(j.state) && (
          <button disabled={pending} onClick={() => onCommand("cancel")}>
            <Icon name="close" /> Cancel
          </button>
        )}
        {j.state !== "cancelled" && failed > 0 && (
          <button disabled={pending} onClick={() => onCommand("retry")}>
            <Icon name="retry" /> Retry failed
          </button>
        )}
      </div>
      <details
        onToggle={(e) => {
          const open = e.currentTarget.open;
          setExpandedJobs((old) =>
            old[j.id] === open ? old : { ...old, [j.id]: open },
          );
        }}
      >
        <summary>Per-file results</summary>
        {expandedJobs[j.id] &&
          j.items.slice(page * 50, (page + 1) * 50).map((i) => (
            <div className="job-item" key={i.id}>
              <strong>
                {i.file?.split("/").pop() || i.record.name || "Image"}
              </strong>
              <span>
                {i.state}
                {i.fallback ? " · fallback version" : ""}
              </span>
              {i.error && <small className="failure">{i.error}</small>}
              {!!i.retrieval?.length && (
                <small>
                  {i.retrieval.at(-1)?.strategy}: {i.retrieval.at(-1)?.result}
                </small>
              )}
            </div>
          ))}
        {expandedJobs[j.id] && j.items.length > 50 && (
          <div className="button-row queue-pages">
            <button
              disabled={!jobPages[j.id]}
              onClick={() => {
                setJobPages((p) => ({
                  ...p,
                  [j.id]: Math.max(0, (p[j.id] || 0) - 1),
                }));
              }}
            >
              Previous files
            </button>
            <span>
              Page {page + 1} of {Math.ceil(j.items.length / 50)}
            </span>
            <button
              disabled={(page + 1) * 50 >= j.items.length}
              onClick={() => {
                setJobPages((p) => ({ ...p, [j.id]: (p[j.id] || 0) + 1 }));
              }}
            >
              Next files
            </button>
          </div>
        )}
      </details>
    </article>
  );
}
