# Zephyer 1.9.0

- Pin any collection to keep it permanently: pinned collections survive
  browser restarts, detach as saved instead of being deleted, and keep
  serving gallery commands across sessions. Toggle the pin in the gallery's
  collection context bar.
- Duplicate review: the gallery's Duplicates segment groups exact byte
  duplicates (SHA-256) and visually similar images (dHash proximity) with
  thumbnails, per-image selection and Select-group actions. Everything is
  computed locally — no merges or deletions happen automatically.
- IndexedDB v4 adds albums, tags and fingerprints stores; the offscreen
  processor gains DIGEST and PHASH operations. Upgrading the existing
  profile is automatic; stay on 1.9.0 or newer afterwards (downgrading to
  an older schema is unsupported).
- Site profiles: per-hostname overrides for formats, cleanup flags, minimum
  image size, download folder and scan limit. Edit them in Preferences →
  Site profiles; only overridden fields are stored.
- Naming presets: a token template ({index}, {hostname}, {date}, {title})
  with live example filenames, applied per download and snapshotted per job
  like the other destination settings.
- No new permissions, backend, analytics or remote assets. The planned
  local-AI filtering and video/motion tracks are deferred to a later
  release (see ROADMAP.md) and are not part of 1.9.0.

# Zephyer 1.8.0

- Hardened the background service worker: all per-tab state now lives in a
  single typed map with one cleanup path (releaseTab), eliminating the
  class of bugs where tab-close cleanup missed one of eight hand-synchronized
  registries.
- Retry/error classification is now structural: DownloadFailure carries a
  kind (permanent / rate-limited / cancelled / transient), and the queue
  branches on it — not on message text. The Chromium download-error string
  fallback survives only in one documented place.
- The message protocol has a typed sender-role registry (protocolRegistry):
  every message declares whether the extension page, content script, or both
  may send it, enforced at compile time and consulted by the background
  router for authorization.
- Strict TypeScript: noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  noPropertyAccessFromIndexSignature and three more flags are on; all
  surfaced latent unguarded accesses and optional-field contract decisions
  were fixed.
- Image probes now sniff dimensions from 4 KB container headers (PNG, GIF,
  JPEG SOF, WebP VP8X/VP8/VP8L, BMP, ICO) instead of downloading whole files
  to decode them — best-quality candidates on common formats resolve sizes
  for free.
- Fixed: panel "Discovered" sort now matches the gallery (discovery
  sequence, not update time); a stale per-variant quality choice can no
  longer render a blank select or leak into the next download; the
  unreachable OPEN router case was removed; DISCOVER no longer risks a raw
  URL-parse throw on a missing tab URL; recovery alarm re-creates itself on
  startup and checks its name; scan-recovery writes are debounced on the
  progress hot path and flushed immediately on terminal states.
- Engineering: ESLint strict type-checked with import-boundary rules
  (0 errors, warning ratchet), coverage ratchet on pure modules, property-
  based tests for the hostile-input parsers, message-protocol exhaustiveness
  tests, per-host queue serialization and sequence-monotonicity invariants,
  and GitHub Actions CI workflows (pending account-level Actions re-enable).
- No new permissions, backend, analytics or remote assets. Upgrade by
  reloading the extension card and refreshing open websites.

# Zephyer 1.7.0

- Added acknowledged, serialized toolbar activation with missing-receiver injection, document-change retry, bounded handshakes and local troubleshooting/badge errors. Content generations own/dispose their observers, global listeners and timers; the dock uses a nonmodal top layer with fixed-overlay fallback.
- Added Instagram, Facebook, X and Pinterest media context/capability adapters with post/slide identity, scoped feed discovery, same-post SPA retention and generic fallback.
- Added explicit carousel traversal and optional default-Off Instagram still-image Stories. Traversal has Pause/Resume/Stop, a 50-item cap, scoped controls and Story tray boundary checks; unprovable navigation stops with manual guidance.
- Added separate disabled-format review, explicit global WebP/AVIF enabling and verification retry without turning automatic collection on.
- Shared bounded verification/byte fetching and processing fallback across previews/conversion/ZIP. Rejected HEAD can fall back to GET; 401/403 do not repeat unchanged candidates; accessible alternatives and native originals remain available. Same-post/slide URL refresh preserves job snapshots and records retrieval attempts.
- Fixed late-frame scan resurrection after Off/On. Re-enable avoids republishing worker-acknowledged unchanged images, preserving responsive discovery on large pages.
- No additional extension permissions, backend, account integration or remote assets. Live social compatibility is separately reported as blocked/unverified where this environment cannot reach pages or authenticate; fixture success is not a live-site guarantee.

