# Zephyer

A private Manifest V3 Chrome extension for automatic image discovery, page selection, full-page scanning, original downloads, local conversion and ZIP export. No server, account or API key is needed.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select **`H:\Zephyer\dist`**.
3. Pin Zephyer using Chrome's Extensions menu. Refresh websites that were already open when you installed it.
4. Click the pinned extension icon to activate the current tab and reveal the dock. Hover over images for controls. Use **Library** for the side panel or **Open Photos Gallery** for a clean full-tab gallery.

To install from `release/zephyer-1.7.0.zip`, extract it to a permanent folder and select that folder using **Load unpacked**. The selected folder must directly contain `manifest.json`. Chrome does not install this ZIP by dragging it into the browser. When upgrading, replace files in the existing extension folder and Reload its existing card to preserve the extension's settings and sequence counter.

After rebuilding, click **Reload** on the extension card, then refresh your website. Requires Chrome 116 or newer; current desktop Chrome is recommended.

## Social compatibility and reliable activation · 1.7

- Click the pinned icon. Zephyer checks its document receiver, injects a missing receiver and verifies that the dock mounted. A failed attempt shows a badge and local troubleshooting page with Retry and Chrome site-access guidance.
- Instagram, Facebook, X and Pinterest receive scoped media classification and post/slide identity when the page exposes sufficient evidence. Generic discovery remains available. Signed URLs are preserved.
- **More options → Start carousel scan** traverses the current supported post/viewer, up to 50 items, and restores its initial slide when reliable previous controls exist. It does not open other posts. Exit Select mode first; use the normal scan Pause/Resume/Stop controls.
- **Preferences → Optional Instagram still-image Stories** is Off by default. Enable it, open a Story tray, then explicitly Start Story scan and acknowledge that advancing can affect viewed status. Unverifiable tray boundaries stop traversal; navigate manually in that case. Video downloading is not included.
- JPEG/PNG remain defaults. **Formats off** shows disabled formats. **Enable WebP/AVIF** is an explicit global discovery change, separate from conversion output. Pending items explain failed verification and offer Retry.
- Previews, conversion and ZIP need readable bytes. Original browser downloads may have different access. File results expose the retrieval stage and fallback status. Same-post/slide expiry refresh requires a live source and a stable identity; it cannot recover inaccessible originals.

Upgrade from an older build: Reload the same extension card, refresh existing website tabs and reopen the side library. Refresh is especially important for pre-1.7 content scripts, which did not have generation-disposal hooks. Click the pinned icon again. Existing jobs, preferences, selections and sequential naming remain compatible; activation and collections retain their documented temporary-session lifecycle.

See [1.7 validation and live compatibility limitations](release/VALIDATION-1.7.0.md). Local fixtures validate adapter behavior; live authenticated platform support must not be inferred from those fixtures.

## Side-library scrolling fix · 1.6.2

Short side panels can now scroll past the controls to the images and download actions. The image grid keeps its own bounded, virtualized scroll area and supports keyboard scrolling, including at 200% browser zoom. **Open side library** opens Chrome's panel; **Open Photos Gallery in new tab** opens the separate Photos workspace. See [the focused validation report](release/VALIDATION-1.6.2.md).

## Reliability audit · 1.6.1

The audit patch protects retained galleries during SPA navigation, makes tab download retries idempotent, rejects incomplete download batches, hardens scan/queue recovery, releases failed ZIP/preview resources and enforces streaming transfer limits. IndexedDB v3 adds paged-read indexes while preserving existing records/jobs. See [AUDIT.md](AUDIT.md) for findings and [VALIDATION.md](VALIDATION.md) for actual results and limits.

Upgrade the existing Chrome extension installation, Reload its card, then refresh source webpages and any open gallery tabs so they use the corrected build. Chrome Reload can reset session activation; click the pinned icon again. Live collections retain their data when the source document still matches; detached temporary galleries may end on extension reload. Keep using 1.6.1 or newer after the database upgrade; downgrading an existing profile to an older database version is unsupported.

## Photos Gallery and click activation · 1.6

