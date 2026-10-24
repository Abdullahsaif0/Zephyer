# Validation — Zephyer 1.4.0

Verified on 23 October 2026 using fresh isolated Chromium profiles. Normal user Chrome profiles were not controlled.

## Completed checks

| Check | Result |
|---|---:|
| TypeScript strict check / production build | Passed |
| Prettier check on changed source and test files | Passed |
| Unit tests | 46 / 46 |
| Core browser scenarios | 18 / 18 |
| Dock / appearance browser scenarios | 19 / 19 |
| Discovery / scan / polish browser scenarios | 14 / 14 |
| Selection / destination browser scenarios | 10 / 10 |
| ZIP action browser scenarios | 3 / 3 |
| Liquid Glass / reliability browser scenarios | 15 / 15 |
| Archive contents, referenced assets and SHA-256 | Passed |
| Permissions / host access / CSP versus 1.3.1 | Unchanged |

**125 local unit/browser checks passed on the final implementation.** Public-site smoke observations below are not included in that count.

The new regression suite exercises failed-download navigation and persistent action errors, rapid-click deduplication, scrolled filtering, corrected thumbnail URLs, unsaved drafts and external preference updates, inline rejection, pending-save tracking, appearance rollback, detection/scan pause, late ZIP network failures, late Save as cancellation, bounded transport validation/cross-tab isolation and 50-row queue pagination. Existing suites verify actual original/converted bytes and ZIP entries, sequence/destination snapshots, selection safeguards, worker recovery and browser-restart persistence.

## Performance and visual evidence

- Final default-policy fixture: **5,000 records, 8 mounted cards**, one **148 ms** page task during initial fixture loading and **no gallery tasks above 50 ms**. There were no repeated page tasks above 100 ms. See test-results/polish/performance.json.
- Independent performance audit after transport hardening: **5,000 records, 8 cards**, one initial **165 ms** page task and a **61 ms** gallery task. See test-results/performance-audit/performance.json.
- The separate all-format core fixture mounted **6 cards** with one **178 ms** page task during the fixture run. See test-results/performance.json. These wall-clock measurements include fixture creation and browser work; they are not pure extension execution timings or a universal performance guarantee.
- A separate gallery observer exposed repeated long tasks with the original full-snapshot transport. The implementation now fetches records in validated batches of at most 200, omits duplicate source snapshots from queue views and renders per-file results only on demand, 50 at a time. Scan-container traversal yields even when elements are skipped, and normal-mode overlays avoid unnecessary eligibility work.
- Six themes were captured at **320 px and 430 px** panel widths, alongside preferences and on-page dock captures. No horizontal document overflow occurred. Actual glass style was blur(24px) saturate(1.45).
- Reduced motion, high contrast, forced colors, unsupported blur, 200% preferences zoom, light/dark page backgrounds, keyboard focus, drag bounds, hostname persistence and quality-menu focus were checked. Small on-page HUD text uses the primary foreground for legibility over bright pages.
- Screenshots are under test-results/liquid/. Reviewed Graphite/Porcelain libraries, the floating dock, scan-activity.png and forced-colors.png. Native Chrome side panels use the extension’s own ambient background; they do not blur the underlying webpage.
- Source scan found no emoji characters. Icons and the monogram are bundled SVG definitions; toolbar PNG sizes are reproducibly rendered with scripts/icons.mjs.

## Live-site compatibility

The first public-page attempt was blocked by sandbox network policy. A network-enabled retry completed **20 public-page observations across eight categories**. Four pages exposed content-image candidates (WordPress, Smashing Magazine, The Guardian and Wikipedia). Three returned HTTP 403, ten navigations were blocked/timed out, Google served an HTTP-200 unusual-traffic challenge, and Pinterest/Amazon rendered incomplete shells.

Screenshot review corrected candidate-only automated labels for Google, Pinterest and Amazon. A single candidate in a blank shell is not counted as a complete website compatibility pass. COMPATIBILITY.md records every result and reason; untouched automated observations remain in test-results/compatibility/automatic-results.json.

Fetch checks stop at response headers. Authenticated feeds, exhaustive full-site scanning and real-site bulk downloads remain unverified. The deterministic fixtures verify download bytes and recovery behavior; they do not remove website authentication or hotlink restrictions.

## Reproduction and limits

Run npm run build, npm test, npm run test:browser, npm run test:dock, npm run test:polish, npm run test:selection-downloads, npm run test:zip-actions and npm run test:liquid. Set CHROMIUM_PATH to a compatible installed Chromium. Browser profiles are created under test-results/. npm run test:compatibility requires external network access.

POLISH_FILTER=5000 runs the independent page/gallery performance audit and writes to test-results/performance-audit/. Regular polish runs retain the full scenario report. node scripts/verify-release.mjs checks every archived byte and unchanged permissions against the retained 1.3.1 archive.

ZIP input boundaries have unit coverage and runtime enforcement at 250 MB or 100 files; a real 250 MB stress archive was not generated. Actual archive contents were opened and verified. Save as arguments and cancellation races were tested through controlled API responses; native OS folder selection was not automated. Existing valid settings, collections and jobs remain compatible; the new metadata/batch transport is additive and does not change persisted image or download contracts.

## Delivery

- Version: **1.4.0**
- Source: H:/Zephyer/src/
- Unpacked extension: H:/Zephyer/dist/
- ZIP: release/zephyer-1.4.0.zip
- Archive: **149,027 bytes**, **17 files**
- SHA-256: **b343f7840c6850268ef797b2243fe17772628b30a7707c9d0d425a595c474f3c**
- Checksum: release/SHA256SUMS.txt

Extract the ZIP into the existing installation folder, reload its existing card at chrome://extensions, then refresh webpages. Keeping the same installation folder preserves settings and the sequence counter. README.md contains installation and usage instructions.