# Zephyer 1.6.2

- Fixed unreachable side-library images and controls in short panels: the outer panel now scrolls and the virtualized image viewport retains usable space.
- Added keyboard focus/scrolling for the image region. Expanded output controls and download actions remain reachable at browser zoom.
- Distinguished Open side library from Open Photos Gallery in new tab and used the Photos icon consistently.
- Added five focused browser regressions for mouse scrolling, virtualization, keyboard access, 200% browser zoom and real full-tab gallery routing. No permission or data migration changes.

# Zephyer 1.6.1

- Preserved matching live-document collections across extension reloads and re-registered existing/duplicated gallery references.
- Advanced revisions for effective power transitions and preserved Select mode when automatic collection is disabled.
- Made Stop durable after scan completion and rejected late progress updates.

- Fixed same-document navigation collisions that could overwrite retained gallery records and selection.
- Fixed tab download idempotency and rejected partial/stale download batches before reserving filenames.
- Guarded queue item claims, serialized startup recovery, released failed scan grants and stopped stale one-pass collection on navigation.
- Added IndexedDB v3 paging indexes, bounded atomic write callbacks, explicit abort rejection, connection retry and notification coalescing.
- Reclaimed orphan collections and detached shadow observers; fixed responsive source invalidation, descriptorless srcset and Blob MIME parameters.
- Hardened preview ownership/cancellation, format/review invalidation and offscreen idle coordination. Failed ZIP additions now revoke temporary image URLs.
- Enforced byte limits during response streaming; preserved unsupported-canvas reasons and bounded incoming image identity/dimensions.
- Added fault-injection, SPA, batching, transfer-bound and migration regressions. No additional permissions or external services. See AUDIT.md and VALIDATION.md for evidence and limits.

# Zephyer 1.6.0

- Added click-to-activate tab sessions. No page UI, collection or verification before toolbar activation; active tabs survive navigation/worker restart and reset on close/browser restart. Toolbar clicks reveal the dock instead of automatically opening the side panel.
- Separated automatic image collection from website permission and manual scans. Added automatic-collection controls, Scan now and explicit full-page scanning without implicit page scrolling.
- Added the source-bound Photos gallery: virtualized square tiles, three densities, filters, stable discovery order, Useful/Hidden/Pending review and synchronized selection. Full viewer includes quality, details, zoom/pan, keyboard navigation and explicit downloads.
- Temporary collections survive source navigation/close, gallery refresh and worker restart. Collection-scoped validated commands preserve selection and permit detached downloads; last-reference/session cleanup leaves download snapshots intact.
- Added IndexedDB v2 migration, atomic collection metadata updates, incremental record revisions, bounded thumbnail processing/cancellation and Blob cleanup. Gallery download submissions support idempotent retry.
- Improved declared-favicon and contextual emoji filtering, dynamic signal invalidation and stale page-control validation while automatic collection is paused. Large/uncertain content remains reviewable; no universal pixel-based logo promise.
- No new permissions, backend, analytics, remote assets or AI service. Added gallery, migration, security, lifecycle, accessibility and performance regressions; existing fixtures now explicitly simulate toolbar activation.

# Zephyer 1.5.0

- Added custom SVG Power controls in the dock and library, with exact-hostname persistence and synchronized open tabs. New websites default On; existing exclusions remain intact.
- Off leaves a compact draggable activation pill, retaining collection, selection and saved layout. On restarts discovery without activating selection mode or automatically resuming a scan. Queued downloads continue independently.
- Accessible frames follow their top-level website rule. Discovery and automatic verification stop while Off; cancellation, worker epochs and revisions reject stale submissions and callbacks.
- Added generation-guarded startup reconnection and a visible default layout if a layout read is interrupted; retry restores the saved layout. Worker notifications wait for committed settings initialization.
- Serialized settings writes and baseline-aware disabled-host editing preserve concurrent changes. Pending/error/Retry states retain the committed setting on failure; global pause takes priority.
- Separated local frame scan controllers from aggregate display state, preventing completed frames from rejoining an active scan after Resume. Scan traversal stops promptly when detection is disabled.
- Narrow dock layouts move Expand into overflow. Overflow keyboard focus skips hidden controls, and power actions preserve focus through pending transitions.
- Added website-power unit and browser regression coverage, restart/failure tests and a 5,000-image repeated-toggle fixture. No new permissions, services or analytics.