- **Before icon click:** no dock, hover controls, discovery or automatic image-verification requests. The website's own image/network requests are unaffected. The small content bootstrap checks state without traversing images.
- Click the toolbar icon to activate **this tab**. The floating dock appears; the side panel does not open automatically. Repeated icon clicks reveal/restore the dock. Activation survives refresh, navigation and worker restart, and ends on tab close or browser restart. Other tabs need their own activation.
- **Automatically collect images** defaults On and can be changed in Preferences or dock controls. It only runs in activated, permitted tabs and never scrolls the page. Turn it Off to retain existing results without background discovery. **Scan now** collects the loaded page; **Scan full page** explicitly scrolls the page using existing limits/Pause/Stop controls.
- **Open Photos Gallery** is available in the dock's More options, expanded controls and side library. It opens a source-bound extension tab; repeating the action focuses the same collection. It never opens automatically. A completed scan highlights the expanded gallery action.
- The square Photos grid has Small/Medium/Large density, search, minimum width, format and sort controls. Only visible rows and a small surrounding area mount. Grid cropping never changes original files.
- Click an image for a fitted full-image viewer, Previous/Next, zoom, drag-to-pan, quality, details, selection and Download. Arrow keys navigate, +/− zoom and Escape closes the viewer and restores grid focus. Viewer navigation retains the filtered ordering captured when opened.
- **Select** switches tile clicks to selection. Checkboxes always select; preview/selection never submits a download. Select all shown snapshots the filtered useful images; newly collected images remain unselected. Download selected and Download ZIP reuse the existing quality/conversion, sequence and destination engine.
- Useful / Hidden / Pending review separates content from decorative assets and unknown formats. Declared favicons and contextual interface emoji are hidden; uncertain images are retained. Include this image overrides cleanup, but cannot override a disabled format. Pixel-only logo detection is not guaranteed.
- While its original document is live, gallery selection and new discoveries synchronize with the source/library. Navigating or closing the source detaches the old gallery without replacing its list. Normal accessible URLs remain usable; expired, protected or page-owned Blob sources may become unavailable.
- These are **temporary session collections**, not permanent albums. Gallery refresh and worker restart retain them. Closing the last gallery after its source detaches cleans its metadata; jobs retain their own snapshots and continue independently. Browser restart ends these sessions; reopening an old gallery explains that the session ended.
- Original files are fetched/decoded on viewer/download demand. Large or unmeasured thumbnails use a bounded 512px preview pipeline with two concurrent processing requests, cancellation and Blob-URL cleanup. Gallery tiles do not blur image pixels. No backend, analytics, remote AI or new Chrome permissions.

Upgrade: keep the existing installation folder, replace its files, Reload its card with Developer mode enabled, then refresh open websites. Existing preferences, sequence counters and jobs remain compatible. The storage upgrade backfills still-live 1.5 image records into collections without activating their tab; stale records from ended documents remain temporary. Missing automatic-collection preference defaults On; activation always requires the toolbar click after the upgrade/restart.

Actual captures using locally generated illustration fixtures: [Graphite gallery](test-results/gallery/graphite-1280.png), [narrow Porcelain](test-results/gallery/porcelain-320.png), [full-image viewer](test-results/gallery/photos-viewer.png). See [VALIDATION.md](VALIDATION.md) for tests, timing evidence and limits.

## Website On/Off · 1.5

- After toolbar activation, HTTP/HTTPS websites are **On** unless globally paused or excluded. Use the dock's **Power** button or the library's website switch to turn the current website Off/On.
- Each **exact hostname** remembers its choice across refreshes and browser restarts. All open tabs on that hostname synchronize; subdomains keep independent choices. Accessible embedded frames follow their top-level website's rule.
- Off removes hover controls, selection outlines and the scan HUD. A small draggable **Zephyer off · Turn on** pill remains, with keyboard movement and viewport bounds. Turning On restores the saved dock orientation, position and compact/expanded/minimized preference.
- The existing collection and selection remain available while Off. Turning On discovers the current page afresh, but does not re-enter page selection mode. Normal navigation still starts a new document collection.
- Off pauses a running scan. Turning On does **not** resume it: choose **Resume** explicitly. Already queued downloads continue; use their independent Pause/Cancel controls in Downloads.
- Global pause takes priority. The library shows **Globally paused**, and the pill opens Preferences; a website switch cannot silently enable global detection.
- Automatic discovery observers and verification requests stop while Off; stale callbacks are rejected. The website's own network activity is unaffected. Existing library previews and user-requested downloads remain available.
- At narrow widths, **Expand** moves into **More options**, keeping Power, download and library controls accessible. Failed setting writes retain the committed state and offer Retry.
- Preferences' disabled-host editor merges additions/removals against its editing baseline, preserving unrelated changes from other tabs. Existing exclusions, themes, layouts and download jobs are preserved without new permissions.

Actual fixture screenshots: [On dock](test-results/power/on-dock.png), [Off activation pill](test-results/power/off-pill.png), [library website switch](test-results/power/library-off.png). Validation and measured limits are in [VALIDATION.md](VALIDATION.md).

## Liquid Glass and reliability · 1.4

