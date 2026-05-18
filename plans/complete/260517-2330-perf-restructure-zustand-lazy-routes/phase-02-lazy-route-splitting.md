---
phase: 2
title: "Lazy route splitting"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Lazy route splitting

## Overview

Replace `KeepAliveRoute` (which mounts every visited page forever) with `React.lazy` + `Suspense`. Each route becomes its own chunk → cold-start parse cost drops, background pages stop running effects. State-preservation that `KeepAliveRoute` provided is moved to Phase 3's Zustand store (this phase does NOT yet remove KeepAlive; it adds lazy *underneath* KeepAlive so behavior is preserved). Phase 5 then strips KeepAlive once the store is in place.

## Requirements

- Functional:
  - Routes `/build`, `/metrics/new`, `/catalog`, `/metric/:cube/:member` load via `React.lazy`.
  - Initial JS chunk no longer contains the bodies of those routes.
  - Suspense fallback = existing `<CubeLoader />`.
  - Deep links (`#/build?cube=…`, `#/metric/foo.bar`) still work; `hashchange` handler fires after lazy chunk resolves AND survives the race against meta-load.
- Non-functional: no UX visible delta beyond an unavoidable first-time chunk load (<200ms over local dev).

## TDD Discipline

1. Write `src/index.test.tsx` (or expand the existing route smoke test) covering:
   - Each lazy route renders without throwing when navigated to.
   - `<Suspense fallback>` is `<CubeLoader />`.
   - `hashchange` deep-link still parses `?cube=…&measure=…` after the lazy chunk resolves (assert via mocked `selectCube`).
   - **[H9]** `hashchange` fired BEFORE meta resolves still applies once meta arrives (buffered).
   - Backward-compat: `/schema` redirect to `/catalog/models` still fires.
2. Implement lazy wrappers; tests go green.

## Architecture

```
src/index.tsx
  ├─ before: KeepAliveRoute wraps each page; pages imported eagerly from src/pages
  └─ after:  KeepAliveRoute still wraps; pages imported as React.lazy(); a single
             top-level <Suspense fallback={<CubeLoader/>}> sits ABOVE the route
             switch so the boundary survives KeepAliveRoute's null-branch.

src/pages/index.tsx — REWRITE
  ├─ before: `export * from './Explore/ExplorePage'` (eager re-export — defeats lazy)
  └─ after:  `export const ExplorePage = lazy(() => import('./Explore/ExplorePage')
              .then(m => ({ default: m.ExplorePage })))`
              one lazy export per route component.
```

**[Red Team H3]** Without rewriting `src/pages/index.tsx`'s `export *` re-exports, Vite eagerly resolves the route bodies into the initial chunk and `React.lazy()` is a no-op.

**[Red Team H9 — hashchange race]** The current `hashchange` handler in `QueryBuilder.tsx:116-174` registers inside `useEffect(() => { if (!meta) return; ... addEventListener(...) }, [meta])` — it does not exist until meta-load resolves. Combined with lazy chunk loading, there is a real race window: lazy resolve → mount → meta-fetch in flight → user pastes a Try-It URL → `hashchange` fires → no listener → event lost. Phase 2 must register a mount-only listener that BUFFERS events until meta arrives, then drains.

## Related Code Files

- Modify: `src/index.tsx`, `src/pages/index.tsx` (rewrite eager `export *` → lazy exports), `src/QueryBuilderV2/QueryBuilder.tsx` (mount-only hashchange listener with meta-load buffer).
- Reuse: `src/loadable.tsx` already exists and is used at `src/ChartContainer.tsx:26-31` — adopt the existing helper instead of introducing a parallel lazy pattern.
- Create: `src/index.test.tsx` (or extend existing tests if present)

## Implementation Steps

1. Write smoke tests for each route asserting (a) it mounts via lazy, (b) Suspense fallback rendered before resolution, (c) deep-link query params still propagate, (d) **[H9] hashchange fired BEFORE meta resolves still applies once meta arrives** (buffered).
2. **[H3]** Rewrite `src/pages/index.tsx` — replace every `export * from './X'` with `export const X = lazy(() => import('./X').then(m => ({ default: m.X })))`. Confirm via grep there are zero remaining eager re-exports of route components.
3. Convert `NewMetricPage` and `NewMetricSuccess` lazy imports in `src/index.tsx` similarly.
4. Add a single top-level `<Suspense fallback={<CubeLoader />}>` above the route switch in `src/index.tsx` (NOT inside `KeepAliveRoute`'s render-prop — its `null` branch unmounts the boundary). KeepAliveRoute stays for Phase 2; Phase 5.E removes it.
5. **[H9]** In `QueryBuilder.tsx`, refactor the hashchange handler: register a stable listener in a mount-only `useEffect([])` that pushes events into a ref-held buffer. A separate `useEffect([meta])` drains the buffer once meta is ready.
6. Verify `vite build` produces ≥4 new chunks (one per route). Note initial-chunk size delta in PR description.
7. Manual smoke: every route, every deep link (including pasting a `?cube=…` hash into a cold address bar before any visit to `/build`).

## Success Criteria

- [ ] All route tests pass, **including the H9 hashchange-before-meta race test**.
- [ ] `vite build` output shows new per-route chunks; initial chunk shrinks measurably (informational, no SLA).
- [ ] Grep confirms `src/pages/index.tsx` no longer contains `export *` for route components.
- [ ] Phase 1 baseline rerun: tab-switch traces show lower script-eval on cold path.
- [ ] Manual: deep link from Slack-paste URL still seeds query, even when pasted as the FIRST navigation of a cold load.
- [ ] No new console errors / warnings during route transitions (specifically: no "A React component suspended while rendering, but no fallback UI was specified").

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `hashchange` handler fires before lazy chunk resolves → handler not registered | Mount-only listener buffers events; meta-load effect drains buffer; deep-link tested explicitly with race fixture. |
| Suspense fallback flashes on every tab switch (UX regression) | KeepAlive still preserves mount; once chunk is in module cache, second mount is sync. Visual fallback only on first visit. |
| Tests can't run lazy in vitest/jsdom | Use `vi.dynamicImportSettled()` (vitest) or `act(async () => …)` to flush microtasks. |
| `export *` re-exports leave eager imports in initial chunk | Phase 2 explicitly rewrites `src/pages/index.tsx`. Grep gate in success criteria. |
