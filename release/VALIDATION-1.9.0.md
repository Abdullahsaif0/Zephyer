# Validation — Zephyer 1.9.0

25 October 2026. Feature release (Phase 2 tracks A + B): pinned
collections, duplicate review, site profiles and naming presets. Local-AI
filtering and video/motion tracks are deliberately deferred (ROADMAP.md).

## Recorded checks

| Suite | Checks | Result |
|---|---:|---|
| Unit (incl. duplicates, dimensions, protocol, profiles) | 113 | Passed |
| Core browser | 18 | Passed |
| Dock browser | 19 | Passed |
| Website power browser | 19 | Passed |
| Audit browser | 12 | Passed |
| Gallery browser (incl. duplicate-review regression) | 28 | Passed |
| Migration browser (incl. pinned-epoch regression) | 4 | Passed |
| Liquid glass browser | 13 | Passed |
| Invariants (per-host serialization, sequence monotonicity) | 2 | Passed |

TypeScript strict build and ESLint (0 errors, 453 warnings under the
ratchet) passed. Browser suites run against isolated Chromium profiles
with the rebuilt extension loaded. A dock scan-stop wait remains a known
timing flake (passed on rerun; no assertion weakened).

## Highlights

- Pin lifecycle: pinned collections are exempt from the session-epoch
  sweep, detach as saved, are not deleted on last-gallery close, and
  bypass the epoch check in requireCollection. Browser-tested with a
  fresh epoch minted after pinning.
- Duplicate grouping: exact SHA-256 groups plus transitive dHash clusters
  (<=12 bits), computed by the offscreen DIGEST/PHASH ops. Browser
  regression proves two byte-identical URLs land in one exact group.
- Profiles resolution: effectiveSettingsFor merges only defined override
  fields; publish paths (POWER_STATE/UI_STATE/HELLO) and job creation use
  it. Persisted profiles are sanitized on init.
- Presets: tokens expand per file at runItem time with sanitized prefixes
  and per-job snapshots, preserving sequence numbering semantics.

## Boundaries

Same as 1.8.x: live authenticated social feeds remain unverified, OS Save
as dialogs and a 250 MB archive stress are not exhaustively automated,
and no universal free-of-bugs claim is made. GitHub Actions is still
disabled at the account level (appeal pending); all gates run locally.
Duplicate hashing shares the pipeline's host-cooldown behavior; transient
429s may delay a scan and are retried, not fatal.

## Release integrity

Archive: release/zephyer-1.9.0.zip. `npm run package` followed by
`node scripts/verify-release.mjs` byte-compares every entry against dist/
and the SHA-256 manifest.
