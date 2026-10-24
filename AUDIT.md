# Code audit — Zephyer 1.6.1

Audit date: 24 October 2026 (Asia/Riyadh). Final result: 207/208 distinct checks passed; the remaining full-suite source timing instability is detailed in VALIDATION.md. This is a local source and browser-fixture audit of the extension, not a guarantee that unknown defects cannot remain.

## Scope and method

Reviewed the worker's message validation, power/activation gates, discovery/verification, scan coordination, durable jobs, native download reconciliation, ZIP handoff and offscreen lifecycle; collection ownership/cleanup and IndexedDB transactions; content discovery, observers, image mappings and scan controls; dock interactions; React gallery/viewer, preview cancellation, library and preferences; shared URL, format, filename and image helpers; build/package configuration and prior test assumptions. Existing visual styles/icons were checked through the browser suites rather than redesigned.

Confirmed defects were fixed, then exercised with focused regressions and existing suites. Test-only fault injection simulates missing content receivers and archive insertion failures. It does not add a page-accessible privileged interface. The worker-local activation entry point remains the same one used by the toolbar handler.

## Fixes

| Area | Defect and correction | Evidence |
|---|---|---|
| SPA lifecycle | Same-document navigation reused image IDs and could overwrite a gallery's retained records. Image identity is bound to the worker-owned collection ID; fresh documents avoid a redundant reset and cached pages recheck identity on restoration. The sender document prefix remains validated. | Retained-gallery selection/record regression and deduplicated verification suite |
| Download submission | Tab-based retries could miss the previously created collection-associated job. Idempotency now includes the originating tab and appropriate collection scope. | Parallel retry, one job and one sequence reservation |
| Download snapshot | A mixed valid/stale tab selection could silently create an incomplete batch. The complete requested ID set must now be valid and eligible before any job/sequence reservation. | Missing-member rejection with unchanged job count |
| Queue races | A scheduled item could enter fetching after its job was paused/cancelled. Item claims check current job/item states within the job lock. | Existing pause/cancel/late-result scenarios |
| Worker recovery | Startup recovery could overlap new commands/scheduling or run twice in one worker. Commands and scheduling now await one recovery promise before touching jobs. | Worker interruption/restart and migration suites |
| Scan lifecycle | A failed start/resume dispatch could leave a running scan and temporary collection permission. Failure now releases the grant, records an actionable stopped state and persists recovery state. Stop commits its terminal state even if a scan just completed and invalidates late progress sessions. | Injected missing-frame failure and completed-scan Stop regression |
| Power ordering | Activation, manual collection and permission changes could share a revision, allowing a stale state to replace a newer one. Effective power signatures now advance revisions; automatic collection Off preserves page Select mode. | Activation/permission revision and selection-mode regression |
| Manual collection | One-pass grants could survive navigation; paused full-page scans did not immediately publish their updated collection state. Pass tokens are invalidated on navigation, and scan state transitions publish power. | Scan now, automatic Off, pause/resume and navigation suites |
| Scan completion | Stability used useful-image count even while hidden/pending images were being collected. Stability now uses total collected count. | Existing dynamic/full-page fixtures |
| IndexedDB failures | Explicit transaction aborts could leave unresolved promises; a failed/closed connection stayed cached. Abort paths now reject, and connection failure/version changes clear the cached handle. | Abort and reopen unit regressions |
| Large collections | Bulk materialization/write callbacks were expensive; an intermediate per-ID read approach increased I/O. IndexedDB v3 adds paged tab/collection indexes. Reads use 200-record pages and large record writes yield in bounded callbacks within one atomic transaction. Explicit small actions read requested IDs. | 401-record boundary/atomic-revision check, migration and 5,000-image fixtures |
| Notification backlog | A notification timer stopped owning its slot before asynchronous collection reads completed. Updates now coalesce throughout the operation and schedule one follow-up for intervening changes. | Dynamic discovery and stress suites |
| Upgrade and gallery ownership | Chrome clears storage.session on extension reload as well as browser restart. A matching live document now preserves its collection across upgrade; gallery metadata reads register genuine gallery tabs again, including duplicated tabs. | Real 1.6.0 archive migration and duplicate-gallery retention regression |
| Session cleanup | Recovery could retain an unreferenced live collection after its source disappeared, or treat a changed document as live. Actual top-frame identity is checked; detach/cleanup applies consistently to records. | Orphan collection recovery regression |
| Preview ownership | Repeated active request IDs could replace cancellation ownership. Duplicate active IDs are rejected; late resolved previews are released after component cancellation. | Parallel preview-token regression and viewer lifecycle suite |
| Preview settings | Tiles/viewer could retain previews after format choices changed, and review transitions could retain implicit reveal state. Allowed-format changes invalidate previews; hidden review requires an explicit reveal key. | Gallery review/filter tests; code-path review |
| Offscreen lifetime | Idle cleanup ignored active fetch/decode operations and could race newly dispatched work. Both offscreen and worker track active processing before closing the document; disconnected processors return a clear error. Worker recovery cancels abandoned processing and removes orphan preview/archive memory while retaining active native download URLs. | Orphan-preview recovery regression and conversion/ZIP/preview suites |
| ZIP cleanup | Failed archive insertion leaked the prepared image Blob URL. Failed additions now release their owned temporary image. | Fault-injected ZIP_ADD failure, URL readable before and revoked after |
| Transfer bounds | Page-origin retrieval buffered the entire response before enforcing its limit. Shared streaming reads enforce limits while receiving bytes, including responses without Content-Length. | Stream cancellation and byte/MIME preservation unit tests |
| Responsive images | Descriptorless srcset candidates were dropped; inserting/changing a non-displayed picture source could miss its parent image. Parsing and source-to-image invalidation now cover these cases. | Responsive parser units and inserted-source browser regression |
| Observer cleanup | Removed shadow hosts retained their observers and strong root references. Detached shadow-root observers are now disconnected and removed. | Dynamic/repeated-toggle fixtures; lifecycle code review |
| Format/status handling | MIME parameters on page Blob sources could prevent recognition; raw dimensions/IDs lacked consistent bounds; unsupported canvas records were described as disabled formats. MIME parameters are normalized, source metadata is bounded, and unsupported reasons remain visible. | MIME/canvas unit regressions and protected-canvas fixture |

## Validation

Final suite totals, performance results and release integrity are recorded in VALIDATION.md and test-results/validation-summary.json after verification. Initial timing failures are preserved under test-results/code-audit/ rather than silently removed. No timing assertion was weakened. A first-read batch implementation was replaced after its stress run exposed additional I/O overhead; the final implementation uses indexed paging.

IndexedDB version 3 only adds indexes; existing records, collections and jobs remain in place. The patch adds no permissions, backend, analytics, network service or remote assets. Downgrading to an older build after upgrading the database is not supported; continue using 1.6.1 or newer with the same Chrome extension installation.

## Boundaries

Chrome extension Reload clears its session activation; click the icon again if needed. Live collections are retained on upgrade only when the browser document ID still matches. Detached collections without a provable current session are temporary and may end on extension reload; they are not permanent albums.

The public-site compatibility matrix was not repeated in this audit. Native toolbar clicks, OS Save as dialogs, browser crashes at every possible instruction boundary, a 250 MB stress archive, and hardware/browser combinations beyond the recorded test runtime are not exhaustively tested. Browser-origin restrictions, inaccessible/expired sources and imperfect semantic logo detection remain product limitations. Findings and passing fixtures do not justify a claim that the codebase has zero remaining bugs.
