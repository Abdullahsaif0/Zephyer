# Zephyer 1.6.2 — Side-library scrolling

24 October 2026. Focused fix for images and controls becoming unreachable in short Chrome side panels.

## Cause and correction

The library root used a fixed viewport height with overflow hidden. Its nonshrinking controls could exceed that height, pushing the image region and footer outside the visible area without an outer scrollbar. The side-library root now scrolls; its virtualized image region has a 320 CSS-pixel minimum viewport and remains independently scrollable. Controls do not shrink into overlapping hit areas. The image region is keyboard focusable with a visible focus ring.

The compact dock action is explicitly labelled **Open side library**. The separate **Open Photos Gallery in new tab** panel action uses the Photos icon and the existing source-bound gallery command. Routing was already distinct; this patch clarifies the labels and verifies actual tab creation.

## Executed validation

- TypeScript and production build: passed.
- Unit tests: 64/64 passed.
- New panel regressions: 5/5 passed (mouse outer scrolling at 360×520, inner scrolling with virtualized row changes, keyboard access and expanded-output/footer reachability, actual 200% browser zoom, and full-tab Photos Gallery opening with rendered image tiles).
- Existing selection/download suite: 10/10 passed, including selection isolation, counters, ZIP/sequential naming, worker termination/retries and browser-restart persistence.
- Release verification: all 21 ZIP entries match dist, HTML asset references resolve, permissions unchanged.

Browser checks used a fresh isolated Chromium profile. The panel document was rendered at side-panel dimensions in an automation tab; only its active-source-tab lookup was substituted to match native side-panel context. Scrolling, pointer/keyboard input, browser zoom, rendering, worker messages and gallery tab creation were real. Native Chrome side-panel chrome itself was not automated. The prior whole-codebase stress/performance limitations in VALIDATION.md remain historical evidence; this focused patch does not claim they were resolved or rerun.

Evidence: `test-results/panel-scroll/results.json`, `test-results/selection-downloads/results.json`, `test-results/panel-scroll/short-panel-controls.png`, `test-results/panel-scroll/full-tab-gallery.png`, and `release/release-verification.json`.

## Installation

For an installation pointing at `H:\Zephyer\dist`, Reload Zephyer in `chrome://extensions`, close/reopen the side panel, refresh the source website, then click the pinned extension icon again. For another installation folder, replace its files using the extracted `zephyer-1.6.2.zip` before reloading the same extension card. No new permissions or storage migration.

SHA-256: `2036edcd41817ce17c5d3ea84e5e95c7abdcf6246c09963fb2e39fa0ade19293`.
