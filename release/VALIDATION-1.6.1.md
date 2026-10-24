# Validation — Zephyer 1.6.1

24 October 2026 · Asia/Riyadh. Source findings and fixes are in [AUDIT.md](AUDIT.md).

**207 of 208 distinct checks passed. One full-suite source-page stress timing check remains unstable.** The final matrix is generated from the saved suite results in test-results/validation-summary.json. An isolated traced repeat passed the unchanged timing assertions; it does not erase the full-suite failure.

## Recorded checks

| Suite | Checks | Result |
|---|---:|---|
| Unit | 64 | Passed |
| New code-audit browser regressions | 12 | Passed |
| Core / dock / website power | 18 / 19 / 19 | Passed |
| Selection-download / ZIP actions / Liquid Glass | 10 / 3 / 15 | Passed |
| Discovery/polish, including completed-scan Stop | 14 | Passed |
| Photos Gallery | 28 | 27 passed; one full-suite source timing failure |
| Real archive upgrades: 1.5.0 and 1.6.0 | 3 + 3 | Passed |

Build/type checking and source/new-test formatting passed. Tests use isolated Chromium profiles. Toolbar activation invokes the same worker entry point as the native toolbar handler; an OS-level Chrome toolbar click itself is not automated. The fixture gallery imagery is generated local illustration data, not live-site photographs.

The audit regressions verify activation/power revision ordering with automatic collection Off, preserved Select mode, retained SPA records/selection, duplicated gallery references, idempotent tab downloads/number reservation, exact batch membership, failed scan dispatch, deterministic Stop after completion, preview ownership, dynamic picture sources, 401-record atomic batching, ZIP Blob cleanup and orphan-preview/collection recovery.

Both migration tests unpack a retained real archive into the same temporary extension directory, seed selection/preferences/numbering/a paused job, replace files with the current build and Reload its card. IndexedDB v3 adds indexes and retains the tested data. Chrome clears storage.session on extension reload; activation returns to inactive and needs another icon click. Live collection retention requires the same source document ID. Browser restart supplies new documents and ends old temporary collections.

## Performance investigation

- Full-suite Photos run: 5,000 records, 42 mounted tiles before filtering, one after filtering and two peak preview-processing requests. Native visible image loads are bounded by mounted tiles; the two-request metric refers to extension processing, not every browser image request.
- Its gallery recorded no Long Task API entries. Its source recorded 169, 64, 82, 119, 50, 50, 69, 1,372, 75 and 63 ms tasks. This fails the existing source timing assertion. This failure remains recorded in test-results/gallery/results.json and performance.json.
- The isolated traced repeat passed: gallery tasks 97, 66 and 115 ms; source tasks 310 and 98 ms. It again mounted 42 tiles, filtered to one and peaked at two processing requests. Trace analysis identified 1,701 content-script callbacks, a largest callback of 98.22 ms and none above 100 ms. See test-results/gallery-audit/performance.json, source-trace.json and trace-summary.json.
- The separate control experiment collected zero records without activation and 5,000 with activation. Inactive source task: 331 ms; activated source task: 148 ms. Identified content-script callback maxima: 5.475 ms inactive and 17.283 ms activated, with none above 100 ms. Its source remains foreground and does not reproduce every preceding full-gallery interaction. It therefore cannot attribute every full-suite spike or prove performance on other machines. See test-results/code-audit/attribution/measurements.json and the two traces.
- Earlier failures exposed expensive bulk IndexedDB callbacks. The final implementation uses indexed 200-record pages, bounded atomic write callbacks, requested-ID reads for small actions and coalesced asynchronous notifications. An intermediate per-ID bulk-read approach was replaced after it increased I/O. No timing threshold was weakened.

**Remaining performance limitation:** the broad Photos source-page timing result is unstable. Virtualization and request bounds are verified, but a universal sub-100 ms responsiveness claim is not justified. Raw source timings include fixture creation, browser/native work and extension work; passing isolated traces do not retrospectively classify every failed run.

## Security, dependencies and boundaries

- Content frames cannot issue gallery metadata/preview commands; collection membership, preview URLs/owners, top-level website power and current source documents are validated. Existing queue/destination/conversion contracts and signed URLs are preserved.
- No new permissions, host permissions, extension CSP, remote assets, backend or analytics. Local npm dependency-tree validation passed. The npm security-advisory endpoint request failed in this environment; dependency advisories were **not** verified clean. Its error is retained in test-results/code-audit/dependency-audit.json.
- Public-site observations in COMPATIBILITY.md are historical and were not repeated. Closed shadow roots, protected/expired resources and inaccessible pixels remain unavailable. Retaining a gallery does not recreate missing pixels or make an offline album.
- Native OS Save as interaction, a 250 MB archive stress run, every browser-crash instruction boundary and all Chrome/hardware combinations are not exhaustively automated. Temporary detached collections without a provable current session may end on extension reload. Downgrading an upgraded IndexedDB profile to an older build is unsupported.
- Six themes, narrow layouts, 200% zoom, reduced motion, keyboard/focus, blur fallback, conversion bytes, ZIP entries, queue interruption, numbering and selection boundaries are covered by the recorded suites. Passing fixtures do not prove absence of every unknown defect.

## Release and installation

Archive: release/zephyer-1.6.1.zip — 171,589 bytes, 21 files.

SHA-256: `f2f6f57bdd7b550e7644c1675d4c542fb0dccbababb91d57841d1637709b8d19`.

The archive integrity result is in release/release-verification.json. Every ZIP entry is checked byte-for-byte against dist/ and referenced HTML assets are checked. SHA256SUMS.txt contains the archive hash.

Load H:\Zephyer\dist through chrome://extensions → Developer mode → Load unpacked. To upgrade, replace the existing installation files and Reload the same extension card, refresh source webpages and gallery tabs, then click the pinned icon again. Preserve the existing installation/profile to retain preferences and numbering. The ZIP is an unpackable distribution, not a Chrome Web Store/CRX installer.

## Reproduce

Run npm run build and npm test. Browser suites: test:audit, test:browser, test:dock, test:power, test:selection-downloads, test:zip-actions, test:liquid, test:polish, test:gallery and test:migration. Set CHROMIUM_PATH for the available test Chromium. MIGRATION_FROM=1.6.0 selects the second migration archive; default is 1.5.0. GALLERY_ONLY=5000 with TRACE_GALLERY=1 performs the isolated stress trace without replacing the broad gallery results. Run node scripts/analyze-gallery-trace.mjs test-results/gallery-audit to summarize it. Run node tests/performance-attribution.mjs for the separate inactive/active control experiment.
