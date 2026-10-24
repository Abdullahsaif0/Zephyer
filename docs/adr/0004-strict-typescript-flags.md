# ADR 0004 — Strict TypeScript flags, adopted and deferred

Date: 2026-10-24 · Status: Accepted

## Context

`tsconfig.json` had `strict: true` only. Phase 0 tightening surfaced 116
errors across 19 files. The flags split into three cost/benefit groups.

## Decision

**Adopted in Phase 0** (all errors fixed, zero non-null-assertion regressions
introduced):

- `noUncheckedIndexedAccess` — caught 34 genuinely unguarded array/record
  accesses, including a destructuring bug in the quality-picker options and
  unguarded `rows[rows.length - 1]` in the paged IDB read.
- `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
  `forceConsistentCasingInFileNames`.

**Deferred to Phase 1** (the v1.8 protocol refactor rewrites those types):

- `exactOptionalPropertyTypes` — 28 errors, all of the shape
  "assign `undefined` to an optional property". Fixing them properly means
  deciding, per property, between `field?: T` and `field?: T | undefined` —
  a contract decision that belongs to the typed-RPC redesign, not a
  mechanical pass.

## Consequences

- The Phase 1 protocol work must enable `exactOptionalPropertyTypes` as its
  first commit, fix the 28 sites, and never turn it off again.
- New flags land the same way: measure the error count, fix or consciously
  defer, and record the decision here.
