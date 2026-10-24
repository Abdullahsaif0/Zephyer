# Validation — Zephyer 1.5.0

Verified on 23 October 2026 using fresh isolated Chromium profiles. Normal user Chrome profiles were not controlled.

## Completed checks

| Check | Result |
|---|---:|
| TypeScript strict check / production build | Passed |
| Prettier check on changed source and test files | Passed |
| Unit tests | 51 / 51 |
| Core browser scenarios | 18 / 18 |
| Dock / appearance browser scenarios | 19 / 19 |
| Discovery / scan / polish browser scenarios | 14 / 14 |
| Selection / destination browser scenarios | 10 / 10 |
| ZIP action browser scenarios | 3 / 3 |
| Liquid Glass / reliability browser scenarios | 15 / 15 |
| Website power browser scenarios | 19 / 19 |
| Archive contents, referenced assets and SHA-256 | Passed |
| Permissions / host access / CSP versus 1.3.1 | Unchanged |

**149 local unit/browser checks passed on the final implementation.** Public-site smoke observations below are not included in that count.

The website-power suite verifies automatic On, exact-host rules, synchronized tabs, independent hostnames, parent-scoped cross-origin and newly inserted frames, mouse/keyboard activation, draggable Off pills, saved layouts, retained selection and collections, explicit scan Resume, completed-frame aggregation, continuing downloads, rapid commands, concurrent rule edits, global-pause priority, primary storage failure/Retry, worker termination, interrupted dock layout reads and full browser restart. Delayed automatic probes are aborted; late results cannot publish while Off. The 5,000-image fixture runs seven toggle cycles and confirms Off-time additions appear only after On.

An interrupted initial dock-layout read was found to leave the dock hidden. Startup now retries failed connections, shows a default dock after a layout-read failure and restores the saved layout on retry. A dedicated fault-injection test covers this; worker notifications also wait for settings initialization.

The existing regression suites also run against 1.5: original and converted bytes, ZIP entries, fallback/retry, download snapshots, selection-only clicks, destination/sequence persistence, glass themes, reduced motion, drag/focus, preferences drafts and worker recovery. A hover race found after re-enabling detection was fixed: the raw pointer target is retained while discovery rebuilds its element mapping, so hover controls recover without an extra mouse exit/re-entry.

## Performance and visual evidence

- Website-power fixture: **5,001 records after seven toggle cycles**, with **no recorded long tasks** during the measured toggle interval. Timing starts after initial discovery and excludes fixture construction; measured long tasks and final results are in test-results/power/performance.json. This is page-level timing, not a claim of isolated extension execution time.
- Final polish fixture: **5,000 records, 8 mounted cards**, one initial **146 ms** page task and one **82 ms** gallery task. No repeated tasks above 100 ms were recorded. Core and polish suites retain separate 5,000-image virtualization/observer checks; current measurements are in test-results/performance.json and test-results/polish/performance.json. The gallery mounts only a small visible subset. Initial page construction can cause an isolated long task; repeated tasks over 100 ms fail the performance assertions.
- An earlier full-suite performance attempt failed with page tasks of 169/873 ms and a gallery task of 1,129 ms. The raw measurement is retained in test-results/polish/initial-performance-spike.json. An independent fresh-profile run passed with a single initial 323 ms page task, 8 mounted cards and no gallery long tasks (test-results/performance-audit/performance.json). These timings do not establish the cause of the earlier spike or guarantee performance under arbitrary host load.
- The 5,000-record gallery readiness wait uses the same 90-second budget as collection discovery; its prior 20-second wait timed out in a full run. This does not change the long-task assertions. Failure screenshots/state dumps are captured for future diagnosis.
- Actual 1.5 On/Off screenshots: test-results/power/on-dock.png, off-pill.png and library-off.png. Off uses a compact activation pill; the library keeps collected records and exposes the shared website switch.
- Dock and Liquid Glass suites cover six themes, narrow layouts, keyboard focus, real mouse drag, viewport bounds/zoom, reduced motion, high contrast and unavailable blur. On-page glass only blurs the surface's immediate backdrop; the native Chrome panel uses an extension background.
- No new permissions, remote assets, backend, analytics or graphics engine. Bundled SVG icons include the new Power action. Existing disabledSites remains the saved preference source; missing settings still default to On.

## Live-site compatibility

These public-site observations are retained from 1.4 and were not repeated for the 1.5 activation change. The first public-page attempt was blocked by sandbox network policy. A network-enabled retry completed **20 public-page observations across eight categories**. Four pages exposed content-image candidates (WordPress, Smashing Magazine, The Guardian and Wikipedia). Three returned HTTP 403, ten navigations were blocked/timed out, Google served an HTTP-200 unusual-traffic challenge, and Pinterest/Amazon rendered incomplete shells.

Screenshot review corrected candidate-only automated labels for Google, Pinterest and Amazon. A single candidate in a blank shell is not counted as a complete website compatibility pass. COMPATIBILITY.md records every result and reason; untouched automated observations remain in test-results/compatibility/automatic-results.json.

Fetch checks stop at response headers. Authenticated feeds, exhaustive full-site scanning and real-site bulk downloads remain unverified. The deterministic fixtures verify download bytes and recovery behavior; they do not remove website authentication or hotlink restrictions.

## Reproduction and limits

Run npm run build, npm test, npm run test:browser, npm run test:dock, npm run test:polish, npm run test:selection-downloads, npm run test:zip-actions, npm run test:liquid and npm run test:power. Set CHROMIUM_PATH to a compatible installed Chromium. Browser profiles are created under test-results/. npm run test:compatibility requires external network access.

POLISH_FILTER=5000 runs the independent page/gallery performance audit and writes to test-results/performance-audit/. Regular polish runs retain the full scenario report. node scripts/verify-release.mjs checks every archived byte and unchanged permissions against the retained 1.3.1 archive.

ZIP input boundaries have unit coverage and runtime enforcement at 250 MB or 100 files; a real 250 MB stress archive was not generated. Actual archive contents were opened and verified. Save as arguments and cancellation races were tested through controlled API responses; native OS folder selection was not automated. Existing valid settings, collections and jobs remain compatible; the new metadata/batch transport is additive and does not change persisted image or download contracts.

## Delivery

- Version: **1.5.0**
- Source: H:/Zephyer/src/
- Unpacked extension: H:/Zephyer/dist/
- ZIP: release/zephyer-1.5.0.zip
- Archive: **152,243 bytes**, **17 files**
- SHA-256: **73356b113f79793149254d5a88e763a91508a5ce762a6cc507bb5441f45eacdf**
- Verified contents and permissions: release/release-verification.json
- Machine-readable check summary: test-results/validation-summary.json
- Checksum: release/SHA256SUMS.txt

Extract the ZIP into the existing installation folder, reload its existing card at chrome://extensions, then refresh webpages. Keeping the same installation folder preserves settings and the sequence counter. README.md contains installation and usage instructions.
