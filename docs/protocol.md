# Zephyer message protocol

All extension communication uses one-shot `chrome.runtime` messaging. The
union is defined in `src/shared.ts` (`Message`); the canonical member list is
enforced by `tests/protocol.test.ts` — adding a member without registering it
fails the build.

Conventions:

- Every request resolves to a value, or rejects with `{ error: string }`
  (`rpc()` in `shared.ts` unwraps it).
- **Senders**: `ui` = extension pages (panel, gallery, options, troubleshoot);
  `content` = content scripts in web tabs; `background` = the service worker
  originates the message. The background rejects senders that are neither
  `ui` nor an in-tab content script, and gallery/collection commands require
  `ui`.
- Offscreen directives (`IMAGE`, `PROBE`, `REVOKE`, `CANCEL`, `CLEANUP`,
  `ZIP_*`) are namespaced with `target: "offscreen"` and are NOT part of this
  union; they are validated separately (`offscreen.ts`) and only accepted
  from the background script.

## Requests handled by the background

| Type                                     | Sender     | Purpose / response                                                      |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `ENABLE_PHOTO_FORMATS`                   | ui         | Opens Preferences to the formats section.                               |
| `ACTIVATION_STATUS` / `ACTIVATION_RETRY` | ui         | Per-tab activation diagnostics; retry re-runs the activation handshake. |
| `CAPABILITIES`                           | content    | Site capability classification (feed/post/stories/blocked).             |
| `VERIFY_RETRY`                           | ui         | Grant explicit format-verification retries for ids.                     |
| `OPEN_GALLERY`                           | ui/content | Opens (or focuses) the source-bound Photos tab.                         |
| `AUTO_COLLECTION`                        | ui         | Toggles automatic collection for the active tab.                        |
| `SCAN_NOW`                               | ui/content | One-pass collection of the currently loaded page.                       |
| `COLLECTION_META`                        | ui         | Gallery sync: collection state + changed ids since a revision.          |
| `COLLECTION_BATCH`                       | ui         | Records for explicit ids (≤200).                                        |
| `COLLECTION_SELECT`                      | ui         | Set selection for ids (`["*"]` = all).                                  |
| `COLLECTION_INCLUDE`                     | ui         | User override: include an excluded image.                               |
| `COLLECTION_DOWNLOAD`                    | ui         | Create a download/ZIP job; idempotent via `requestId`.                  |
| `COLLECTION_PREVIEW`                     | ui         | Blob-URL preview for a variant (owner-tracked, cancellable).            |
| `PREVIEW_RELEASE` / `PREVIEW_CANCEL`     | ui         | Release/cancel preview blobs by url/requestId.                          |
| `PREFERENCES`                            | ui         | Validated settings patch; `disabledSitesBase` three-way merge.          |
| `SITE_POWER`                             | content    | Turn the current site on/off; returns settings + power.                 |
| `INCLUDE`                                | content    | Per-tab version of `COLLECTION_INCLUDE`.                                |
| `HELLO`                                  | content    | Handshake; returns prefix, settings, power state.                       |
| `APPEARANCE`                             | ui         | Persist theme / dock orientation.                                       |
| `DOCK_GET` / `DOCK_SAVE` / `DOCK_RESET`  | content    | Per-hostname dock layout persistence.                                   |
| `OPEN_OPTIONS`                           | content    | Opens the options page.                                                 |
| `DISCOVER`                               | content    | Publish discovered records (≤60 per batch, revision-checked).           |
| `SNAPSHOT`                               | ui         | Full tab snapshot: records, jobs, scan state, power.                    |
| `LIBRARY_META`                           | ui         | Paged library read: record ids or decorated records.                    |
| `RECORDS_BATCH`                          | ui         | Explicit-id record batch (≤200).                                        |
| `SELECT`                                 | content    | Per-tab selection toggle for ids.                                       |
| `MODE`                                   | content    | Enter/exit page selection mode.                                         |
| `SCAN`                                   | content/ui | Full-page scan state machine: start/pause/resume/stop.                  |
| `SCAN_PROGRESS`                          | content    | Per-frame scan session push (validated against live frames).            |
| `DOWNLOAD`                               | content/ui | Create a per-tab download/ZIP job.                                      |
| `JOB`                                    | ui         | Queue control: pause/resume/cancel/retry.                               |
| `SETTINGS`                               | ui         | Internal settings publication (activation/panel sync).                  |
| `OPEN`                                   | ui         | Opens the Chrome side panel (preserving user activation).               |

## Background-originated (no background `case`)

| Type         | Audience | Purpose                                                                        |
| ------------ | -------- | ------------------------------------------------------------------------------ |
| `UI_STATE`   | content  | Debounced full-state push (power, ids, scan, settings, mode).                  |
| `NOTICE`     | ui pages | Coalesced "library changed" notification.                                      |
| `RESET`      | content  | Rebuild all content-script state for the tab.                                  |
| `PING`       | content  | Health probe: version, observer count, dock visibility.                        |
| `PAGE_BYTES` | content  | Ask the originating frame to fetch bytes the extension cannot (fallback tier). |

`SCAN_PROGRESS` appears in the union as a content→background push and is
accepted by a background case; `REFRESH_MEDIA`/`SHOW_DOCK`/`POWER_STATE`/
`ROUTE_UPDATE` are content-side message names not yet in the typed union and
are tracked for Phase 1's typed-RPC migration.
