import React, { useEffect, useMemo, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  rpc,
  defaultOutput,
  filterRecords,
  type ImageRecord,
  type Output,
  type LibrarySnapshot,
  type LibraryMetadata,
  type Message,
} from "./shared";
import "./ui.css";
import { Icon, useAppearance } from "./appearance-react";
import { Roadmap } from "./roadmap";
import { DiscoveryNotice } from "./discovery-notice";
import { allowedVariants, discoveryBucket } from "./discovery";
import { ImageCard } from "./panel/ImageCard";
import { JobCard } from "./panel/JobCard";
function App() {
  useAppearance();
  const [tabId, setTabId] = useState(0),
    [data, setData] = useState<LibrarySnapshot>(),
    [error, setError] = useState(""),
    [refreshError, setRefreshError] = useState(""),
    [dismissedPageError, setDismissedPageError] = useState(""),
    [pendingCommands, setPendingCommands] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [min, setMin] = useState(0),
    [fmt, setFmt] = useState(""),
    [sort, setSort] = useState("discovered"),
    [output, setOutput] = useState<Output>({ ...defaultOutput }),
    [view, setView] = useState("library"),
    [busy, setBusy] = useState(false),
    [scroll, setScroll] = useState(0),
    [viewport, setViewport] = useState(600),
    [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({}),
    [jobPages, setJobPages] = useState<Record<string, number>>({});
  const [collectionView, setCollectionView] = useState("accepted"),
    [reason, setReason] = useState("");
  const list = useRef<HTMLDivElement>(null),
    tabRef = useRef(0);
  const submitting = useRef(false),
    commands = useRef(new Set<string>());
  const fetching = useRef(false),
    reload = useRef(false);
  async function load(id = tabRef.current) {
    if (!id) return;
    if (fetching.current) {
      reload.current = true;
      return;
    }
    fetching.current = true;
    try {
      const { recordIds, ...metadata } = await rpc<LibraryMetadata>({
        type: "LIBRARY_META",
        tabId: id,
      });
      const records: ImageRecord[] = [];
      for (let offset = 0; offset < recordIds.length; offset += 200) {
        if (tabRef.current !== id) return;
        const batch = await rpc<{ records: ImageRecord[] }>({
          type: "RECORDS_BATCH",
          tabId: id,
          ids: recordIds.slice(offset, offset + 200),
        });
        records.push(...batch.records);
      }
      const r = { ...metadata, records };
      if (tabRef.current === id) {
        setData(r);
        setRefreshError("");
      }
    } catch (e) {
      if (tabRef.current === id) setRefreshError(String(e));
    } finally {
      fetching.current = false;
      if (reload.current) {
        reload.current = false;
        void load();
      }
    }
  }
  useEffect(() => {
    const change = async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id) {
        tabRef.current = tab.id;
        setTabId(tab.id);
        setData(undefined);
        setDismissedPageError("");
        setError("");
        setRefreshError("");
        setScroll(0);
        await load(tab.id);
      }
    };
    void change();
    const message = (m: any) => {
      if (m.type === "NOTICE" && m.tabId === tabRef.current) void load();
    };
    const activated = () => void change();
    chrome.runtime.onMessage.addListener(message);
    chrome.tabs.onActivated.addListener(activated);
    const tick = setInterval(() => void load(), 60000);
    return () => {
      chrome.runtime.onMessage.removeListener(message);
      chrome.tabs.onActivated.removeListener(activated);
      clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    if (!list.current) return;
    const o = new ResizeObserver((es) => {
      const entry = es[0];
      if (entry) setViewport(entry.contentRect.height);
    });
    o.observe(list.current);
    return () => { o.disconnect(); };
  }, [view, data?.records.length ? true : false]);
  async function act(
    m:
      | Extract<
          Message,
          {
            type:
              "DOWNLOAD" | "SELECT" | "MODE" | "SCAN" | "JOB" | "SITE_POWER";
          }
        >
      | Omit<Extract<Message, { type: "INCLUDE" }>, "tabId">,
  ): Promise<{ ok: boolean }> {
    const origin = tabRef.current;
    const key = `${origin}:${m.type}:${"id" in m ? m.id : ""}`;
    const guarded = ["DOWNLOAD", "JOB", "SCAN", "SITE_POWER"].includes(m.type);
    if (guarded && commands.current.has(key)) return { ok: false };
    if (guarded) commands.current.add(key);
    setPendingCommands([...commands.current]);
    setError("");
    try {
      const request = { ...m, tabId: origin };
      await rpc(request);
      await load(origin);
      return { ok: origin === tabRef.current };
    } catch (e) {
      if (origin === tabRef.current)
        setError(e instanceof Error ? e.message : String(e));
      return { ok: false };
    } finally {
      commands.current.delete(key);
      setPendingCommands([...commands.current]);
    }
  }
  const filtered = useMemo(() => {
    const rs = filterRecords(
      (data?.records || []).filter(
        (r) =>
          discoveryBucket(r) === collectionView &&
          (!reason || r.eligibility?.reasons.includes(reason)),
      ),
      query,
      min,
      fmt,
    );
    if (sort === "largest")
      rs.sort(
        (a, b) =>
          Math.max(...b.variants.map((v) => v.width * v.height), 0) -
          Math.max(...a.variants.map((v) => v.width * v.height), 0),
      );
    else if (sort === "name") rs.sort((a, b) => a.name.localeCompare(b.name));
    // Match the gallery's "Discovered" ordering: discovery sequence, not update time.
    else rs.sort((a, b) => (a.discoveredOrder || 0) - (b.discoveredOrder || 0));
    return rs;
  }, [data?.records, query, min, fmt, sort, collectionView, reason]);
  const selected =
      data?.records.filter(
        (r) =>
          r.selected && (r.eligibility?.state || "accepted") === "accepted",
      ) || [],
    visibleSelected = filtered.filter((r) => r.selected);
  const changeOutput = (k: keyof Output, v: any) => { setOutput((o) => ({ ...o, [k]: v })); };
  async function download(ids: string[], asZip = output.zip) {
    if (submitting.current || !ids.length) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await act({
        type: "DOWNLOAD",
        ids: [...ids],
        output: { ...output, zip: asZip },
      });
      if (result.ok) setView("queue");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const rowHeight = 212,
    columns = 2,
    rows = Math.ceil(filtered.length / columns),
    safeScroll = Math.min(scroll, Math.max(0, rows * rowHeight - viewport)),
    start = Math.max(0, Math.floor(safeScroll / rowHeight) - 2),
    end = Math.min(rows, Math.ceil((safeScroll + viewport) / rowHeight) + 2),
    rendered = filtered.slice(start * columns, end * columns);
  // A per-variant quality choice is only renderable while exactly one image
  // is selected; drop stale variant URLs so the select stays valid and the
  // next download cannot carry a quality belonging to another image.
  useEffect(() => {
    const valid =
      output.quality === "best" ||
      output.quality === "displayed" ||
      (selected.length === 1 &&
        selected[0]?.variants.some((v) => v.url === output.quality));
    if (!valid) setOutput((o) => ({ ...o, quality: "best" }));
  }, [output.quality, selected]);
  useEffect(() => {
    if (list.current && list.current.scrollTop > safeScroll) {
      list.current.scrollTop = safeScroll;
      setScroll(safeScroll);
    }
  }, [safeScroll, filtered.length]);
  return (
    <main className="side-library">
      <header>
        <div className="wordmark">
          <span className="logo">
            <Icon name="brand" />
          </span>
          <div>
            ZEPHYER<small>PRIVATE IMAGE LIBRARY</small>
          </div>
        </div>
        <button
          className="icon"
          title="Preferences"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <Icon name="settings" />
        </button>
      </header>
      <section className="page-info">
        <span className="live" />
        {data?.url
          ? (() => {
              try {
                return new URL(data.url).hostname || "Restricted page";
              } catch {
                return "Current page";
              }
            })()
          : "Connecting to page…"}
        <span className="local">LOCAL ONLY</span>
      </section>
      {data && (
        <section className="site-power" aria-label="Website activation">
          <div>
            <strong>
              {data.power.reason === "inactive"
                ? "Click the extension icon to activate this tab"
                : data.power.reason === "restricted"
                  ? "Restricted page"
                  : data.power.reason === "global-off"
                    ? "Globally paused"
                    : data.power.effectiveEnabled
                      ? "On for this website"
                      : "Off for this website"}
            </strong>
            <small>{data.power.hostname || "Open an HTTP/HTTPS website"}</small>
          </div>
          <button
            className="site-power-switch"
            type="button"
            role="switch"
            aria-label="Enable Zephyer on this website"
            aria-checked={data.power.effectiveEnabled}
            disabled={
              !data.power.activated ||
              !data.power.hostname ||
              !data.power.globalEnabled
            }
            aria-disabled={pendingCommands.includes(`${tabId}:SITE_POWER:`)}
            onClick={() =>
              void act({ type: "SITE_POWER", enabled: !data.power.siteEnabled })
            }
          >
            <Icon name="power" />
            {pendingCommands.includes(`${tabId}:SITE_POWER:`)
              ? "Saving…"
              : data.power.effectiveEnabled
                ? "On"
                : "Off"}
          </button>
          {!data.power.globalEnabled && (
            <button
              className="icon"
              title="Open Preferences to enable globally"
              aria-label="Open global detection preferences"
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              <Icon name="settings" />
            </button>
          )}
        </section>
      )}
      {data && (
        <div className="gallery-entry">
          <button
            disabled={
              !data.records.some((r) => r.eligibility?.state === "accepted")
            }
            onClick={() =>
              void rpc({ type: "OPEN_GALLERY", tabId }).catch((e: unknown) => { setError(String(e)); },
              )
            }
          >
            <Icon name="photos" /> Open Photos Gallery in new tab
          </button>
        </div>
      )}
      <nav>
        <button
          className={view === "library" ? "active" : ""}
          onClick={() => { setView("library"); }}
        >
          Library{" "}
          <b>
            {data?.records.filter(
              (r) => (r.eligibility?.state || "accepted") === "accepted",
            ).length || 0}
          </b>
        </button>
        <button
          className={view === "queue" ? "active" : ""}
          onClick={() => { setView("queue"); }}
        >
          Downloads <b>{data?.jobs.length || 0}</b>
        </button>
      </nav>
      {(error ||
        refreshError ||
        (data?.error !== dismissedPageError ? data?.error : "")) && (
        <div className="alert" role="alert">
          {error ||
            refreshError ||
            (data?.error !== dismissedPageError ? data?.error : "")}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setRefreshError("");
              setDismissedPageError(data?.error || "");
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {data && !data.settings.enabled && (
        <div className="alert">
          Detection is globally paused. Enable it in Preferences.
        </div>
      )}
      {view === "library" ? (
        <>
          <Roadmap
            ready={
              !!data &&
              !["running", "paused"].includes(data.scan.state) &&
              !data.jobs.some((j) => ["running", "paused"].includes(j.state))
            }
          />
          {data && (
            <DiscoveryNotice
              records={data.records}
              settings={data.settings}
              tabId={tabId}
              onError={setError}
            />
          )}
          <section
            className="scan-card"
            data-scanning={data?.scan.state === "running"}
          >
            <div>
              <strong>
                {data?.scan.state === "running"
                  ? "Exploring this page"
                  : "Collect the whole page"}
              </strong>
              <p>{data?.scan.reason || "Discovering available images"}</p>
            </div>
            <div className="button-row">
              <button
                className="primary"
                onClick={() =>
                  act({
                    type: "SCAN",
                    command:
                      data?.scan.state === "running"
                        ? "pause"
                        : data?.scan.state === "paused"
                          ? "resume"
                          : "start",
                  })
                }
              >
                {data?.scan.state === "running"
                  ? "Pause"
                  : data?.scan.state === "paused"
                    ? "Resume"
                    : "Full-page scan"}
              </button>
              {["running", "paused"].includes(data?.scan.state || "") && (
                <button onClick={() => act({ type: "SCAN", command: "stop" })}>
                  Stop
                </button>
              )}
              <button
                className={data?.selectMode ? "selected" : ""}
                onClick={() => act({ type: "MODE", value: !data?.selectMode })}
              >
                <Icon name="select" /> Page selection
              </button>
            </div>
          </section>
          <div
            className="collection-tabs"
            role="group"
            aria-label="Collection eligibility"
          >
            {["accepted", "excluded", "pending", "disabled"].map((state) => (
              <button
                key={state}
                aria-pressed={collectionView === state}
                onClick={() => {
                  setCollectionView(state);
                  setReason("");
                  setScroll(0);
                  if (list.current) list.current.scrollTop = 0;
                }}
              >
                {state === "accepted"
                  ? "Useful"
                  : state === "excluded"
                    ? "Excluded"
                    : state === "disabled"
                      ? "Formats off"
                      : "Pending"}{" "}
                <b>
                  {data?.records.filter((r) => discoveryBucket(r) === state)
                    .length || 0}
                </b>
              </button>
            ))}
          </div>
          {collectionView !== "accepted" && (
            <div className="review-note">
              <span>
                {collectionView === "pending"
                  ? "Format not verified. Previews stay off until requested."
                  : "Hidden by your discovery rules. Preview or include useful images."}
              </span>
              <button onClick={() => chrome.runtime.openOptionsPage()}>
                Discovery settings
              </button>
            </div>
          )}
          <section className="filters">
            {collectionView !== "accepted" && (
              <select
                aria-label="Exclusion reason"
                value={reason}
                onChange={(e) => { setReason(e.target.value); }}
              >
                <option value="">All reasons</option>
                {[
                  ...new Set(
                    (data?.records || []).flatMap(
                      (r) => r.eligibility?.reasons || [],
                    ),
                  ),
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            )}
            <input
              aria-label="Search images"
              placeholder="Search images or source…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setScroll(0);
                if (list.current) list.current.scrollTop = 0;
              }}
            />
            <div className="filter-row">
              <label>
                Min width
                <input
                  type="number"
                  min="0"
                  max="100000"
                  value={min}
                  onChange={(e) => {
                    setMin(Math.max(0, Number(e.target.value)));
                    setScroll(0);
                    if (list.current) list.current.scrollTop = 0;
                  }}
                />
              </label>
              <label>
                Format
                <select
                  value={fmt}
                  onChange={(e) => {
                    setFmt(e.target.value);
                    setScroll(0);
                    if (list.current) list.current.scrollTop = 0;
                  }}
                >
                  <option value="">All formats</option>
                  {[
                    "jpeg",
                    "png",
                    "webp",
                    "gif",
                    "avif",
                    "svg",
                    "svg+xml",
                    "unknown",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Sort
                <select value={sort} onChange={(e) => { setSort(e.target.value); }}>
                  <option value="discovered">Discovered</option>
                  <option value="largest">Largest first</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
          </section>
          <div className="selection-bar">
            <span>
              {filtered.length} shown ·{" "}
              <strong>{selected.length} selected</strong>
            </span>
            <button
              disabled={collectionView !== "accepted" || !filtered.length}
              onClick={() =>
                act({
                  type: "SELECT",
                  ids: filtered.map((r) => r.id),
                  value: true,
                })
              }
            >
              Select all shown
            </button>
            <button
              onClick={() =>
                act({
                  type: "SELECT",
                  ids: data?.records.map((r) => r.id) || [],
                  value: false,
                })
              }
            >
              Clear
            </button>
          </div>
          <div
            className="gallery"
            role="region"
            aria-label="Collected images"
            tabIndex={0}
            ref={list}
            onScroll={(e) => { setScroll(e.currentTarget.scrollTop); }}
          >
            {filtered.length ? (
              <div style={{ height: rows * rowHeight, position: "relative" }}>
                <div
                  className="grid"
                  style={{
                    position: "absolute",
                    top: start * rowHeight,
                    left: 0,
                    right: 0,
                  }}
                >
                  {rendered.map((r) => (
                    <ImageCard
                      key={r.id}
                      record={r}
                      settings={data!.settings}
                      onSelect={() => act({ type: "SELECT", ids: [r.id] })}
                      onDownload={() => download([r.id])}
                      onInclude={() => act({ type: "INCLUDE", id: r.id })}
                      canInclude={
                        !!data && allowedVariants(r, data.settings).length > 0
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty">
                <span className="empty-icon">
                  <Icon name="image" />
                </span>
                <h2>
                  {!data
                    ? "Loading your library"
                    : query || min || fmt
                      ? "No matching images"
                      : collectionView !== "accepted"
                        ? `No ${collectionView} images`
                        : "No useful images yet"}
                </h2>
                <p>
                  {!data
                    ? "Connecting to this page. If it stays unavailable, refresh the page or retry."
                    : query || min || fmt
                      ? "Adjust the filters to see more images."
                      : collectionView !== "accepted"
                        ? "Images appear here when discovery rules exclude them or their format is unresolved."
                        : "JPEG and PNG are enabled. Check Excluded or Discovery settings, or scan to reveal lazy-loaded images."}
                </p>
                {!data && (
                  <button onClick={() => void load()}>Retry connection</button>
                )}
                {!!data && (query || min || fmt) && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setMin(0);
                      setFmt("");
                    }}
                  >
                    Reset filters
                  </button>
                )}
                {!!data && !query && !min && !fmt && (
                  <button onClick={() => chrome.runtime.openOptionsPage()}>
                    Discovery preferences
                  </button>
                )}
              </div>
            )}
          </div>
          <details className="output">
            <summary>
              <Icon name="quality" /> Output settings{" "}
              <span>
                {output.format === "original"
                  ? "Original files"
                  : output.format.toUpperCase()}{" "}
                · {output.zip ? "ZIP archives" : "Individual files"}
              </span>
            </summary>
            <p className="destination-note">
              Save to{" "}
              {data?.settings.askWhereToSave
                ? "Chrome Save as picker"
                : `Downloads/${data?.settings.downloadFolder || ""}${data?.settings.groupDownloads ? "/<website>/<batch>" : ""}`}{" "}
              · Continuous image numbering.{" "}
              <button onClick={() => chrome.runtime.openOptionsPage()}>
                Change
              </button>
            </p>
            <div className="output-grid">
              <label>
                Quality
                <select
                  value={output.quality}
                  onChange={(e) => { changeOutput("quality", e.target.value); }}
                >
                  <option value="best">Best available</option>
                  <option value="displayed">Displayed version</option>
                  {selected.length === 1 &&
                    selected[0]?.variants.map((v) => (
                      <option key={v.url} value={v.url}>
                        {v.width || "?"} × {v.height || "?"} · {v.method}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                File format
                <select
                  aria-label="File format"
                  value={output.format}
                  onChange={(e) => { changeOutput("format", e.target.value); }}
                >
                  {["original", "jpeg", "png", "webp"].map((f) => (
                    <option key={f} value={f}>
                      {f === "original" ? "Keep original" : f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Delivery
                <select
                  value={String(output.zip)}
                  onChange={(e) => { changeOutput("zip", e.target.value === "true"); }
                  }
                >
                  <option value="false">Individual files</option>
                  <option value="true">ZIP · split at 250 MB</option>
                </select>
              </label>
            </div>
            {output.format !== "original" && (
              <>
                <div className="output-grid">
                  <label>
                    Max width
                    <input
                      type="number"
                      min="0"
                      max="16384"
                      value={output.width}
                      onChange={(e) => { changeOutput("width", Number(e.target.value)); }
                      }
                    />
                  </label>
                  <label>
                    Max height
                    <input
                      type="number"
                      min="0"
                      max="16384"
                      value={output.height}
                      onChange={(e) => { changeOutput("height", Number(e.target.value)); }
                      }
                    />
                  </label>
                  {output.format === "jpeg" && (
                    <label>
                      Background
                      <input
                        type="color"
                        value={output.background}
                        onChange={(e) => { changeOutput("background", e.target.value); }
                        }
                      />
                    </label>
                  )}
                </div>
                <p className="hint">
                  0 keeps original bounds. Aspect ratio is preserved.
                </p>
                {output.format !== "png" && (
                  <label className="range">
                    Compression quality {Math.round(output.qualityValue * 100)}%
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={output.qualityValue * 100}
                      onChange={(e) => { changeOutput(
                          "qualityValue",
                          Number(e.target.value) / 100,
                        ); }
                      }
                    />
                  </label>
                )}
                <label className="checklabel">
                  <input
                    type="checkbox"
                    checked={output.upscale}
                    onChange={(e) => { changeOutput("upscale", e.target.checked); }}
                  />{" "}
                  Allow upscaling
                </label>
                <label className="checklabel">
                  <input
                    type="checkbox"
                    checked={output.firstFrame}
                    onChange={(e) => { changeOutput("firstFrame", e.target.checked); }
                    }
                  />{" "}
                  Allow first-frame/static conversion of animation/vector
                  formats
                </label>
              </>
            )}
          </details>
          <footer className="download-actions" aria-busy={busy}>
            <button
              className="primary download"
              disabled={!selected.length || busy}
              onClick={() => download(selected.map((r) => r.id))}
            >
              <Icon name="download" />{" "}
              {busy ? "Preparing download…" : "Download selected"}{" "}
              <b>{selected.length}</b>
            </button>
            <button
              className="zip-download"
              aria-label="Download selected images as ZIP"
              title="Download selected images as ZIP"
              disabled={!selected.length || busy}
              onClick={() =>
                download(
                  selected.map((r) => r.id),
                  true,
                )
              }
            >
              <Icon name="zip" /> Download ZIP
            </button>
            <button
              disabled={
                !filtered.length || busy || collectionView !== "accepted"
              }
              onClick={() => download(filtered.map((r) => r.id))}
            >
              All shown
            </button>
            <small>
              {selected.length !== visibleSelected.length
                ? "Selection includes images outside current filters."
                : "Only the current selection is included in this download."}
            </small>
          </footer>
        </>
      ) : (
        <section className="jobs">
          {!data?.jobs.length && (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="download" />
              </span>
              <h2>No downloads yet</h2>
              <p>Select images in your library to start a download.</p>
            </div>
          )}
          {data?.jobs
            .slice()
            .reverse()
            .map((j) => (
              <JobCard
                key={j.id}
                job={j}
                tabId={tabId}
                pendingCommands={pendingCommands}
                onCommand={(command) => {
                  void act({ type: "JOB", id: j.id, command });
                }}
                expandedJobs={expandedJobs}
                setExpandedJobs={setExpandedJobs}
                jobPages={jobPages}
                setJobPages={setJobPages}
              />
            ))}
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
