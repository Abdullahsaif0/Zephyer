import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  rpc,
  defaults,
  defaultOutput,
  filterRecords,
  type ImageRecord,
  type Collection,
  type Output,
  type ScanSession,
  type QueueView,
} from "./shared";
import { DiscoveryNotice } from "./discovery-notice";
import { discoveryBucket } from "./discovery";
import { eligibility } from "./discovery";
import { Icon, useAppearance } from "./appearance-react";
import { Photo, Viewer, OutputSettings, Jobs } from "./gallery-components";
import "./ui.css";
import "./gallery.css";
const collectionId =
  new URL(location.href).searchParams.get("collection") || "";
type Metadata = {
  collection: Collection;
  settings: typeof defaults;
  scan: ScanSession;
  ids: string[];
  changedIds: string[];
  jobs: QueueView[];
};
export type GalleryCommand = { type: string; [key: string]: unknown };
function App() {
  useAppearance();
  const [meta, setMeta] = useState<Metadata>(),
    [settings, setSettings] = useState(defaults),
    [records, setRecords] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true),
    [connectionError, setConnectionError] = useState(""),
    [actionError, setActionError] = useState("");
  const [selecting, setSelecting] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [drawer, setDrawer] = useState<"output" | "downloads" | null>(null);
  const [query, setQuery] = useState(""),
    [format, setFormat] = useState(""),
    [min, setMin] = useState(0),
    [sort, setSort] = useState("discovered"),
    [review, setReview] = useState("accepted"),
    [density, setDensity] = useState("medium");
  const [output, setOutput] = useState<Output>({ ...defaultOutput }),
    [pending, setPending] = useState(0),
    [viewer, setViewer] = useState<{ ids: string[]; index: number }>();
  const [viewport, setViewport] = useState({ width: 1000, height: 700 }),
    [scroll, setScroll] = useState(0);
  const scroller = useRef<HTMLDivElement>(null),
    map = useRef(new Map<string, ImageRecord>()),
    revision = useRef(0),
    fetching = useRef(false),
    again = useRef(false),
    mounted = useRef(true),
    guard = useRef(new Set<string>()),
    retry = useRef<GalleryCommand | undefined>(undefined);
  const updateOutput = <K extends keyof Output>(key: K, value: Output[K]) => { setOutput((o) => ({ ...o, [key]: value })); };
  async function load() {
    if (fetching.current) {
      again.current = true;
      return;
    }
    fetching.current = true;
    try {
      const next = await rpc<Metadata>({
        type: "COLLECTION_META",
        collectionId,
        since: revision.current,
      });
      const changed = new Map(map.current);
      for (let offset = 0; offset < next.changedIds.length; offset += 200) {
        const batch = await rpc<{ records: ImageRecord[] }>({
          type: "COLLECTION_BATCH",
          collectionId,
          ids: next.changedIds.slice(offset, offset + 200),
        });
        if (!mounted.current) return;
        for (const record of batch.records) changed.set(record.id, record);
      }
      const valid = new Set(next.ids);
      for (const id of changed.keys()) if (!valid.has(id)) changed.delete(id);
      if (!mounted.current) return;
      if (next.changedIds.length || changed.size !== map.current.size) {
        map.current = changed;
        setRecords([...changed.values()]);
      }
      revision.current = next.collection.revision;
      setMeta(next);
      setSettings((old) =>
        JSON.stringify(old) === JSON.stringify(next.settings)
          ? old
          : next.settings,
      );
      setConnectionError("");
    } catch (e) {
      if (mounted.current)
        setConnectionError(e instanceof Error ? e.message : String(e));
    } finally {
      fetching.current = false;
      if (mounted.current) {
        setLoading(false);
        if (again.current) {
          again.current = false;
          void load();
        }
      }
    }
  }
  useEffect(() => {
    document.title = meta?.collection.title
      ? `${meta.collection.title} · Zephyer Photos`
      : "Zephyer Photos";
  }, [meta?.collection.title]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const listener = (m: any) => {
      if (m.type === "COLLECTION_NOTICE" && m.collectionId === collectionId)
        void load();
    };
    chrome.runtime.onMessage.addListener(listener);
    const storage = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes["settings"]) void load();
    };
    chrome.storage.onChanged.addListener(storage);
    const timer = setInterval(() => void load(), 30000);
    return () => {
      mounted.current = false;
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(storage);
      clearInterval(timer);
    };
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setViewport({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [loading]);
  async function command(request: GalleryCommand) {
    const key = request.type + (request.type === "JOB" ? request["id"] : "");
    const guarded = /DOWNLOAD|JOB/.test(request.type);
    if (guarded && guard.current.has(key)) return;
    if (guarded) guard.current.add(key);
    setPending((n) => n + 1);
    setActionError("");
    const actual = {
      ...request,
      ...(request.type.startsWith("COLLECTION_") ? { collectionId } : {}),
      ...(request.type.includes('DOWNLOAD') && !request["requestId"]
        ? { requestId: crypto.randomUUID() }
        : {}),
    };
    try {
      await rpc(actual as any);
      retry.current = undefined;
      await load();
    } catch (e) {
      retry.current = actual;
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      if (guarded) guard.current.delete(key);
      setPending((n) => n - 1);
    }
  }
  const classified = useMemo(
    () => records.map((r) => ({ ...r, eligibility: eligibility(r, settings) })),
    [records, settings],
  );
  const counts = useMemo(
    () => ({
      accepted: classified.filter((r) => r.eligibility.state === "accepted")
        .length,
      disabled: classified.filter((r) => discoveryBucket(r) === "disabled")
        .length,
      excluded: classified.filter((r) => discoveryBucket(r) === "excluded")
        .length,
      pending: classified.filter((r) => r.eligibility.state === "pending")
        .length,
    }),
    [classified],
  );
  const filtered = useMemo(() => {
    const values = filterRecords(
      classified.filter((r) => discoveryBucket(r) === review),
      query,
      min,
      format,
    );
    values.sort(
      sort === "name"
        ? (a, b) => a.name.localeCompare(b.name)
        : sort === "largest"
          ? (a, b) =>
              Math.max(0, ...b.variants.map((v) => v.width * v.height)) -
              Math.max(0, ...a.variants.map((v) => v.width * v.height))
          : (a, b) => (a.discoveredOrder || 0) - (b.discoveredOrder || 0),
    );
    return values;
  }, [classified, review, query, min, format, sort]);
  const selected = classified.filter(
    (r) => r.selected && r.eligibility.state === "accepted",
  );
  const size = density === "small" ? 110 : density === "large" ? 240 : 172,
    gap = 5,
    columns = Math.max(2, Math.floor((viewport.width + gap) / (size + gap))),
    tile = (viewport.width - gap * (columns - 1)) / columns,
    rowHeight = tile + gap,
    rows = Math.ceil(filtered.length / columns);
  const start = Math.max(
      0,
      Math.min(rows - 1, Math.floor(scroll / rowHeight)) - 2,
    ),
    end = Math.min(rows, Math.ceil((scroll + viewport.height) / rowHeight) + 2);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && el.scrollTop > Math.max(0, rows * rowHeight - viewport.height)) {
      el.scrollTop = Math.max(0, rows * rowHeight - viewport.height);
      setScroll(el.scrollTop);
    }
  }, [rows, rowHeight, viewport.height]);
  const choose = (id: string) =>
    void command({ type: "COLLECTION_SELECT", ids: [id] });
  const download = (ids: string[], zip: boolean, quality = output.quality) =>
    void command({
      type: "COLLECTION_DOWNLOAD",
      ids: [...ids],
      output: { ...output, quality, zip },
    });
  const show = (id: string) => { setViewer({
      ids: filtered.map((r) => r.id),
      index: filtered.findIndex((r) => r.id === id),
    }); };
  const closeViewer = () => {
    const id = viewer?.ids[viewer.index];
    setViewer(undefined);
    requestAnimationFrame(() => {
      const el = id
        ? document.querySelector<HTMLButtonElement>(
            `[data-image-id="${CSS.escape(id)}"] .photo-open`,
          )
        : null;
      (el || scroller.current)?.focus();
    });
  };
  const currentId = viewer?.ids[viewer.index];
  const current = currentId ? map.current.get(currentId) : undefined;
  return (
    <main className="photos-app" data-selecting={selecting}>
      <header className="photos-header">
        <div className="photos-identity">
          <span className="photos-mark">
            <Icon name="brand" />
          </span>
          <div>
            <h1>Photos</h1>
            <p title={meta?.collection.url}>
              {meta?.collection.title || "Zephyer gallery"}
            </p>
          </div>
        </div>
        <div className="photos-header-actions">
          <button
            aria-pressed={filterOpen}
            onClick={() => { setFilterOpen(!filterOpen); }}
          >
            <Icon name="search" />
            <span>Filters</span>
          </button>
          <button
            aria-pressed={selecting}
            onClick={() => { setSelecting(!selecting); }}
          >
            <Icon name="select" />
            {selecting ? "Done" : "Select"}
          </button>
          <button
            aria-label="Output and quality settings"
            title="Output and quality settings"
            onClick={() => { setDrawer(drawer === "output" ? null : "output"); }}
          >
            <Icon name="quality" />
          </button>
          <button
            aria-label="Downloads"
            title="Downloads"
            onClick={() => { setDrawer(drawer === "downloads" ? null : "downloads"); }
            }
          >
            <Icon name="download" />
            {meta?.jobs.some((j) => j.state === "running") && (
              <span className="photos-activity" />
            )}
          </button>
          <button
            aria-label="Preferences"
            title="Preferences"
            onClick={() => chrome.runtime.openOptionsPage()}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <section className="photos-context" aria-label="Collection status">
        <div>
          <strong>{counts.accepted.toLocaleString()} photos</strong>
          <span>
            {meta?.collection.state === "detached"
              ? "Source closed or changed · collected list retained"
              : meta?.scan.state === "running"
                ? "Collecting · new photos appear here"
                : meta?.scan.state === "paused"
                  ? "Scan paused · resume from the source page"
                  : "Collected from your website"}
          </span>
        </div>
        <label>
          Density{" "}
          <select
            aria-label="Grid density"
            value={density}
            onChange={(e) => { setDensity(e.target.value); }}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
      </section>
      {filterOpen && (
        <section className="photos-filters">
          <label>
            Search
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              placeholder="Name or source"
            />
          </label>
          <label>
            Minimum width
            <input
              type="number"
              min="0"
              max="100000"
              value={min || ""}
              onChange={(e) => { setMin(
                  Math.max(0, Math.min(100000, Number(e.target.value) || 0)),
                ); }
              }
            />
          </label>
          <label>
            Format
            <select value={format} onChange={(e) => { setFormat(e.target.value); }}>
              <option value="">All formats</option>
              {settings.allowedFormats.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(e) => { setSort(e.target.value); }}>
              <option value="discovered">Discovery order</option>
              <option value="largest">Largest first</option>
              <option value="name">Name</option>
            </select>
          </label>
        </section>
      )}
      <nav className="photos-segments" aria-label="Collection views">
        {(
          [
            ["accepted", "Useful"],
            ["excluded", "Hidden"],
            ["pending", "Pending"],
            ["disabled", "Formats off"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={review === value}
            onClick={() => { setReview(value); }}
          >
            {label}
            <span>{counts[value]}</span>
          </button>
        ))}
      </nav>
      <DiscoveryNotice
        records={classified}
        settings={settings}
        collectionId={collectionId}
        onError={setActionError}
      />
      {(connectionError || actionError) && (
        <div className="photos-error" role="alert">
          <span>{actionError || connectionError}</span>
          <button
            onClick={() =>
              actionError && retry.current
                ? void command(retry.current)
                : void load()
            }
          >
            <Icon name="retry" />
            Retry
          </button>
          {actionError && (
            <button
              aria-label="Dismiss error"
              onClick={() => { setActionError(""); }}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      )}
      <div
        className="photos-scroll"
        ref={scroller}
        tabIndex={-1}
        onScroll={(e) => { setScroll(e.currentTarget.scrollTop); }}
      >
        {loading ? (
          <div className="photos-empty">
            <Icon name="image" />
            <h2>Opening your photos</h2>
            <p>Preparing this collection…</p>
          </div>
        ) : !filtered.length ? (
          <div className="photos-empty">
            <Icon name="image" />
            <h2>
              {connectionError
                ? "Collection unavailable"
                : query || min || format
                  ? "No matching photos"
                  : review === "accepted"
                    ? "No useful photos yet"
                    : "Nothing here"}
            </h2>
            <p>
              {review === "excluded"
                ? "Hidden items include decorative assets and disabled formats."
                : "Return to the source page to collect images, or adjust your filters."}
            </p>
            {(query || min || format) && (
              <button
                onClick={() => {
                  setQuery("");
                  setMin(0);
                  setFormat("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div
            className="photos-canvas"
            role="list"
            aria-label="Collected images"
            style={{ height: rows * rowHeight }}
          >
            {Array.from(
              { length: Math.max(0, end - start) },
              (_, n) => start + n,
            ).map((row) => (
              <div
                key={row}
                className="photos-row"
                role="presentation"
                style={{
                  transform: `translateY(${row * rowHeight}px)`,
                  height: tile,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap,
                }}
              >
                {filtered
                  .slice(row * columns, (row + 1) * columns)
                  .map((record) => (
                    <Photo
                      key={record.id}
                      record={record}
                      collectionId={collectionId}
                      settings={settings}
                      selecting={selecting}
                      review={review !== "accepted"}
                      open={() => { show(record.id); }}
                      choose={() => { choose(record.id); }}
                      include={() =>
                        void command({
                          type: "COLLECTION_INCLUDE",
                          id: record.id,
                        })
                      }
                    />
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer className="photos-footer">
        <div>
          <strong aria-live="polite">
            {selected.length.toLocaleString()} selected
          </strong>
          <span>{filtered.length.toLocaleString()} shown</span>
        </div>
        <div className="photos-bulk">
          <button
            disabled={
              !filtered.some((r) => r.eligibility?.state === "accepted")
            }
            onClick={() =>
              void command({
                type: "COLLECTION_SELECT",
                ids: filtered
                  .filter((r) => r.eligibility?.state === "accepted")
                  .map((r) => r.id),
                value: true,
              })
            }
          >
            <Icon name="all" />
            Select all shown
          </button>
          <button
            disabled={!classified.some((r) => r.selected)}
            onClick={() =>
              void command({
                type: "COLLECTION_SELECT",
                ids: classified.filter((r) => r.selected).map((r) => r.id),
                value: false,
              })
            }
          >
            Clear
          </button>
          <button
            className="primary"
            disabled={!selected.length || pending > 0}
            onClick={() => { download(
                selected.map((r) => r.id),
                false,
              ); }
            }
          >
            <Icon name="download" />
            Download selected
          </button>
          <button
            disabled={!selected.length || pending > 0}
            onClick={() => { download(
                selected.map((r) => r.id),
                true,
              ); }
            }
          >
            <Icon name="zip" />
            Download ZIP
          </button>
        </div>
      </footer>
      {drawer && (
        <aside
          className="photos-drawer"
          aria-label={
            drawer === "output" ? "Output settings" : "Download queue"
          }
        >
          <div className="photos-drawer-heading">
            <h2>{drawer === "output" ? "Output settings" : "Downloads"}</h2>
            <button aria-label="Close drawer" onClick={() => { setDrawer(null); }}>
              <Icon name="close" />
            </button>
          </div>
          {drawer === "output" ? (
            <OutputSettings output={output} change={updateOutput} />
          ) : (
            <Jobs jobs={meta?.jobs || []} command={command} />
          )}
        </aside>
      )}
      {viewer && current && (
        <Viewer
          key={current.id}
          record={{ ...current, eligibility: eligibility(current, settings) }}
          settings={settings}
          collectionId={collectionId}
          index={viewer.index}
          total={viewer.ids.length}
          close={closeViewer}
          move={(delta) => { setViewer((v) =>
              v
                ? {
                    ...v,
                    index: Math.max(
                      0,
                      Math.min(v.ids.length - 1, v.index + delta),
                    ),
                  }
                : v,
            ); }
          }
          choose={() => { choose(current.id); }}
          download={(quality) => { download([current.id], false, quality); }}
          disabled={pending > 0}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