- Shared translucent materials, luminous edges and custom SVG icons across the dock, scan HUD, image controls, library, downloads and preferences. Graphite remains the default; all six palettes remain manually selectable and persistent.
- The on-page dock blurs only the content immediately behind its own surface. The native Chrome panel uses its own ambient background. Image previews stay sharp and no full-screen blur is applied.
- Scanning uses a localized glass sweep and short count transitions. Reduced motion disables nonessential movement; higher contrast, reduced transparency and unsupported blur use readable solid surfaces.
- Failed downloads stay in Library with a persistent error. Background refreshes cannot erase action errors, and rapid download clicks cannot submit duplicate jobs.
- Large libraries load through validated 200-record batches; queue views omit duplicated source snapshots and show per-file results only on demand, 50 rows per page. Download and persisted image contracts remain unchanged.
- Filtered virtual scrolling clamps to valid rows; corrected thumbnail URLs recover automatically. Empty/filter/loading states offer a next action.
- Preferences retain unsaved edits, synchronize externally changed clean fields, show field-specific validation and keep Saving visible until all pending writes finish. Rejected appearance changes restore the saved palette.
- Global or per-site detection pause also pauses an active scan. Re-enable detection, then Resume explicitly. Stop remains available from the library. Cancelled jobs reject stale resume/retry requests, including late ZIP/Save as failure races.
- The upcoming-features banner stays outside active scans and unfinished running/paused download work. It remains skippable and clearly labels unavailable features as planned.

Screenshots from the isolated fixture browser: [Graphite library](test-results/liquid/graphite-library-430.png), [Porcelain narrow library](test-results/liquid/porcelain-library-320.png), [floating dock](test-results/liquid/graphite-dock.png) and [preferences](test-results/liquid/graphite-preferences.png). These are actual extension captures, not concept mockups.

## Selection and download destination · 1.3

- **Download ZIP:** select images, then click **Download ZIP** in the library footer. On the page, open the dock's **More options → Download selected ZIP**. Both actions archive exactly the current selection and are disabled when nothing is selected. Library ZIP uses the current output format/quality; dock ZIP uses best-available originals. Both respect destination and sequence settings. Choosing ZIP once does not change the library delivery dropdown for later downloads. To archive the whole filtered library, use **Select all shown**, then **Download ZIP**.
- **Selection never submits a download job.** Select mode uses a separate image-sized click surface and suppresses image pointer/click handlers on the page. Selection outlines remain stable during discovery updates. Small displayed images show a Select control without an overlapping Download button; their hover controls still offer an explicit Download action.
- **Selected count:** the dock shows total images with a separate checkmark and selected number, including compact, vertical and minimized layouts. The library also shows the full selected count.
- **Preferences → Downloads → Download subfolder:** enter a relative folder such as `Pictures/My collection`; Windows-style backslashes are normalized. Leave it empty for the Downloads root. Turn off **Create website and batch subfolders** to save directly into that folder.
- **Choose Chrome Downloads location** opens Chrome's download settings, where you can choose another drive or base folder. **Ask where to save each file or ZIP** opens Chrome's Save as dialog for every output. Chrome's Downloads API accepts relative destinations; an extension cannot silently set an arbitrary absolute path. [Chrome Downloads reference](https://developer.chrome.com/docs/extensions/reference/api/downloads#type-DownloadOptions).
- **Continuous numbering:** new image downloads use `000001.png`, `000002.jpg`, etc. An optional prefix produces names such as `photo-000003.png`. Numbers continue across single downloads, batches, websites and browser restarts in the same installed extension/profile. ZIP image entries share the same sequence. Retries keep their reserved number; cancelled or failed jobs may leave gaps. Existing queued jobs keep their previous naming rules.
- Folder, prefix, picker mode and sequence assignments are saved in the job snapshot. Changing Preferences does not redirect or rename an existing job. Cancel in Save as stops that output and pauses remaining work without reopening the picker; temporary conversion/archive URLs are released.
- These preferences save when toggled or when leaving a text field. Chrome's own prompts and filename collision rules still apply. If you manually rename a file in Save as, that user-chosen name takes precedence.

## Useful discovery and scanning