# Zephyer 1.4.0

- Shared Liquid Glass-inspired materials, six persistent palettes, localized scan motion, short count transitions and accessible solid/reduced-motion fallbacks. Replaced the separate letter logo with the shared bespoke SVG monogram and regenerated packaged toolbar icons.
- Added bounded library transport and queue result pagination; fixed scan budget yielding for skipped elements.
- Consolidated legacy CSS declarations. Gallery cards remain virtualized and do not use individual backdrop filters.
- Fixed failed-download navigation, disappearing action errors, repeated download submissions, out-of-range virtual rows and stale broken-thumbnail state.
- Added revision-aware preference drafts, accurate pending-save status, inline numeric/path/hostname validation, clean-field synchronization and appearance rollback on rejection.
- Detection pause now pauses scanning until explicitly resumed. Queue commands serialize per job, reject stale resume/retry, and preserve cancellation across late ZIP/network/Save as failures.
- Added recovery actions for loading/empty/filter states; upcoming promotions stay outside active work. Existing destination, numbering, format and job snapshot contracts remain compatible.
- No new permissions, network services, analytics or runtime graphics engine.

# Zephyer 1.3.1

- Added an explicit **Download ZIP** button in the library and **Download selected ZIP** in the dock overflow menu.
- Both actions require a selection and snapshot it at click time. Library ZIP uses current quality/conversion choices; dock ZIP uses best-available originals. Destination and continuous numbering apply to both. The explicit ZIP action does not change the library delivery preference for subsequent downloads.
- Added a shared custom ZIP icon and keyboard focus for the first enabled overflow action.

# Zephyer 1.3.0

- Fixed overlapping Select/Download controls on small displayed images. Stable selection overlays and separate selection surfaces keep selection clicks away from page mouse handlers; download controls reject stray click-through events.
- Added a visible selected-count badge to compact, expanded, vertical and minimized dock states.
- Added a validated custom Downloads subfolder, optional website/batch grouping, Chrome download-location settings shortcut and per-output Save as picker mode.
- New image files use persistent six-digit sequence numbers across jobs and browser restarts, with optional filename prefix. ZIP entries share the same numbering. Retries keep their number and existing queued jobs retain their names/settings.
- Destination and naming choices are snapshotted per job. Picker cancellation pauses remaining work without automatic re-prompting and releases temporary conversion/archive URLs.
- No new Chrome permissions, external service or native helper.

# Zephyer 1.2.0

- JPEG/PNG discovery defaults, independently enabled extra formats and configurable Smart cleanup for small assets, tracking pixels, interface branding and optional avatars.
- Useful/Excluded/Pending collections, reason filters, explicit preview and per-image cleanup override. Disabled formats cannot enter selection or download fallbacks.
- Bounded extensionless MIME/signature verification; verified formats survive rediscovery and signed URLs retain their query parameters. Download preflight checks actual MIME where available; fetched conversion/ZIP inputs also check signatures.
- Compact scan HUD with a directional sweep, bounded new-image highlights, pause/resume/stop, terminal confirmation, minimized activity and reduced-motion support.
- Session/document-aware scan coordination, removed/navigated-frame cleanup and durable paused recovery after worker interruption.
- Coalesced gallery refreshes, validated automatic preference saves, clearer review/empty/error states and shared interaction motion.
- Skippable once-per-release library roadmap banner with permanent opt-out and manual access in Preferences. Future features remain clearly marked as planned.
- Existing themes, movable dock layouts and download jobs remain compatible. No new permissions, backend, accounts or analytics.

# Zephyer 1.1.0

- Compact movable dock with a dedicated drag grip, expand, minimize and restore.
- Independent position/state memory per hostname; viewport/zoom clamping and keyboard movement.
- Horizontal bar and vertical rail, with current-site and global position reset.
- Graphite, Porcelain, Midnight, Forest, Dusk and Sand palettes. Theme/orientation choices save immediately and remain independent of operating-system appearance.
- Shared custom SVG icons, frosted surfaces, readable opaque backgrounds and reduced-motion support across dock, hover tools, gallery and preferences.
- Stable dock and image-quality controls retain focus during discovery updates.
- Existing settings default safely to Graphite/horizontal. Fixed global-pause visibility under the overlay's Shadow DOM style isolation.
- No additional Chrome permissions or external services.

Update by reloading the existing extension at `chrome://extensions`, then refreshing your websites. See README.md for installation and controls, and VALIDATION.md for the completed checks.
