---
phase: 5
title: "Query builder context teardown"
status: pending
priority: P1
effort: "1w (or stop at Step 5.0 gate)"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Query builder context teardown

## Overview

The single biggest win for dim/measure click latency. Tear down `QueryBuilderContext` and migrate 80 consumers across 37 files (verified grep count, not the brainstorm's loose "80+/40") to slice-selector hooks on the per-instance Zustand store from Phase 3.

**[Red Team H2 — surgical-fix-first gate]** Before the heavy migration, ship **Step 5.0** as a single PR: `useMemo` the Provider value + drop the deep clone (with audit). Re-run Phase 1 baseline. Decide if Steps 5.A-5.F are still justified. The brainstorm's preference for "full restructure" was made without measuring the surgical fix; we owe ourselves the gate.

**[Red Team C4]** The context value is not just state — it contains live closures: `runQuery`, `stopQuery`, `clearQuery`, `setQuery`, `updateQuery`, `simpleUpdaters` (`query-builder.ts:266-337, 1445`). These close over `cubeApi`, `mutexRef`, and React `setState` setters. They **cannot** become store selectors. Split the migration into two destinations:

- **State slices → Zustand store** (`query`, `meta`, `cubes`, `members`, `executedQuery`, `resultSet`, `sqlQuery`, `pivotConfig`, `chartType`, `isLoading`, `isVerifying`, `error`, ...).
- **Actions → `useQueryBuilderActions()` hook** returning a `useRef`-stable handle with `{ runQuery, setQuery, dimensions, measures, ... }`. Composes Phase 3's store with the live closures from `useQueryBuilder`.

**[Red Team C2 / H7 — cubeApi + mutex preservation]** KeepAlive's real role is keeping `cubeApi` (built by `useMemo` in `QueryBuilder.tsx:40-46`) and `mutexRef` (`query-builder.ts:124`) alive across navigation. Phase 5.E cannot drop KeepAlive until one of these lands:

- **(a)** Promote `cubeApi` into the playground store (keyed by `apiUrl + apiToken`); promote `mutexRef.current` into the store too. `distribution-mode.tsx:35,93` and `ValuesInput.tsx:97,105` get migrated to read from the store.
- **(b)** Keep `cubeApi` per-mount but add an abort/cleanup pattern: cancel in-flight `cubeApi.load`/`cubeApi.sql` on unmount and re-issue on remount if the executed query is stale.

We pick **(a)** — it's the only option that meets the UX-untouched contract (no spinner on tab return).

Other concurrent work:

- Remove the `JSON.parse(JSON.stringify(query))` deep clone in `useQueryBuilder` (`hooks/query-builder.ts:1400`) **after C5/H8 audit lands**.
- Split the 1473-line `query-builder.ts` into focused modules **(deferred; see Step 5.A note)**.
- Remove `KeepAliveRoute` entirely.

**Cadence: strict file-by-file.** One PR per consumer file. A thin compatibility shim keeps `useQueryBuilderContext()` callable during the migration so each PR is a small, reviewable diff.

## Requirements

- Functional:
  - Identical observable behavior across all QB surfaces.
  - URL contract preserved (`?query=…`, `hashchange` deep-link).
  - **[C2/H7]** Tab switch preserves query + result set + cubeApi instance + in-flight mutex (now via store).
  - Result-outdated detection still flips when query changes vs executed query.
  - **[H4]** Existing test files that `vi.mock('../../context', ...)` get migrated to mock the new store provider.
  - **[H5]** All 6 non-QB consumers of `useAppContext().token` migrated to the store before `AppContext.token` is removed.
- Non-functional:
  - Dim/measure toggle commits ≤ X (X = Phase 1 baseline / 4; informational target).
  - `query` no longer deep-cloned on every render. **[C5/H8]** Audit confirms no in-place mutators of `query` survive; `cubes.sort(...)` is replaced with `[...cubes].sort(...)`.

## TDD Discipline

Per-file PR pattern:

1. Write a behavior test for the consumer file (or extend an existing one) asserting current observable output. Test reads via `useQueryBuilderContext()` shim.
2. Replace `useQueryBuilderContext()` reads with slice selectors (`usePlaygroundStore((s) => s.query.dimensions)` etc.).
3. Test still passes.
4. Land the PR. Next consumer is its own PR.

Cross-cutting tests (live in `src/QueryBuilderV2/hooks/__tests__/`):

- `query-builder-store-bridge.test.ts` — confirms the shim's slice reads match the legacy context value for a given `useQueryBuilder` state snapshot. Asserts no infinite loop, deep-equal skip, one-way slice direction.
- `query-no-mutate.test.ts` — render the QueryBuilder twice; `query` is shallowly frozen in dev, mutators throw.
- `keep-alive-removal.test.ts` — navigate Build → Catalog → Build; query in store survives; result set in store survives; mid-flight query abort lands cleanly.

## Architecture

### Module split — DEFERRED

The original plan split `query-builder.ts` (1473 lines) into 4 modules. **Red team correctly flagged this as code-org masquerading as perf work.** `members` (state at `query-builder.ts:199-203`) is read 48 times across the file; splitting either re-exports state across modules (ugly, no perf change) or duplicates subscriptions (slower).

**Decision:** drop the module split from this phase. Re-evaluate after Phase 5.0 measurement. If the surgical fix is enough, this whole sub-step disappears.

If we do split later, the only justified slice is:

```
src/QueryBuilderV2/hooks/query-builder/
  ├─ query-state.ts   # state slices that go to the store
  └─ actions.ts       # live closures returned by useQueryBuilderActions()
```

### Shim → store migration

Old (Phase 3 end-state):

```ts
useQueryBuilderContext() → returns context value (sourced from store internally)
```

New (Phase 5 end-state):

```ts
usePlaygroundStore((s) => s.query)
usePlaygroundStore((s) => s.query.dimensions)
useQbUiStore((s) => s.openCubes)
useQueryBuilderActions().runQuery
```

### Deep-clone removal — REQUIRES PRE-AUDIT [C5/H8]

`hooks/query-builder.ts:1400`:

```ts
// before
query: JSON.parse(JSON.stringify(query)) as Query,

// after — only after C5/H8 audit completes
query, // raw — see audit list below
```

**Known mutation sites that the clone currently hides** (Red Team C5 evidence):

| Site | Mutation | Resolution before clone removal |
|---|---|---|
| `src/QueryBuilderV2/utils/prepare-query.tsx:3-13` | `query.order = query.order.reduce(...)` rewrites order array in place | Rewrite to `return { ...query, order: newOrder }` |
| `src/QueryBuilderV2/QueryBuilder.tsx:50-58` | `queryCopy.timezone = ...` after its own `JSON.parse(JSON.stringify)` | Keep — clone is local to that helper |
| `src/QueryBuilderV2/hooks/query-builder.ts:259-264` | `cubes.sort(...)` mutates state array in render path | Replace with `[...cubes].sort(...)` and memoize (H8) |
| `src/QueryBuilderV2/QueryBuilderSidePanel.tsx:129` | `cubesOrViews.sort(...)` mutates filter result | Already in Phase 4 scope |

**Approach:** instead of dev-only `deepFreeze` (red team flagged this as fragile — `Object.freeze` only catches assignments, not array `.push`/`.sort`), switch the boundary clone to `structuredClone(query)` if a fast clone is still needed, or remove the clone entirely after rewriting `prepareQuery`. `structuredClone` is ~3× faster than `JSON.parse(JSON.stringify(...))` and ships in every supported browser.

If `Object.freeze` is kept as a dev-only guard, it must be **shallow** (`Object.freeze(query)` only — not recursive) so it doesn't trip on the `cubes` array which we cannot yet replace cleanly.

### KeepAliveRoute removal — BLOCKED ON cubeApi+mutex promotion [C2/H7]

`src/index.tsx`:

- Delete `KeepAliveRoute` function and replace with plain `<Route>`.
- Verify Suspense + lazy from Phase 2 still wires correctly.

**Hard prerequisites before this can land:**

1. **cubeApi promoted to store**, keyed by `(apiUrl, apiToken)`. **Single-entry cache** — when the key changes, the previous instance is dropped and a new one constructed. Matches today's `useMemo(() => cube(apiToken, { apiUrl }), [apiUrl, apiToken])` semantics at `QueryBuilder.tsx:40-46` exactly. Store action: `getCubeApi(apiUrl, apiToken)` lazily constructs + caches; setter resets the cache on key mismatch.
<!-- Updated: Validation Session 1 — single-entry cache strategy locked -->

2. **mutexRef promoted to store**. The 2 external consumers `src/QueryBuilderV2/analysis/distribution-mode.tsx:35,93` and `src/QueryBuilderV2/components/ValuesInput.tsx:97,105` migrate to `usePlaygroundStore(s => s.mutexObj)`.
3. **Result set re-hydration strategy.** Either keep the live `ResultSet` instance in the store (works because cubeApi is now also in the store, so the reference graph survives), OR persist the underlying `loadResponse` JSON and call `ResultSet.deserialize` on remount.
4. **In-flight query abort.** `runQuery` adds an `AbortController` so an unmount mid-fetch cancels cleanly; the store's `isLoading` flag is reset on unmount.

## Related Code Files

- Create:
  - `src/QueryBuilderV2/hooks/__tests__/query-builder-store-bridge.test.ts`
  - `src/QueryBuilderV2/hooks/__tests__/query-no-mutate.test.ts`
  - `src/QueryBuilderV2/hooks/__tests__/keep-alive-removal.test.ts`
- Modify:
  - `src/QueryBuilderV2/hooks/query-builder.ts` (drop clone, fix cubes.sort, add bridge)
  - `src/QueryBuilderV2/utils/prepare-query.tsx` (rewrite non-mutating)
  - `src/QueryBuilderV2/QueryBuilder.tsx` (memo Provider value initially; later delete provider)
  - `src/QueryBuilderV2/context.tsx` (kept as deprecated shim until all consumers migrated)
  - `src/index.tsx` (delete KeepAliveRoute)
  - 37 consumer files listed in 5.D + 3 hook test files + 6 non-QB AppContext.token consumers.
- Delete (final PR):
  - `src/QueryBuilderV2/context.tsx`
  - `KeepAliveRoute` in `src/index.tsx`
  - `token` / `apiUrl` fields in `src/components/AppContext.tsx`

## Implementation Steps

### Step 5.0 — Surgical-fix-first gate [H2] (1 PR, 1 day)

1. Wrap `QueryBuilderContext.Provider value` in `useMemo` (`QueryBuilder.tsx:181`).
2. Rewrite `prepareQuery` to return a fresh object (no in-place mutation of `query.order`).
3. Replace `cubes.sort(...)` at `query-builder.ts:259-264` with `[...cubes].sort(...)` + memoize result.
4. Replace `JSON.parse(JSON.stringify(query))` with `structuredClone(query)` as a temporary win, or remove if the prepareQuery rewrite makes it redundant.
5. Rerun Phase 1 baseline. Capture render counts + commit times for dim toggle + tab switch.

**Decision gate (Validation Session 1):** STOP HERE if BOTH conditions hold:

- Feel-test PASS on dim/measure toggle, tab switch, cold start.
- Phase 1 baseline rerun shows **≥50% drop** in `QueryBuilderSidePanel` render count for one dim toggle. (Measured via the Phase 1 `<PerfProbe>` counters.)

If either fails, proceed to Step 5.B.

<!-- Updated: Validation Session 1 — quantified gate criterion added -->

If still sluggish, proceed to 5.A.

### Step 5.A — DEFERRED [red team finding]

Module split is code-org, not perf. Skip unless Step 5.0 measurement justifies it. If we proceed, narrow scope to `query-state.ts` + `actions.ts` (state vs actions split, per C4).

### Step 5.B — Mutation audit + clone removal (1 PR, ½ day, prerequisite for store bridge)

1. Grep all `query.` and `cubes.` assignments in `src/` — list each. Currently known: `prepare-query.tsx:5-9`, `query-builder.ts:259-264`, `QueryBuilder.tsx:53-55` (local copy, safe).
2. Rewrite identified mutators to non-mutating equivalents.
3. Write `query-no-mutate.test.ts` asserting `Object.isFrozen(query)` after a render (dev-mode guard).
4. Drop the JSON-clone. Ship with shallow `Object.freeze(query)` in dev to surface future regressions.

### Step 5.C — Store bridge (1 PR, 1.5 days)

1. Inside `useQueryBuilder`, mirror state to the per-instance playground store on every change. Use `fast-deep-equal` to skip writes when source == dest **[H6]**.
2. Split returned API into:
   - State (frozen object literal): consumed by selectors.
   - Actions (`useQueryBuilderActions()` returning a `useRef`-stable handle): consumed where closures over `cubeApi`/`mutexRef`/`setState` are needed **[C4]**.
3. `useQueryBuilderContext()` shim now composes both.
4. Bridge tests: (a) legacy and store paths produce equal snapshots, (b) no infinite-loop when `query` and `pivotConfig` change in the same tick, (c) deep-equal skip prevents redundant writes.

### Step 5.D — File-by-file consumer migration (~37 PRs, 1 week)

Verified count: **80 occurrences across 37 files** (not 40). The grep also catches **3 hook test files** that `vi.mock('../../context', ...)`. Plus **6 non-QB consumers** of `useAppContext().token` need to migrate too.

Order: start with leaf consumers (no children re-rendering them), end with `QueryBuilderInternals`, `QueryBuilderSidePanel`, `QueryStatePillBar`.

Per file:

1. Identify which slice it reads (state → store selector; action → `useQueryBuilderActions()`).
2. Replace `const { x, y } = useQueryBuilderContext()` with the appropriate selector / action.
3. **[H4]** If this file has a `__tests__/*.test.ts` sibling that mocks `../context`, migrate the mock to mock the store provider (`vi.mock('../../../stores/playground-store', ...)`) or wrap tests in a real `<PlaygroundStoreContext.Provider value={createPlaygroundStore()}>`.
4. Run that file's tests + manual smoke.
5. PR title: `refactor(qb): migrate {file} to playground store`.

**Test files to migrate (H4):**
- `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-existing-tags.test.ts`
- `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-find-similar.test.ts`
- `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-reachable-members.test.ts`

**Non-QB consumers of `useAppContext().token` to migrate (H5):**
- `src/QueryBuilderV2/NewMetric/hooks/use-new-metric-meta.ts` (lines 46, 70, 105)
- `src/QueryBuilderV2/NewMetric/full-page/steps/step-6-test-run/use-test-run.ts` (lines 25, 54)
- `src/pages/Catalog/use-catalog-meta.ts`
- `src/components/SecurityContext/SecurityContextProvider.tsx`
- `src/components/Header/user-menu.tsx`
- `src/pages/Schema/SchemaPage.tsx`

### Step 5.E — Strip KeepAliveRoute (1 PR, ½ day) — REQUIRES C2/H7 PREREQUISITES

Hard prerequisites (see Architecture section):
- cubeApi in store, keyed by `(apiUrl, apiToken)`.
- mutexRef in store; `distribution-mode.tsx`, `ValuesInput.tsx` migrated.
- `runQuery` uses AbortController.
- Result set re-hydration strategy implemented.

Then:
1. Test: start a query on Build, switch route mid-flight, switch back. **Abort UX (Validation Session 1):** AbortController cancels silently; on return the store shows the *last completed* result + the existing `isResultOutdated` badge. No new UI state. User clicks Run to re-fetch if desired.
2. Test: navigate Build → Catalog → Build with completed query; assert store state survives and re-renders without spinner.
3. Delete `KeepAliveRoute` function from `src/index.tsx`; replace with `<Route>`.
4. Manual: full nav matrix; live-preview flow; SecurityContext token change (verify cubeApi single-entry cache evicts old instance).
<!-- Updated: Validation Session 1 — abort UX = silent cancel + isResultOutdated badge -->


### Step 5.F — Delete the shim (1 PR, ½ day)

1. Confirm zero remaining `useQueryBuilderContext()` call sites (grep).
2. Confirm zero remaining `useAppContext().token` / `useAppContext().apiUrl` reads (grep) — all 6 non-QB consumers migrated.
3. Delete `src/QueryBuilderV2/context.tsx`.
4. Delete `<QueryBuilderContext.Provider>` from `QueryBuilder.tsx`; the file becomes a thin component that mounts `<QueryBuilderInternals>` after meta load.
5. Remove `token`/`apiUrl` fields from `AppContext.tsx`.

## Success Criteria

- [ ] **Step 5.0 surgical-fix PR landed and measured. Decision recorded.**
- [ ] If proceeding: all step PRs land green.
- [ ] Grep `useQueryBuilderContext` returns zero hits in `src/`.
- [ ] Grep `JSON.parse(JSON.stringify(query))` returns zero hits in `src/`.
- [ ] Grep `KeepAliveRoute` returns zero hits.
- [ ] Grep `useAppContext().token` returns zero hits.
- [ ] All 3 hook test files migrated off `vi.mock('../../context', ...)`.
- [ ] Multi-tab UX: open 2 query tabs, run query in each, swap — each tab's state persists independently (no singleton collapse).
- [ ] Mid-flight cancellation: trigger a slow query, switch route before it returns, switch back — result either lands or shows as cancelled cleanly; no React unmounted-setState warnings.
- [ ] Phase 1 baseline rerun: dim toggle render count drops ≥75% vs baseline (informational).
- [ ] Manual UX matrix: playground happy + deep-link + tab switch + Catalog browse + Metric card + New Metric 6-step all unchanged.
- [ ] `npm run typecheck` + `npm run test` clean.
- [ ] Bundle: `vite build` initial chunk size noted in PR description (informational).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Per-file migration introduces silent regressions in a niche QB flow | Behavior tests written FIRST per file; manual smoke per PR; one-PR-per-file makes bisect trivial. |
| **[C5]** Removing the deep clone exposes real mutators of `query` | C5/H8 audit lists each known site; rewrite to non-mutating before clone removal. Dev-mode shallow `Object.freeze(query)` surfaces future regressions. |
| **[C2/H7]** `KeepAliveRoute` was preserving `cubeApi` + `mutexRef`, not just observable state | Step 5.E blocked on cubeApi + mutex promotion to store. AbortController for in-flight queries. ResultSet rehydration strategy decided up-front. |
| **[C1]** Singleton store collapses multi-tab QB | Resolved in Phase 3: store-factory per `<QueryBuilder>` instance via Context. Bridge tests assert two-store isolation. |
| **[C4]** Live closures can't be selectors | `useQueryBuilderActions()` hook returns stable refs; consumers split state-read from action-call. |
| **[H2]** Migration takes longer than 1 week | Step 5.0 gate decides if 5.A-5.F are even needed after surgical fix. If feel-test passes after 5.0, the rest is cancelled. |
| Store mirror-write loop bug (effect writes → effect re-fires) | **[H6]** Bridge uses `fast-deep-equal` skip for two-way slices; one-way slices for `resultSet`/`sqlQuery`/`executedQuery`. Bridge test asserts no loop. |
| **[H4]** Test mocks go inert post-migration | Migration step for each hook test file is explicit; PR template enforces test fixture migration. |
| **[H5]** `AppContext.token` deletion breaks 6 non-QB consumers | Step 5.F gated on grep returning zero hits for `useAppContext().token`. Each consumer migrated explicitly in 5.D. |
| **[H9]** hashchange race with lazy resolution | Resolved in Phase 2: mount-only listener with meta-load buffer. |
| `Object.freeze` perf cost on large meta payloads | Only shallow-freeze `query` (small object). Meta + members stay unfrozen. |
