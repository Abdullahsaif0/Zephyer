# Validation — Zephyer 1.8.0

25 October 2026. This release is the hardening phase (v1.8) of the 2.0
roadmap: strict types, structured errors, a typed protocol registry, one
per-tab state path, and a full defect sweep. See CHANGELOG.md for the
complete list.

## Recorded checks

| Suite | Checks | Result |
|---|---:|---|
| Unit (incl. property-based + dimensions + protocol) | 101 | Passed |
| Core browser | 18 | Passed |
| Dock browser | 19 | Passed |
| Website power browser | 18 | Passed |
| Audit browser | 12 | Passed |
| Selection/downloads browser | 10 | Passed |
| ZIP actions browser | 3 | Passed |
| Gallery browser | 27 | Passed |
| Liquid glass browser | 13 | Passed |
| Panel-scroll browser | 5 | Passed |
| Social browser | 23 | Passed |
| Invariants (per-host serialization, sequence monotonicity) | 2 | Passed |

TypeScript strict build and ESLint (0 errors, 453 warnings under the
ratchet) passed. Browser suites run against an isolated Chromium profile
with the rebuilt extension loaded.

## Highlights

- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled;
  34 unguarded indexed accesses were fixed individually.
- `DownloadFailure` kinds replace regex-over-string classification; a
  regression proves a permanent failure whose message contains
  "cancelled" stays permanent.
- The protocol registry is compile-time exhaustive both ways: a new Message
  member without a registered role fails the build.
- One `TabState` map owns all per-tab registries; `releaseTab` is the only
  cleanup path, used by both navigation-clear and tab-close.
- Dimension sniffing is unit-tested per header format plus a 500-round
  fuzz over arbitrary bytes.

## Boundaries

Same as 1.7.x: live authenticated social feeds remain unverified, OS Save
as dialogs and a 250 MB archive stress are not exhaustively automated, and
no universal free-of-bugs claim is made. GitHub Actions is configured but
could not execute — the account's Actions were disabled by GitHub and the
appeal is pending; all gates run locally.

## Release integrity

Archive: release/zephyer-1.8.0.zip. `npm run package` followed by
`node scripts/verify-release.mjs` byte-compares every entry against dist/
and the SHA-256 manifest.
