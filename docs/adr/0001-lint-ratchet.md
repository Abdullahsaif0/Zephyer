# ADR 0001 — Lint policy and the warning ratchet

Date: 2026-10-24 · Status: Accepted

## Context

The codebase reached 1.7.0 with no linting. Introducing `typescript-eslint`
strict type-checked rules in one step produced ~1,500 violations, most of them
stylistic rather than defects. Hardening is a Phase 1 goal, but CI must be
green from Phase 0 onward.

## Decision

- A small set of high-signal rules is a hard CI gate (`error`):
  `no-floating-promises`, `no-unused-vars`, `consistent-type-imports`,
  `no-empty` (with empty catches allowed), plus import-boundary rules.
- Everything else starts as `warn`. The total warning count is a **ratchet**:
  `npm run lint` passes `--max-warnings 493` (the Phase 0 baseline). The cap
  may only decrease; when a rule's count reaches zero it is promoted to
  `error` and removed from the cap arithmetic.
- Non-null assertions (`!`) are banned by rule today as warnings; the v1.8
  engineering gate promotes the ban to `error` (target: zero in `src/`).

## Consequences

- New code cannot grow the warning backlog.
- The `--max-warnings` number in `package.json` is load-bearing: review any
  change to it as carefully as a test-count change.
