---
phase: 3
title: "Zustand stores"
status: pending
priority: P1
effort: "2d"
dependencies: [1, 2]
---

# Phase 3: Zustand stores

## Overview

Introduce Zustand-backed state for cross-route preservation. **[Red Team C1]** Stores are NOT module singletons — the playground renders one `<QueryBuilder>` per query tab (`QueryBuilderContainer.tsx:142-160`, `QueryTabs.tsx:124`), so a flat singleton would collapse tabs. We use Zustand's **store-factory pattern**: each `<QueryBuilder>` instance creates its own store via `createStore()` and provides it through a thin React context. Selector hooks read from the contextual store.

1. `createPlaygroundStore()` — factory returning a fresh store per instance. State: query, executed query, result set, sql, durations, chart type, pivot config, api token + url.
2. `createQbUiStore()` — factory returning a fresh store per QueryBuilder instance. State: openCubes, viewMode, filterString, scrollToCubeName.

After this phase: `KeepAliveRoute` can be safely removed in Phase 5 — the store keeps state alive across navigation IF the QueryBuilder instance survives. **C2 caveat:** the store does NOT itself preserve `cubeApi` + `mutexRef`; Phase 5 addresses that separately.

**[Red Team C3 — URL contract]** The `query` slice is NOT persisted. The URL hash (`?query=…`, `#/build?cube=…`) remains the source of truth. Persisted slices are limited to `chartType` and `pivotConfig` (user preferences that don't affect query identity).

`zustand` added to `dependencies` (~1KB gzipped).

## Requirements

- Functional:
  - **[C1]** Stores created per QueryBuilder instance via factory; provided through `<PlaygroundStoreContext.Provider>`. Module singleton is FORBIDDEN.
  - **[C3]** `query` slice NOT persisted. Only `chartType` + `pivotConfig` persisted to localStorage under key `gds-cube:playground-prefs`.
  - Result set / sql / durations stay in-memory only.
  - Selector subscriptions: subscribers re-render only when their slice changes.
  - **[H5]** Token/URL initially mirrored from `AppContext` (one-way write: AppContext → store). The 6 non-QB consumers (`use-new-metric-meta.ts:46,70,105`, `use-test-run.ts:25,54`, `use-catalog-meta.ts`, `SecurityContextProvider.tsx`, `user-menu.tsx`, `SchemaPage.tsx`) continue reading from AppContext for the duration of this phase. Phase 5 flips reads.
  - **[H6]** Bridge effects skip-write when source equals destination via `fast-deep-equal` (already imported in `QueryTabs.tsx:8`). `resultSet` / `sqlQuery` are one-way only (hook → store; consumers read from store but never write back).
- Non-functional: store reads must be O(1); no `JSON.parse(JSON.stringify(query))` inside selectors.

## TDD Discipline

1. Write `src/stores/playground-store.test.ts` covering:
   - **[C1]** Two stores from `createPlaygroundStore()` are independent — setting query on one doesn't affect the other.
   - `setQuery` updates only the `query` slice, not `resultSet`.
   - `setResultSet(rs)` does not trigger `query`-subscribers (selector isolation).
   - **[C3]** `persist` middleware writes ONLY `chartType` and `pivotConfig` keys; `query` is NOT in localStorage after `setQuery`.
   - Round-trip: hydrate from localStorage, chartType/pivot restored, query stays at initial empty (URL provides query, not store).
   - Reset action clears query and result set.
2. Write `src/stores/qb-ui-store.test.ts` covering:
   - **[C1]** Two stores from `createQbUiStore()` are independent.
   - `toggleCube` adds/removes from `openCubes` set.
   - `setFilterString` updates filter string.
   - Reset action clears openCubes + viewMode.
3. Write `src/stores/__tests__/bridge-comparator.test.ts` **[H6]** covering:
   - `setQuery(same)` does not trigger subscribers (deep-equal skip).
   - `setResultSet(new ResultSet object with same data)` is treated as new identity (one-way write).
   - No infinite-loop scenario when both `query` and `pivotConfig` change in the same tick.
4. Implement stores; tests go green.
5. Wire `ExplorePage` to the store (small slice — `apiToken` mirror via Context.Provider). Smoke-test the page still loads.

## Architecture

```ts
// src/stores/playground-store.ts — STORE-FACTORY PATTERN [C1]
import { createStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { createContext, useContext } from 'react';

type PlaygroundState = { /* query, executedQuery, resultSet, sqlQuery, queryDurationMs,
                            chartType, pivotConfig, apiToken, apiUrl */ };
type PlaygroundActions = { /* setters + reset() */ };

export function createPlaygroundStore() {
  return createStore<PlaygroundState & PlaygroundActions>()(
    persist(
      (set) => ({ ...initialState, ...actions(set) }),
      {
        name: 'gds-cube:playground-prefs',
        // [C3] Query is NOT persisted — URL is the source of truth.
        partialize: (s) => ({ chartType: s.chartType, pivotConfig: s.pivotConfig }),
      }
    )
  );
}

export const PlaygroundStoreContext =
  createContext<ReturnType<typeof createPlaygroundStore> | null>(null);

export function usePlaygroundStore<T>(selector: (s: PlaygroundState & PlaygroundActions) => T): T {
  const store = useContext(PlaygroundStoreContext);
  if (!store) throw new Error('usePlaygroundStore outside provider');
  return useStore(store, selector);
}
```

```tsx
// Usage inside <QueryBuilder>:
const storeRef = useRef<ReturnType<typeof createPlaygroundStore>>();
if (!storeRef.current) storeRef.current = createPlaygroundStore();
return (
  <PlaygroundStoreContext.Provider value={storeRef.current}>
    ...
  </PlaygroundStoreContext.Provider>
);
```

```ts
// src/stores/qb-ui-store.ts — same factory pattern, no persist
export function createQbUiStore() { return createStore<QbUiState & Actions>()(...); }
export const QbUiStoreContext = createContext<...>(null);
export function useQbUiStore<T>(selector: (s: QbUiState) => T): T { ... }
```

**Bridge effect [H6]** inside `useQueryBuilder`:

```ts
const eq = useRef(deepEqual);
useEffect(() => {
  const cur = store.getState();
  // Two-way slices: query, chartType, pivotConfig — only write if changed.
  if (!eq.current(cur.query, query)) store.setState({ query });
  if (cur.chartType !== chartType) store.setState({ chartType });
  if (!eq.current(cur.pivotConfig, pivotConfig)) store.setState({ pivotConfig });
  // One-way slices: hook writes, store readers don't write back.
  store.setState({ resultSet, sqlQuery, executedQuery, queryDurationMs });
}, [query, chartType, pivotConfig, resultSet, sqlQuery, executedQuery, queryDurationMs]);
```

`ExplorePage` change in this phase is the *minimum* wiring needed to validate the store works end-to-end. Full QueryBuilder migration is Phase 5.

## Related Code Files

- Create: `src/stores/playground-store.ts`, `src/stores/qb-ui-store.ts`, plus their `.test.ts` siblings, `src/stores/index.ts` barrel.
- Modify: `src/pages/Explore/ExplorePage.tsx` (consume `apiToken` selector instead of useAppContext slice for token/url), `package.json` (add `zustand`).

## Implementation Steps

1. `npm install --legacy-peer-deps zustand` — verify version pin in `package.json`.
2. Write `playground-store.test.ts` (6 cases above).
3. Implement `playground-store.ts` with `persist` middleware partialized to **chartType + pivotConfig only** (`query` excluded — URL is source of truth per C3).
4. Write `qb-ui-store.test.ts` (4 cases above).
5. Implement `qb-ui-store.ts`.
6. Write `bridge-comparator.test.ts` for the H6 cases.
7. Wire `ExplorePage` minimally via Context.Provider so the store works end-to-end. Mirror writes from `AppContext`'s existing `setContext({ token, apiUrl })` for backward-compat.
8. Run full smoke: load app, paste query in URL, run, swap tab, return — query and result both intact.

## Success Criteria

- [ ] All store test files pass.
- [ ] `gds-cube:playground-prefs` appears in localStorage after a chartType change; result set / query are NOT serialized.
- [ ] ExplorePage works against the store (smoke).
- [ ] No regression: existing `AppContext.setContext({ token, apiUrl })` callers continue to function (mirror pattern).
- [ ] React DevTools: dispatching `setResultSet` does not re-render the side panel.
- [ ] Two `<QueryBuilder>` instances in the same render tree have isolated stores (verified via test).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `persist` middleware blocks SSR | App is SPA-only (Vite, no SSR). N/A. |
| `Set` in `openCubes` not JSON-serializable | UI store is NOT persisted; only Playground store persists, and it only persists primitives. |
| **[C1] Module singleton collapses tabs** | Store-factory pattern: each `<QueryBuilder>` calls `createPlaygroundStore()` and provides via Context. Two QueryBuilders mounted by `QueryTabs.tsx` get independent stores. Bridge test asserts isolation. |
| **[C3] Persisted query overrides URL deep-link** | `query` slice removed from `partialize`. URL hash remains the source of truth. Phase 5.B keeps hashchange handler intact. |
| **[H6] Mirror-write infinite loop** | Bridge uses `fast-deep-equal` skip for two-way slices (`query`, `chartType`, `pivotConfig`). One-way slices (`resultSet`, `sqlQuery`, `executedQuery`) never write back to hook state. |
| Two sources of truth (AppContext token + store token) cause drift during migration | One-way mirror only this phase (AppContext → store). 6 non-QB consumers (H5) keep reading AppContext until Phase 5 enumerates and migrates them. **AppContext.token is NOT deleted in this phase.** |
| Result set in memory grows unbounded across queries | `setQuery` clears `executedQuery` + `resultSet` per existing useQueryBuilder semantics (preserve). |