- **JPEG and PNG are enabled by default.** Preferences → Discovery lets you opt into WebP, AVIF, GIF, SVG, BMP, ICO and TIFF independently. These choices affect discovery and download candidates; output conversion remains a separate setting.
- **Smart cleanup** hides tracking pixels, assets whose two known dimensions are below 96 px, and likely interface icons/branding identified from combined semantic context. Avatars are retained unless you opt to hide them. Threshold and individual rules are adjustable. Unknown dimensions are retained; a small thumbnail with a larger discovered original stays useful.
- **Useful / Excluded / Pending** separates usable content from rule exclusions and unresolved formats. Excluded cards explain their reason and load no preview until you click. **Include this image** overrides cleanup for that image in the current collection; disabled formats must be enabled in Preferences first.
- Extensionless network sources use two concurrent verification slots, HEAD requests and a bounded 4 KB byte probe when needed. Requests time out and deduplicate for the document. Failed checks remain Pending; signed query strings are preserved. Verification itself can make network requests even while previews remain off.
- **Scan HUD:** a small companion above/below the dock shows scanning/waiting/paused states, useful/excluded/pending counts, elapsed time and steps. A restrained sweep and up to three brief new-image highlights provide feedback. Pause/Resume and Stop remain accessible. Minimize hides the HUD while retaining the activity indicator. Reduced motion disables nonessential animation.
- Scan recovery appears **paused** after a worker interruption. Resume starts a fresh pass and retains collected records. Detached/navigated frames and stale scan sessions cannot keep the current scan running indefinitely.
- **All preferences save automatically.** Invalid values display an error and do not replace saved values; disabled-host, folder and filename-prefix text saves when leaving its field.
- The library's skippable **upcoming-features banner** appears once per extension release, outside active scanning. Skip/close hides it; **Don’t show again** disables future automatic banners. Preferences always contains the roadmap. Planned site profiles, duplicate review and naming presets are previews, not implemented features or release promises.

Upgrading from 1.0/1.1: reload the existing extension at `chrome://extensions`, then refresh websites. Missing discovery preferences adopt JPEG/PNG and Smart cleanup. Existing themes, dock layouts and download jobs remain compatible; already-created jobs retain their settings.

![Scan HUD](test-results/polish/scan-hud.png)

## Movable dock and appearance

- Drag the **six-dot grip** to move the dock in any direction. Buttons perform their actions without dragging.
- **Expand** opens the full control set. **Minimize** leaves a small image-count pill; **Restore** returns to your previous compact or expanded state. Scans, downloads and selections continue.
- Preferences → **Dock orientation** chooses a horizontal bar or vertical rail. Orientation changes save immediately.
- Choose **Graphite, Porcelain, Midnight, Forest, Dusk or Sand** in Preferences. Theme selection saves immediately and stays fixed across reloads, browser restarts and operating-system appearance changes.
- Each exact hostname remembers its dock position and state. Position saves when you release the grip. Window resizing and zoom clamp it back inside the viewport.
- Overflow **More options → Reset position** resets the current website. Preferences → **Reset saved dock positions** resets all websites.
- Focus the grip and use arrow keys to move by 10 px, or Shift + arrows for 40 px. Escape cancels a drag. Reduced-motion preferences disable nonessential transitions.
- The native Chrome library side panel keeps its browser-managed placement. These movement controls apply to the on-page dock.

Upgrading from 1.0: reload the extension card at `chrome://extensions`, then refresh your open websites. Existing settings and image/download records remain compatible; missing appearance values default to Graphite and horizontal.

## Use

- **Select mode / Page selection:** outlines and checkboxes appear around visible detected images. Click an image or checkbox to toggle it; press Escape to leave selection mode. The gallery and page share one selection.
- **Select all shown:** selects the filtered gallery snapshot. Newly discovered images remain unselected. **Clear** clears the whole collection's selection. Page-toolbar Select all selects the whole current collection.
- **Full-page scan:** scrolls the page, accessible frames and nested scroll containers, discovers lazy-loaded content, and preserves collected records from virtualized feeds. It restores scroll positions on completion or Stop. Pause/Resume are available.
- **Scan limits:** default 10 active minutes or 10,000 records, followed by a safety pause. Preferences can raise either limit; 0 disables it. Raise a reached limit before resuming. Infinite feeds never receive an “all images found” guarantee.
- **Quality:** Best available, Displayed version, or an explicit discovered variant. Unmeasured lazy/original candidates are probed on demand. Failed best candidates fall back, with the actual source and fallback status recorded in Downloads.
- **Output settings:** preserve original bytes, or convert to JPEG/PNG/WebP, resize while preserving aspect ratio, set JPEG transparency background and adjust JPEG/WebP compression. Upscaling is off by default. Animation/vector conversion requires explicit first-frame/static consent. Original animated files remain intact.
- **Downloads:** individual files or ZIP archives, queue pause/resume/cancel, Retry failed and per-file results. New discoveries do not change a job already submitted.
- **Preferences:** global pause, exact-hostname exclusions, always-visible buttons, scan limits and 1–8 concurrent tasks. Changes apply to open websites.

