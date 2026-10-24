# ADR 0003 — Module layering boundaries

Date: 2026-10-24 · Status: Accepted

## Context

The extension has four isolated execution contexts (service worker, content
script, extension pages, offscreen document) with a shared protocol module.
By 1.7 the layering held by convention only: `shared.ts` imported types from
`appearance.ts` and `discovery.ts`, meaning the "protocol leaf" actually
depended on presentation and discovery code. Nothing enforced the boundaries.

## Decision

ESLint `no-restricted-imports` enforces three rules:

1. **`src/shared.ts` imports nothing from the project.** It is the protocol
   leaf: message contracts, settings types, URL/format/filename helpers.
   Types that `shared.ts` needs (e.g. `ThemeId`, `Eligibility`) are defined
   in `shared.ts`; the owning module re-exports them for its callers.
2. **Nothing imports the background service worker.** Shared behavior goes
   through `shared.ts`; coordination goes through messages.
3. **The data layer (`db.ts`) never imports UI modules.**

## Consequences

- Tree-shaking stays effective: the content script bundle does not pull the
  settings/theming graph unless it actually uses it.
- A future typed RPC registry (Phase 1) can live in `shared.ts` without
  cycles.
- When a "wrong-direction" import seems necessary, the fix is to move the
  type or constant down into `shared.ts`, never to add an exception.
