# Validation — Zephyer 1.6.0

Validated on 24 October 2026 (Asia/Riyadh), using isolated desktop Chromium profiles. **185 distinct checks passed:** 56 unit checks and 129 browser scenarios. The final two-case gallery audit repeats the six-theme scenario and adds one compact-dock regression; that repeated scenario is counted once.

| Suite | Passed |
|---|---:|
| Unit | 56 |
| Existing core / dock / website power | 18 / 19 / 19 |
| Existing selection-download / ZIP / Liquid Glass / polish | 10 / 3 / 15 / 14 |
| Photos gallery and activation, including final compact audit | 28 |
| Real 1.5 → 1.6 migration | 3 |

Machine-readable results are in test-results/validation-summary.json; individual assertions and screenshots remain alongside each suite. A passing automated check is evidence for its fixture and browser run, not a promise for every website.

## Release integrity

- Archive: release/zephyer-1.6.0.zip — 169,296 bytes, 21 files.
- SHA-256: `22d57b83a94904c92f27f59a81309713e8242bb85df2ffbd90e258cf62c6aeb4`.
- Every unpacked archive file was compared byte-for-byte with dist/. HTML asset references were checked. Permissions, host permissions and extension CSP remain unchanged against the retained prior release.
- TypeScript/build and all 56 unit checks passed. Formatting was checked for source, scripts and the new gallery/migration/activation tests; this is not a claim about formatting every historical file.

## Behavior and coverage

- Fresh isolated profiles verify dormant startup: no on-page host, image records or automatic verification before activation. The native side-panel auto-open setting is disabled. Tests invoke the same worker entry point used by the toolbar listener; an OS-level click on Chrome's toolbar itself is not automated.
- Automatic collection, one-pass scanning, full-page scrolling and website permission are separate states. Delayed MIME verification is included in a bounded manual-scan settle period; recycled image controls cannot select an unrelated cached family while automatic collection is Off.
- Gallery checks cover square final rows, explicit preview versus selection, filtered Select all snapshots, stable viewer order, zoom/keyboard/focus, duplicate ZIP submission, validated collection membership and rejection of content-frame gallery commands.
- Source navigation/close detaches retained galleries. Selected families survive refresh/worker restart; detached PNG/ZIP outputs are read back and their bytes/archive entries checked. Last-gallery cleanup leaves jobs intact. Browser restart ends temporary collections and activation.
- A separate test unpacks the retained real 1.5.0 archive, creates selected records/settings/numbering/a paused job, replaces its files in the same directory and reloads the extension. It verifies IndexedDB v2 migration and opens the migrated collection in Photos. Developer mode is enabled only in that isolated test profile, matching the documented installation flow.
- Existing browser fixtures explicitly simulate toolbar activation. Their prior automatic-start assumption is not used as evidence for the new dormant default. Existing unit/download/ZIP/dock/reliability checks are rerun.

## Performance and visuals

Current measurements and raw records are under test-results/gallery/. The gallery uses visible rows plus overscan, incremental record revisions, batches of at most 200 and two concurrent preview-processing requests. Timing assertions separately observe gallery and source-page long tasks; fixture creation and browser work are included and are not pure extension CPU timings.

Full-run source-page timing initially exposed repeated long tasks. Discovery now reads only incoming record IDs rather than rebuilding the entire collection for every batch. Stale-image validation is limited to visible controls/actions, and idle count updates no longer query animation objects. No timing threshold was relaxed.

The final traced 5,000-image run mounted 42 gallery cards before filtering and one after filtering; preview processing peaked at two concurrent requests. The gallery recorded no long tasks. Source-page Long Task API durations were 239 ms and 50 ms, including fixture/native work. Trace analysis identified 1,608 extension callbacks, a largest callback of 49.987 ms and no identified extension callback above 100 ms. Native rendering/intersection work also appears in the trace; this evidence does not retrospectively attribute every earlier wall-clock delay or guarantee timings on other machines. Raw performance.json, source-trace.json, source-cpu-profile.json and trace-summary.json are retained in test-results/gallery/.

Screenshots include all six themes at 1280 px and 320 px, a full-image viewer and 200% zoom. Their landscapes are locally generated deterministic illustration fixtures, not photographs scraped from a live site. Grid cropping is presentational; the viewer and exported files retain image bounds. Reduced motion, keyboard focus and document overflow are checked. Glass belongs to the extension's own surfaces and does not pretend to reveal the source website through a separate tab.

Final visual review: test-results/gallery-audit/graphite-1280.png, compact-320.png and photos-viewer.png. The compact audit confirms new expanded-only actions remain hidden in compact mode and Power/Download/Library/More remain within the viewport.

## Limits and compatibility

- Public-site observations in COMPATIBILITY.md are retained from 1.4 and were not repeated for this activation/gallery release. They include network restrictions and incomplete pages; they are not a universal compatibility guarantee.
- Balanced cleanup uses declarations, context and dimensions. Ambiguous or unknown-size images remain reviewable; raster logos cannot be identified perfectly without content analysis. No remote AI is used.
- Detached Blob URLs, expired signed URLs, protected resources and page-origin-only pixels may become unavailable. Retaining a collection does not create an offline album. Background processing never guarantees authentication/hotlink bypass.
- Temporary collections end on browser restart. Download history/jobs still contain their own existing source snapshots, including locally captured inline bytes where applicable; gallery cleanup does not delete already-downloaded files or job history.
- Existing image-processing limits and bounded ZIP splitting remain in force. The archive tests verify real entries; a 250 MB stress archive and native OS Save as folder picker are not automated.

## Reproduce and install

Run npm run build, npm test, npm run test:migration, npm run test:gallery, npm run test:browser, npm run test:dock, npm run test:power, npm run test:selection-downloads, npm run test:zip-actions, npm run test:liquid and npm run test:polish. CHROMIUM_PATH can point to the installed compatible test Chromium. All browser profiles are isolated under test-results/.

GALLERY_ONLY=5000 runs just the standalone stress case. PROFILE_GALLERY=1 additionally saves a DevTools CPU profile for the source renderer; profiling itself can affect wall-clock measurements. These flags do not weaken timing assertions.

Install release/zephyer-1.6.0.zip by extracting it into a permanent existing installation folder, then Reload its card at chrome://extensions with Developer mode enabled. Refresh existing webpages. Click Zephyer's pinned icon to activate a tab, then open Photos Gallery from its dock or library. Source is in src/ and the unpacked build is dist/.
