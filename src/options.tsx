import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { defaults, rpc, expandPreset, type Settings } from "./shared";
import { themes, themeIds, applyTheme } from "./appearance";
import { Icon, useAppearance } from "./appearance-react";
import "./ui.css";
import { imageFormats } from "./discovery";
import { Roadmap } from "./roadmap";
import { preferenceError } from "./preferences";
function Options() {
  useAppearance();
  const [s, setS] = useState<Settings>(defaults),
    [notice, setNotice] = useState(""),
    [sites, setSites] = useState("");
  const [nextSequence, setNextSequence] = useState(1);
  const [profileHost, setProfileHost] = useState("");
  const [profileFormats, setProfileFormats] = useState("");
  const [profileCleanup, setProfileCleanup] = useState(true);
  const [profileMin, setProfileMin] = useState(96);
  const [profileFolder, setProfileFolder] = useState("");
  const sitesBase = useRef<string[]>([]);
  const dirty = useRef(new Set<keyof Settings>()),
    versions = useRef(new Map<keyof Settings, number>());
  const saved = useRef<Settings>(defaults),
    saves = useRef(Promise.resolve());
  const [pending, setPending] = useState(0),
    [errors, setErrors] = useState<Partial<Record<keyof Settings, string>>>({});
  function mergeSaved(v: Settings) {
    saved.current = v;
    setS(
      (draft) =>
        Object.fromEntries(
          Object.keys(v).map((k) => [
            k,
            dirty.current.has(k as keyof Settings)
              ? draft[k as keyof Settings]
              : v[k as keyof Settings],
          ]),
        ) as Settings,
    );
    if (!dirty.current.has("disabledSites")) {
      sitesBase.current = [...v.disabledSites];
      setSites(v.disabledSites.join("\n"));
    }
  }
  useEffect(() => {
    void chrome.storage.local.get(["settings", "sequenceNext"]).then((r) => {
      mergeSaved({ ...defaults, ...r["settings"] });
      setNextSequence(r["sequenceNext"] || 1);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes["sequenceNext"])
        setNextSequence(changes["sequenceNext"].newValue || 1);
      if (changes["settings"])
        mergeSaved({ ...defaults, ...changes["settings"].newValue });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => { chrome.storage.onChanged.removeListener(listener); };
  }, []);
  function saveProfile() {
    const hostname = profileHost.trim().toLowerCase();
    if (!hostname) {
      setNotice("Enter an exact hostname first.");
      return;
    }
    const profile: Record<string, unknown> = {};
    const formats = profileFormats
      .split(/[\s,]+/)
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean);
    if (formats.length) profile["allowedFormats"] = [...new Set(formats)];
    if (profileCleanup !== defaults.smartCleanup)
      profile["smartCleanup"] = profileCleanup;
    if (profileMin !== defaults.minImageSize) profile["minImageSize"] = profileMin;
    if (profileFolder.trim()) profile["downloadFolder"] = profileFolder.trim();
    if (!Object.keys(profile).length) {
      setNotice("Add at least one override, or use Remove for an empty profile.");
      return;
    }
    const next = {
      ...s,
      siteProfiles: { ...s.siteProfiles, [hostname]: profile as never },
    };
    edit("siteProfiles");
    setS(next);
    persist(next, sites, ["siteProfiles"]);
    setProfileHost("");
    setProfileFormats("");
    setProfileFolder("");
    setNotice(`Profile saved for ${hostname}.`);
  }
  function deleteProfile(hostname: string) {
    const profiles = { ...s.siteProfiles };
    Reflect.deleteProperty(profiles, hostname);
    const next = { ...s, siteProfiles: profiles };
    edit("siteProfiles");
    setS(next);
    persist(next, sites, ["siteProfiles"]);
    setNotice(`Profile removed for ${hostname}.`);
  }
  function edit(k: keyof Settings) {
    dirty.current.add(k);
    versions.current.set(k, (versions.current.get(k) || 0) + 1);
  }
  function persist(
    next: Settings,
    hosts = sites,
    keys: (keyof Settings)[] = ["disabledSites"],
  ) {
    const value = {
      ...next,
      disabledSites: [
        ...new Set(
          hosts
            .split(/[\n,]/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
    };
    const baseline = [...sitesBase.current];
    const stamps = new Map(keys.map((k) => [k, versions.current.get(k) || 0]));
    const invalid = Object.fromEntries(
      keys.map((k) => [k, preferenceError(k, value)]).filter(([, e]) => e),
    );
    setErrors((old) => {
      const result = { ...old };
      for (const k of keys) Reflect.deleteProperty(result, k);
      return { ...result, ...invalid };
    });
    if (Object.keys(invalid).length) {
      setNotice("Check the highlighted preference.");
      return;
    }
    setPending((n) => n + 1);
    setNotice("");
    saves.current = saves.current
      .catch(() => {})
      .then(async () => {
        try {
          await rpc({
            type: "PREFERENCES",
            patch: Object.fromEntries(keys.map((k) => [k, value[k]])),
            ...(keys.includes("disabledSites")
              ? { disabledSitesBase: baseline }
              : {}),
          });
          const stored = await chrome.storage.local.get("settings");
          const persisted = { ...defaults, ...stored["settings"] };
          for (const k of keys)
            if (versions.current.get(k) === stamps.get(k))
              dirty.current.delete(k);
          mergeSaved(persisted);
          setNotice("All changes saved.");
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setErrors((old) => ({
            ...old,
            ...Object.fromEntries(
              keys
                .filter((k) => versions.current.get(k) === stamps.get(k))
                .map((k) => [k, message]),
            ),
          }));
          for (const k of keys)
            if (
              ["theme", "dockOrientation"].includes(k) &&
              versions.current.get(k) === stamps.get(k)
            ) {
              dirty.current.delete(k);
              setS((d) => ({ ...d, [k]: saved.current[k] }));
              if (k === "theme")
                applyTheme(document.documentElement, saved.current.theme);
            }
          setNotice("Some changes could not be saved.");
        } finally {
          setPending((n) => n - 1);
        }
      });
  }
  const change = (k: keyof Settings, v: any) => {
    edit(k);
    const next = { ...s, [k]: v };
    setS(next);
    persist(next, sites, [k]);
  };
  function changeAppearance(patch: {
    theme?: Settings["theme"];
    dockOrientation?: Settings["dockOrientation"];
  }) {
    for (const k of Object.keys(patch) as (keyof Settings)[]) edit(k);
    const next = { ...s, ...patch };
    setS(next);
    if (patch.theme) applyTheme(document.documentElement, patch.theme);
    persist(next, sites, Object.keys(patch) as (keyof Settings)[]);
  }
  useLayoutEffect(() => {
    applyTheme(document.documentElement, s.theme);
  }, [s]);
  const fieldError = (key: keyof Settings) =>
    errors[key] ? (
      <small className="field-error" id={`error-${key}`} role="alert">
        {errors[key]}
      </small>
    ) : null;
  return (
    <main className="preferences">
      <header>
        <div className="wordmark">
          <span className="logo">
            <Icon name="brand" />
          </span>
          <div>
            ZEPHYER<small>APPEARANCE & PREFERENCES</small>
          </div>
        </div>
      </header>
      <h1>Preferences</h1>
      <p className="intro">
        Set your theme, dock layout and discovery limits. Images stay on this
        device.
      </p>
      <section className="settings-section appearance-section">
        {fieldError("theme")}
        <div className="section-heading">
          <div>
            <h2>Color theme</h2>
            <p>Six palettes. Your choice stays fixed until you change it.</p>
          </div>
          <span className="settings-kicker">APPEARANCE</span>
        </div>
        <div className="theme-grid" role="group" aria-label="Color theme">
          {themeIds.map((id) => (
            <button
              key={id}
              type="button"
              className={"theme-card " + (s.theme === id ? "chosen" : "")}
              aria-pressed={s.theme === id}
              aria-label={`${themes[id].name} theme`}
              onClick={() => {
                changeAppearance({ theme: id });
              }}
              style={
                {
                  "--preview-bg": themes[id].bg,
                  "--preview-surface": themes[id].surface,
                  "--preview-accent": themes[id].accent,
                } as React.CSSProperties
              }
            >
              <span className="theme-preview">
                <span className="preview-mini-dock">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <span className="theme-caption">
                <strong>{themes[id].name}</strong>
                {s.theme === id && <Icon name="check" />}
              </span>
              <small>{themes[id].description}</small>
            </button>
          ))}
        </div>
        <p className="hint">
          Theme and dock layout changes save automatically and apply to open
          websites.
        </p>
      </section>
      <section className="settings-section">
        <h2>
          <Icon name="layout" /> Your floating dock
        </h2>
        <p>
          Use the grip to move it anywhere. Each website remembers its own
          position and size state.
        </p>
        <label>
          Dock orientation
          {fieldError("dockOrientation")}{" "}
          <select
            aria-label="Dock orientation"
            value={s.dockOrientation}
            onChange={(e) => {
              changeAppearance({
                dockOrientation: e.target.value as Settings["dockOrientation"],
              });
            }}
          >
            <option value="horizontal">Horizontal · compact bar</option>
            <option value="vertical">Vertical · slim rail</option>
          </select>
        </label>
        <button
          className="secondary reset-layout"
          onClick={() => {
            void (async () => {
              try {
                await rpc({ type: "DOCK_RESET", all: true });
                setNotice("Saved dock positions reset on all websites.");
              } catch (e) {
                setNotice(String(e));
              }
            })();
          }}
        >
          <Icon name="reset" /> Reset saved dock positions
        </button>
      </section>
      <section className="settings-section">
        <h2>Discovery</h2>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.instagramStoriesEnabled}
            onChange={(e) => { change("instagramStoriesEnabled", e.target.checked); }
            }
          />
          Optional Instagram still-image Stories
        </label>
        <p>
          Off by default. Story traversal requires Start and can change
          Instagram’s viewed status. Videos are skipped.
        </p>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.automaticCollection}
            onChange={(e) => { change("automaticCollection", e.target.checked); }}
          />{" "}
          Automatically collect images in activated tabs
        </label>
        <p>
          Click the extension icon to activate a tab. Automatic collection never
          scrolls the page.
        </p>
        <p>
          Only enabled formats enter your useful library. Conversion output is a
          separate choice when downloading.
        </p>
        <fieldset className="format-choices">
          <legend>Allowed image formats</legend>
          {imageFormats.map((format) => (
            <label key={format}>
              <input
                type="checkbox"
                checked={s.allowedFormats.includes(format)}
                onChange={(e) => { change(
                    "allowedFormats",
                    e.target.checked
                      ? [...s.allowedFormats, format]
                      : s.allowedFormats.filter((f) => f !== format),
                  ); }
                }
                disabled={
                  s.allowedFormats.length === 1 &&
                  s.allowedFormats.includes(format)
                }
              />
              {format.toUpperCase()}
            </label>
          ))}
        </fieldset>
        <div className="cleanup-controls">
          {(
            [
              ["smartCleanup", "Smart cleanup"],
              ["hideSmall", "Hide small decorative images"],
              ["hideBranding", "Hide likely interface icons and branding"],
              ["hideAvatars", "Hide likely avatars"],
            ] as const
          ).map(([key, label]) => (
            <label className="checklabel" key={key}>
              <input
                type="checkbox"
                checked={s[key]}
                disabled={key !== "smartCleanup" && !s.smartCleanup}
                onChange={(e) => { change(key, e.target.checked); }}
              />{" "}
              {label}
            </label>
          ))}
          <label>
            Small-image threshold · both dimensions below this value
            <input
              aria-label="Small-image threshold"
              type="number"
              min="0"
              max="4096"
              value={Number.isNaN(s.minImageSize) ? "" : s.minImageSize}
              aria-invalid={!!errors.minImageSize}
              aria-describedby={
                errors.minImageSize ? "error-minImageSize" : undefined
              }
              onChange={(e) => { change(
                  "minImageSize",
                  e.target.value === "" ? NaN : Number(e.target.value),
                ); }
              }
            />
            {fieldError("minImageSize")}
          </label>
          <p>
            Default: 96 px. Uses the largest known source, so a small displayed
            thumbnail with a larger original stays useful. Unknown dimensions
            stay eligible. Tracking pixels are hidden when Smart cleanup is on.
          </p>
          <p>
            Changes reclassify the current collection immediately. Find hidden
            images and their reasons in Library → Excluded; “Include this image”
            overrides cleanup for that image.
          </p>
        </div>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => { change("enabled", e.target.checked); }}
          />{" "}
          Enable Zephyer globally
        </label>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.alwaysVisible}
            onChange={(e) => { change("alwaysVisible", e.target.checked); }}
          />{" "}
          Always show image outlines and download buttons
        </label>
        <label>
          Disabled websites · exact hostnames
          <textarea
            value={sites}
            aria-invalid={!!errors.disabledSites}
            aria-describedby={
              errors.disabledSites ? "error-disabledSites" : undefined
            }
            onChange={(e) => {
              edit("disabledSites");
              setSites(e.target.value);
            }}
            onBlur={() => { persist(s); }}
            placeholder={"example.com\nwww.example.org"}
            rows={4}
          />
          {fieldError("disabledSites")}
        </label>
      </section>
      <section className="settings-section">
        <h2>Full-page scan</h2>
        <p>
          Scanning stops at the loaded page end. Infinite feeds pause at your
          chosen limit. Set a limit to 0 to disable it.
        </p>
        <div className="output-grid">
          <label>
            Active minutes
            <input
              type="number"
              min="0"
              value={Number.isNaN(s.scanMinutes) ? "" : s.scanMinutes}
              aria-invalid={!!errors.scanMinutes}
              aria-describedby={
                errors.scanMinutes ? "error-scanMinutes" : undefined
              }
              onChange={(e) => { change(
                  "scanMinutes",
                  e.target.value === "" ? NaN : Number(e.target.value),
                ); }
              }
            />
            {fieldError("scanMinutes")}
          </label>
          <label>
            Retained candidate limit · includes excluded and pending
            <input
              type="number"
              min="0"
              value={Number.isNaN(s.scanImages) ? "" : s.scanImages}
              aria-invalid={!!errors.scanImages}
              aria-describedby={
                errors.scanImages ? "error-scanImages" : undefined
              }
              onChange={(e) => { change(
                  "scanImages",
                  e.target.value === "" ? NaN : Number(e.target.value),
                ); }
              }
            />
            {fieldError("scanImages")}
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h2>Downloads</h2>
        <label>
          Download subfolder
          <input
            aria-label="Download subfolder"
            value={s.downloadFolder}
            aria-invalid={!!errors.downloadFolder}
            aria-describedby={
              errors.downloadFolder ? "error-downloadFolder" : undefined
            }
            placeholder="Zephyer or Pictures/My collection"
            onChange={(e) => {
              edit("downloadFolder");
              setS((s) => ({ ...s, downloadFolder: e.target.value }));
            }}
            onBlur={() => { persist(s, sites, ["downloadFolder"]); }}
          />
          {fieldError("downloadFolder")}
        </label>
        <p>
          Relative to Chrome’s Downloads location. Leave empty to save directly
          there. For another drive or folder, choose the location in Chrome
          settings, or enable the Save as dialog below.
        </p>
        <button
          onClick={() =>
            chrome.tabs.create({ url: "chrome://settings/downloads" })
          }
        >
          Choose Chrome Downloads location
        </button>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.groupDownloads}
            onChange={(e) => { change("groupDownloads", e.target.checked); }}
          />{" "}
          Create website and batch subfolders
        </label>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.askWhereToSave}
            onChange={(e) => { change("askWhereToSave", e.target.checked); }}
          />{" "}
          Ask where to save each file or ZIP
        </label>
        <p>
          Save as opens a Chrome picker for each file or archive. Cancel pauses
          remaining work; it never automatically reopens the picker.
        </p>
        <label>
          Filename prefix · optional
          <input
            aria-label="Filename prefix"
            value={s.sequencePrefix}
            aria-invalid={!!errors.sequencePrefix}
            aria-describedby={
              errors.sequencePrefix ? "error-sequencePrefix" : undefined
            }
            placeholder="photo"
            maxLength={60}
            onChange={(e) => {
              edit("sequencePrefix");
              setS((s) => ({ ...s, sequencePrefix: e.target.value }));
            }}
            onBlur={() => { persist(s, sites, ["sequencePrefix"]); }}
          />
          {fieldError("sequencePrefix")}
        </label>
        <p>
          Next image:{" "}
          <strong>
            {s.sequencePrefix ? `${s.sequencePrefix}-` : ""}
            {String(nextSequence).padStart(6, "0")}.jpg
          </strong>
          . File extensions follow the actual image format. Numbers continue
          across batches and browser restarts; retries keep their number.
          Cancelled/failed jobs can leave gaps. ZIP entries use the same
          numbering.
        </p>
        <label>
          Naming preset · token template
          <input
            aria-label="Naming preset"
            value={s.namingPreset}
            aria-invalid={!!errors.namingPreset}
            aria-describedby={
              errors.namingPreset ? "error-namingPreset" : undefined
            }
            placeholder="{hostname}-{date}-{index}"
            maxLength={120}
            onChange={(e) => {
              edit("namingPreset");
              setS((s) => ({ ...s, namingPreset: e.target.value }));
            }}
            onBlur={() => { persist(s, sites, ["namingPreset"]); }}
          />
          {fieldError("namingPreset")}
        </label>
        <div className="button-row" role="group" aria-label="Preset shortcuts">
          {([
            ["{hostname}-{date}", "Host + date"],
            ["{index}-{title}", "Number + title"],
            ["batch-{date}-{index}", "Batch + number"],
            ["", "Off"],
          ] as [string, string][]).map(([template, label]) => (
            <button
              key={label}
              onClick={() => {
                edit("namingPreset");
                const next = { ...s, namingPreset: template };
                setS(next);
                persist(next, sites, ["namingPreset"]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          Tokens: <code>{"{index}"}</code>, <code>{"{hostname}"}</code>,{" "}
          <code>{"{date}"}</code>, <code>{"{title}"}</code>. Example file:{" "}
          <strong>
            {s.namingPreset
              ? expandPreset(s.namingPreset, {
                  index: nextSequence,
                  hostname: "photos.example.com",
                  date: new Date().toISOString().slice(0, 10),
                  title: "Mountain view",
                }) + ".jpg"
              : (s.sequencePrefix ? `${s.sequencePrefix}-` : "") +
                String(nextSequence).padStart(6, "0") +
                ".jpg"}
          </strong>
        </p>
        <label>
          Concurrent tasks · 1–8
          <input
            type="number"
            min="1"
            max="8"
            value={Number.isNaN(s.concurrency) ? "" : s.concurrency}
            aria-invalid={!!errors.concurrency}
            aria-describedby={
              errors.concurrency ? "error-concurrency" : undefined
            }
            onChange={(e) => { change(
                "concurrency",
                e.target.value === "" ? NaN : Number(e.target.value),
              ); }
            }
          />
          {fieldError("concurrency")}
        </label>
        <p>
          Original files are preserved by default. ZIP archives split at 250 MB
          of input. Files save inside your Chrome Downloads folder.
        </p>
      </section>
      <p role="status" className="save-status">
        {pending
          ? `Saving ${pending} change${pending === 1 ? "" : "s"}…`
          : Object.values(errors).some(Boolean)
            ? "Some changes need attention. Review the highlighted fields."
            : notice || "Changes save automatically."}
      </p>
      <section className="settings-section">
        <h2>Site profiles</h2>
        <p>
          Per-hostname overrides. Profiles apply to discovery, downloads and
          the gallery on that site; everything else follows your global
          settings. Only overridden fields are stored.
        </p>
        {Object.keys(s.siteProfiles).length > 0 && (
          <ul className="profile-list">
            {Object.entries(s.siteProfiles).map(([hostname, profile]) => (
              <li key={hostname}>
                <div>
                  <strong>{hostname}</strong>
                  <small>
                    {Object.entries(profile as Record<string, unknown>)
                      .map(([field, value]) =>
                        field === "allowedFormats"
                          ? `formats ${Array.isArray(value) ? value.join(",") : ""}`
                          : `${field} ${String(value)}`,
                      )
                      .join(" · ")}
                  </small>
                </div>
                <button
                  aria-label={`Remove profile for ${hostname}`}
                  onClick={() => { deleteProfile(hostname); }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="profile-editor">
          <label>
            Hostname
            <input
              aria-label="Profile hostname"
              placeholder="www.example.com"
              value={profileHost}
              onChange={(e) => { setProfileHost(e.target.value); }}
            />
          </label>
          <label>
            Allowed formats · optional
            <input
              aria-label="Profile formats"
              placeholder="jpeg, png, webp"
              value={profileFormats}
              onChange={(e) => { setProfileFormats(e.target.value); }}
            />
          </label>
          <label>
            Min image size (px)
            <input
              aria-label="Profile minimum size"
              type="number"
              min="0"
              value={profileMin}
              onChange={(e) => { setProfileMin(Number(e.target.value) || 0); }}
            />
          </label>
          <label>
            Download folder · optional
            <input
              aria-label="Profile download folder"
              placeholder="Pictures/example"
              value={profileFolder}
              onChange={(e) => { setProfileFolder(e.target.value); }}
            />
          </label>
          <label className="checklabel">
            <input
              type="checkbox"
              checked={profileCleanup}
              onChange={(e) => { setProfileCleanup(e.target.checked); }}
            />{" "}
            Smart cleanup on this site
          </label>
          <button className="primary" onClick={() => { saveProfile(); }}>
            Save profile
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h2>What’s next</h2>
        <label className="checklabel">
          <input
            type="checkbox"
            checked={s.showUpcoming}
            onChange={(e) => { change("showUpcoming", e.target.checked); }}
          />{" "}
          Show upcoming features once per release in the library
        </label>
        <Roadmap ready manual />
      </section>
      <section className="settings-section">
        <h2>
          <Icon name="privacy" /> Private by design
        </h2>
        <p>
          No account, server, analytics or image uploads. Website requests go
          directly from your browser to the image host. Chrome permissions and
          server access restrictions still apply.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
