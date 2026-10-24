# ADR 0002 — Coverage ratchet on pure modules

Date: 2026-10-24 · Status: Accepted

## Context

Unit coverage is strong where logic is pure (power 100%, download-settings 96%,
discovery 94%, preferences 95%, shared 93%, retrieval 93%) but the UI, content
script, background worker, and IndexedDB layers are exercised by the Playwright
browser suites instead. Whole-project percentage coverage is therefore
misleading and was 2.93% at Phase 0.

## Decision

`vitest.config.ts` enforces per-file thresholds (≥85% lines, ≥70% functions)
for the pure modules:

- `src/shared.ts`, `src/discovery.ts`, `src/power.ts`, `src/preferences.ts`,
  `src/download-settings.ts`, `src/retrieval.ts`

Coverage may only ratchet upward: any new pure module or refactored code in
these files must land with the threshold met, and new pure modules are added
to the list as they are created. Property-based tests (`fast-check`) count
toward these thresholds.

UI/db/background modules join the ratchet in Phase 1 (via component tests with
a DOM environment and `fake-indexeddb`), not by weakening what counts.

## Consequences

- `npm run coverage` is a hard gate in CI-equivalent local verification.
- The percentage-of-total metric is ignored by policy; per-file thresholds are
  the contract.