By default downloads use Chrome's configured Downloads folder, inside `Zephyer/<hostname>/<timestamp>/`. Preferences can customize the subfolder, grouping and Save as behavior. Chrome/system file prompts or restrictions remain effective. Archives split at 250 MB of input **or 100 files**, whichever comes first; a single processing input over 250 MB must use direct original download.

## Detection and compatibility

Discovery covers image elements, responsive candidates, common lazy attributes, linked originals, CSS/pseudo backgrounds, inline SVG, SVG references, readable canvases, open Shadow DOM, permitted frames, resource timing and image metadata. Site adapters cover published Google/Bing image links, Pinterest originals, Instagram responsive candidates, WordPress image attributes and Shopify CDN width variants. Generic scanning remains available if an adapter produces no extra candidates.

[COMPATIBILITY.md](COMPATIBILITY.md) records 20 live public-page checks across eight categories, including blocked sites. These are automated initial-discovery/header-fetch checks, **not** full account-specific manual certification. A successful logo/preview fetch does not prove an original-resolution photo will download.

Known limits:

- Chrome internal pages, Chrome Web Store and other restricted pages cannot be injected into. Closed Shadow DOM, unreadable/tainted canvases and inaccessible sandboxed frames cannot be reliably extracted.
- Host permissions allow extension requests; they do not defeat expired URLs, authentication rules, anti-bot checks or server hotlink protection. Login-dependent content uses only your existing browser access where supported.
- “Best available” means the best candidate discovered and accessible, not a reconstruction of an unavailable original. Responsive descriptors and DOM dimensions can be estimates until probed.
- Gallery thumbnails for page-owned Blob URLs or hotlink-protected images can be unavailable even when owning-page download succeeds.
- Conversion is bounded to 64 megapixels, canvas capture to 40 megapixels, inline URL transfer to 8 MB, page-origin fallback transfer to 32 MB and fetched processing inputs to 250 MB. Failures are reported rather than silently skipped. These limits avoid uncontrolled tab/extension memory growth.
- A few custom/obscured scroll widgets may need manual scrolling. Virtualized source URLs can expire after their source page changes; collected metadata survives, but inaccessible pixels cannot be recreated.

## Local data and permissions

Preferences and per-hostname dock layouts live in `chrome.storage.local`; collected records and download jobs live in extension IndexedDB. Live collections detach on navigation/tab close when a gallery retains them; otherwise they clear. Retained galleries are temporary and end with the browser session. Job snapshots persist for recovery and retry; inline/data-URL captures include image bytes locally. Clear extension site data or remove the extension to erase this history. Browser-downloaded files remain in Downloads. Normal network files are not stored in an extra permanent extension image cache.

HTTP/HTTPS host access enables automatic discovery and image retrieval. Other permissions support Chrome downloads, the side panel, local storage, content-script injection, local offscreen processing, context menu, navigation cleanup and recovery alarms. There is no external service, remote executable code, analytics, cloud upload, debugger permission or native helper.

## Development and verification

```powershell
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run test:dock
npm run test:polish
npm run test:selection-downloads
npm run test:zip-actions
npm run test:liquid
npm run test:power
npm run test:gallery
node tests/migration-browser.mjs
npm run test:compatibility
npm run package
```

`npm run package` builds and creates `release/zephyer-1.6.1.zip`. Dependencies are pinned by `package-lock.json`. Build output is ready for Load unpacked without running a development server.

Browser tests use a separate Playwright profile under `test-results/`; they do not control your normal Chrome profile. Set `CHROMIUM_PATH` to an existing compatible Chromium executable if needed. Live compatibility checks need external network access and can receive different challenges in different environments.

[VALIDATION.md](VALIDATION.md) summarizes the completed checks. Raw browser results, the gallery screenshot, performance measurements and live-site screenshots are under `test-results/`.

## Architecture

- Appearance: shared theme tokens and custom vector icons; persistent dock controls keep focus and quality selections through discovery updates.
- Content scripts: incremental, time-sliced detection, per-document identities, stable virtualized-feed collection, isolated Shadow DOM controls and frame-local scan controllers.
- Service worker: validates commands and registered records, coordinates selections/frames, persists jobs and tracks browser download IDs. Files are staged before dispatch to help reconcile worker interruptions.
- Offscreen document: bounded local image processing, ZIP assembly and Blob URL lifetime. Idle documents close after downloads release their URLs.
- React side panel: virtualized image grid, filters, output settings and queue results. React options page manages local preferences.
- Recovery reconciles browser downloads and persistent job metadata; it does not rely on keeping a service worker alive indefinitely. Expired page-owned resources can still require an explicit retry from the original page.
