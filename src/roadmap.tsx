import React, { useEffect, useState } from "react";
import { Icon } from "./appearance-react";
import { rpc } from "./shared";
const campaign = chrome.runtime.getManifest().version;
export function Roadmap({
  ready,
  manual = false,
}: {
  ready: boolean;
  manual?: boolean;
}) {
  const [visible, setVisible] = useState(manual),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!ready || manual) return;
    let live = true;
    void chrome.storage.local
      .get(["settings", "roadmapSeen"])
      .then(async (stored) => {
        if (
          !live ||
          stored["settings"]?.showUpcoming === false ||
          stored["roadmapSeen"] === campaign
        )
          return;
        await chrome.storage.local.set({ roadmapSeen: campaign });
        if (live) setVisible(true);
      });
    return () => {
      live = false;
    };
  }, [ready, manual]);
  async function hideForever() {
    try {
      await rpc({
        type: "PREFERENCES",
        patch: { showUpcoming: false },
      });
      setVisible(false);
    } catch (e) {
      setError(String(e));
    }
  }
  if (!visible || (!manual && !ready)) return null;
  return (
    <aside className="roadmap" aria-label="Upcoming features">
      <div className="roadmap-heading">
        <span className="roadmap-mark">
          <Icon name="image" />
        </span>
        <div>
          <small>ON THE HORIZON · PLANNED</small>
          <strong>Coming to your library</strong>
        </div>
        {!manual && (
          <button
            className="icon"
            aria-label="Close upcoming features"
            onClick={() => { setVisible(false); }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <p>
        Site profiles, duplicate review and naming presets. Planned additions to
        your image workflow.
      </p>
      {expanded && (
        <ul className="roadmap-list">
          <li>
            <strong>Site profiles</strong>
            <span>Remember discovery choices for each website.</span>
          </li>
          <li>
            <strong>Duplicate review</strong>
            <span>Compare similar images before downloading.</span>
          </li>
          <li>
            <strong>Naming presets</strong>
            <span>Reusable names and folder patterns.</span>
          </li>
        </ul>
      )}
      <div className="roadmap-actions">
        <button onClick={() => { setExpanded(!expanded); }} aria-expanded={expanded}>
          {expanded ? "Less detail" : "Explore plans"}
        </button>
        {!manual && (
          <>
            <button onClick={() => { setVisible(false); }}>Skip</button>
            <button onClick={hideForever}>Don’t show again</button>
          </>
        )}
      </div>
      {expanded && (
        <small>
          Planned, with no committed release dates. These features are not
          available yet.
        </small>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
