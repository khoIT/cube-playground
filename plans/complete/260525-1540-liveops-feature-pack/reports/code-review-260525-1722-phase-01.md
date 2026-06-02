# Phase 1 Code Review — Live KPI hero strip

**Date:** 2026-05-25 17:22
**Reviewer:** code-reviewer (adversarial)
**Files reviewed:** 6 new + 3 modified (route + sidebar)
**Verdict:** changes required before merge

---

## Score: 7.5 / 10

Solid skeleton, clean separation, sensible cache + abort plumbing, decent tests. Held back by one **critical correctness defect** (`defaultCubeHasGameDim` returns `true` for cubes that don't expose `.gameId` — will inject filters on non-existent dimensions → likely 400s from Cube), a token-swap race that can poison the game-scoped cache, and the largest file (`use-live-kpis.ts` at 406 LOC) violating the 200-line rule. Auto-approval threshold (≥9.5 + 0 critical) not met.

---

## Critical issues (must fix before merge)

### C1 — `defaultCubeHasGameDim` lies about the schema → likely 400s on every load
**File:** `src/pages/Liveops/use-live-kpis.ts:189-192`

```ts
function defaultCubeHasGameDim(cube: string): boolean {
  return cube === 'active_daily' || cube === 'user_recharge_daily';
}
```

**Claim:** Verified against `../cube-dev/cube/model/cubes/*/active_daily.yml` and `*/user_recharge_daily.yml` — **no `gameId` dimension exists on any of these cubes** (grep across `../cube-dev/cube/model/cubes/` returns zero hits for `gameId` or `game_id`). Game scoping in this codebase happens via the per-game JWT and `contextToAppId`/`contextToOrchestratorId`/`driverFactory` in `cube.js:119-137` — the cube model is loaded from `cube/model/cubes/${game}/`. There is no client-side gameId filter to inject.

The established pattern (see `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx:151-168`) builds the predicate from `cubejsApi.meta.cubes` and returns `false` for any cube whose meta has no dimension ending in `.gameId`. That predicate is correctly a no-op in this codebase.

Hardcoding `true` here will cause `applyGameFilter` to append `{ member: 'active_daily.gameId', operator: 'equals', values: [gameId] }` to every query. Cube's query validator rejects unknown members → HTTP 400 → every `fetchKpi` enters its catch branch (line 224-235) → all 5 tiles render `—` with "error" tooltip.

**Why the tests don't catch this:** unit tests stub the formatting helpers; the strip render test mocks `useLiveKpis` entirely; there is no end-to-end test that actually issues a `cubejsApi.load`.

**Fix sketch:** mirror QueryBuilderContainer's meta-driven probe (build once per `cubejsApi` change):
```ts
function makeCubeHasGameDim(api: CubeMetaLike): (cube: string) => boolean {
  let cache: Set<string> | null = null;
  return (cube) => {
    if (!cache) {
      const m = (api as any).meta?.cubes;
      if (!m) return false;
      cache = new Set();
      for (const c of m) for (const d of c.dimensions ?? [])
        if (typeof d?.name === 'string' && d.name.endsWith('.gameId'))
          cache.add(d.name.split('.')[0]);
    }
    return cache.has(cube);
  };
}
```
or simpler: since today every cube is game-scoped by JWT, drop `applyGameFilter` from the hook entirely (it currently buys nothing and risks 400s) — leave a comment that this is intentional and gameId is enforced server-side.

---

### C2 — Token-swap race poisons cross-game cache
**File:** `src/pages/Liveops/use-live-kpis.ts:340-403` (`fetchAll` + main `useEffect`) + `src/hooks/use-cube-token-bootstrap.ts`

**Trace:**
1. User switches `gameId` ptg → cfm. The main effect cleanup aborts the in-flight controller; `gameIdRef.current` is then set to `cfm` in the small sync effect.
2. The new main effect runs immediately. At this instant `cubejsApi` is **still bound to the ptg token** (token bootstrap is async — it dispatches a fetch to `/api/playground/cube-token?game=cfm` and only calls `saveToken` after that resolves).
3. `fetchAll(controller.signal)` fires with the ptg-bound cubejsApi but `gameIdRef.current === 'cfm'`. Cube returns ptg data (because the JWT determines the schema in `cube.js`). 
4. Line 362: `writeCache(gameIdRef.current /* 'cfm' */, results /* ptg data */)` — **cfm's sessionStorage entry now contains ptg's KPI numbers**.
5. Line 363: `setTiles(results)` — UI shows ptg's data while labeled as cfm.
6. Later, `saveToken` fires → `currentToken` changes → `useCubejsApi` rebuilds → `fetchAll` rebuilds → effect re-runs → aborts step 3, refetches with cfm token, overwrites the bad cache with correct data. UX: briefly shows ptg data on cfm; cache contains ptg data until step-6 fetch returns.

The success criterion "no cross-game leak in sessionStorage cache (cache key includes gameId)" is satisfied in spirit (key is gameId-scoped) but **violated in effect** — the bytes inside the key can be the other game's data.

**Fix sketch (cheapest):** gate `fetchAll` on token having advanced past the previous game's token. Easiest mechanism: include the active token in the effect's dep array and skip the initial fetch when `useCubeTokenBootstrap` hasn't yet applied a token for the current gameId. Either expose `lastAppliedGameId` from the bootstrap hook, or read it from a ref in a shared context. Alternative: also stamp the cache entry with a token hash and discard on mismatch.

---

### C3 — `TileErrorBoundary` doesn't reset on game switch
**File:** `src/pages/Liveops/kpi-hero-strip.tsx:182`

```tsx
<TileErrorBoundary key={tile.id} label={tile.label}>
```

`key` is the kpi id (`'dau'`, `'mau'`, ...). It does not include `gameId`. If the DAU tile throws on game=ptg (say a transient render bug from null `tone`), `hasError=true` is stuck in the class state. Switching to game=cfm does NOT unmount the boundary → DAU stays in error tooltip even though the new game's data arrives clean. The same broken boundary will persist for the lifetime of the page.

**Fix:** include `gameId` in the key, e.g. `key={\`${gameId}:${tile.id}\`}`. `gameId` is already in scope on the parent component (line 153). The boundary still doesn't reset on a *retry of the same game* (that needs an explicit `componentDidUpdate` resetting `hasError`), but cross-game stickiness is the realistic risk and the key trick fixes it.

---

### C4 — `use-live-kpis.ts` exceeds the 200-LOC modularization rule
**File:** `src/pages/Liveops/use-live-kpis.ts` — 406 LOC (limit 200)

Per `.claude/rules/development-rules.md`: "Keep individual code files under 200 lines for optimal context management."

Natural seams:
- `kpi-format.ts` — `vndFmt`, `formatValue`, `formatDelta`, `deltaTone` (≈30 LOC)
- `kpi-cache.ts` — `readCache`, `writeCache`, `CacheEntry` types (≈25 LOC)
- `kpi-fetch.ts` — `extractTimeSeries`, `computeDelta`, `buildQuery`, `fetchSimpleKpi`, `fetchDerivedKpi`, `fetchKpi`, `hasActiveDailyCube` (≈180 LOC)
- `use-live-kpis.ts` — the hook itself (≈80 LOC)

The prompt's stated "167 lines" for this file is stale — actual is 406. Either the spec needs updating or the file needs splitting; the rules favour splitting.

---

## Recommendations (nice-to-have)

### R1 — Hardcoded `recharge_date` time-dim suffix in derived KPI fetch
**`use-live-kpis.ts:275-276, 293-294`**

```ts
const numCube = numerator.split('.')[0];
const numTimeDim = `${numCube}.recharge_date`;
```

`recharge_date` is hardcoded based on the assumption that the numerator cube is always `user_recharge_daily`. If `KPI_CONFIG` later adds a derived KPI whose numerator lives on a different cube, this silently produces an invalid query. Add the numerator's time-dim to `KpiSpec.derived` (e.g. `derived: { numerator, denominator, numeratorTimeDim }`) and pass it through. YAGNI vs robustness trade-off — flag, don't block.

### R2 — `RefreshBadge` ticks forever even when the strip is unmounted's sibling has no live data
**`kpi-hero-strip.tsx:133-143`**

The 5-second `setTick` interval keeps running so long as the strip is mounted, even when `document.hidden` (tab in background). Cheap and harmless, but inconsistent with the deliberate visibility-pause on data fetching. Either pause both or neither.

### R3 — `Liveops` sidebar entry is unconditional and not localized
**`src/shell/sidebar/sidebar.tsx:159-166`**

Every other section wraps in `isVisible('<id>')` and pulls label via `t('nav.<key>')`. The new Liveops entry uses a hardcoded English label `"Liveops"` and skips the visibility flag. Either intentional (the section should always be visible) or an oversight. If intentional, add a comment; otherwise mirror the existing pattern.

### R4 — `meta()` typing relies on `as unknown as CubeMetaLike` cast
**`use-live-kpis.ts:345, 353`**

Same workaround as `src/pages/Segments/detail/use-preset.ts`. Acceptable convention in this repo, but the double cast `cubejsApi as unknown as CubeMetaLike & { load(...) }` is a smell. Consider centralizing this typing into a `cubejs-typing.ts` helper to avoid the cast spreading.

### R5 — `TileErrorBoundary` test does not actually exercise the boundary
**`kpi-hero-strip.test.tsx:174-202`**

The test defines `ThrowingValue` but never injects it; the rendered tiles are normal. The assertion `getByText('DAU')` would also pass without any boundary. To validate the contract, render a tile whose `value` IS a component that throws (e.g. inject a custom tile that wraps the value node in a component that throws). Currently the test only validates that the strip renders five labels — a duplicate of the "renders 5 live tiles" test.

### R6 — Test file duplicates production helpers instead of importing
**`use-live-kpis.test.ts:11-68`**

`formatValue`, `computeDelta`, `extractTimeSeries` are copy-pasted from `use-live-kpis.ts` rather than imported. The comment says "internal by design" — but that creates a drift risk: if the production helper changes (e.g. percent decimal precision), tests will silently still pass against the stale copy. Cheapest fix: export the helpers with an `/** @internal */` doc comment (or a `__test__` namespace export). The 200-LOC modularization in C4 would make this easier — they'd live in their own file with explicit exports.

### R7 — Hidden `console.error` in `TileErrorBoundary.componentDidCatch`
**`kpi-hero-strip.tsx:33-35`**

In production this floods the console for every tile render error. Acceptable for dev, but consider routing through an `onError` prop or the project's existing telemetry sink (if any). Non-blocking.

---

## Spec compliance matrix

| # | Requirement | Status | Note |
|---|---|---|---|
| 1 | 5 fixed KPIs for active game from GameContext | PASS | `kpi-config.ts` lists DAU/MAU/Revenue/Paying/ARPDAU |
| 2 | Tile shows value, delta, sparkline 14d, last-refresh | PASS | `LiveKpiTile` + `RefreshBadge` |
| 3 | Auto-refresh setInterval default 45s | PASS | `REFRESH_INTERVAL_MS = 45_000` |
| 4 | Loading skeleton + per-tile error fallback | PASS | `SkeletonTile` + `TileErrorBoundary` (C3 caveat: stuck on game switch) |
| 5 | Bootstrapped Cube token + `applyGameFilter` | **FAIL** | C1 — predicate hardcoded to `true`, will inject filters on cubes with no `gameId` dim |
| 6 | First paint <500ms via sessionStorage cache | PASS | `useState` initializer reads cache; loading flips false synchronously |
| 7 | Tiles share single meta request | PASS | `hasActiveDailyCube` called once per fetch cycle |
| 8 | No new deps | PASS | git diff shows no package.json changes |
| 9 | Gap-handling for muaw/ptg (no active_daily) → "—" tooltip | PASS | Logic at line 200-217; predicate via meta scan |
| 10 | Cache key includes gameId, no cross-game leak | **PARTIAL** | C2 — key is scoped but data can be stale-game during token swap |

**Score: 7 PASS / 1 PARTIAL / 1 FAIL / 1 PASS-with-bug** out of 10.

---

## Reviewer notes

**Surprising findings:**

- The phase spec confidently states *"both known cubes expose gameId dimension"* in the inline comment, but the cube YAML doesn't. Either the spec author assumed a planned schema migration that didn't happen, or the spec was drafted against a different repo state. Worth a clarifying conversation with the planner before fixing C1 — the right answer might be "drop applyGameFilter from the hook entirely; JWT is sufficient".

- `gameIdRef` is correctly stable for the interval closure (good), but reading it inside `fetchAll` instead of from the `useCallback` closure means a single `fetchAll` invocation could see different `gameIdRef.current` values across its `await` boundaries. In practice the signal-abort check on line 347/360 catches the realistic race, but it's brittle. Easier mental model: capture `const localGameId = gameIdRef.current` once at the top of `fetchAll`, then assert `localGameId === gameIdRef.current` before write-cache + setState. This pattern also lets you fold C2's token check in cleanly.

- `KpiTile`'s `value` prop is `ReactNode`. The "—" + tooltip case for unavailable/error tiles renders a `<span title=... style={{ cursor: 'help' }}>—</span>`. Inside `KpiTile` (segments/visuals/kpi-tile.tsx:27), that ReactNode is placed inside a `<p>` element. A `<span>` inside a `<p>` is valid HTML, but if the unavailable reason ever wraps into a block element, DOM nesting would be invalid. Minor — flag only because the file's comment block at line 105-106 already documents the same constraint for sparklines.

- The unit test `extractTimeSeries` passes a row keyed with `'active_daily.log_date.day'` and a `timeDimKey` of `'active_daily.log_date.day'`. The production code calls `extractTimeSeries(rows, measure, \`${kpi.timeDim}.day\`)` — note the **already-`.day`-suffixed** timeDimKey. Then inside, line 142 does `row[timeDimKey] ?? row[\`${timeDimKey}.day\`]` — looking for `active_daily.log_date.day.day` as fallback. That fallback would never match production data. The dual-lookup is dead code but harmless. (Trivia, not a defect — flag only because the dual-lookup looks intentional but contradicts caller usage.)

- The "TileErrorBoundary" test (`kpi-hero-strip.test.tsx:174-202`) is misleading — see R5. Not blocking, but the boundary isolation guarantee remains effectively untested.

---

## Unresolved questions

1. **Should `applyGameFilter` be removed entirely from Phase 1 fetching?** The cube backend already routes by JWT (`cube.js` per-game schema). The QueryBuilder uses meta-driven detection that effectively no-ops today. Mirror that, or drop the call?
2. **Does Cube reject queries with filters on unknown members, or silently drop?** If silently drops, C1 downgrades from critical → cosmetic. Worth a quick local probe (`POST /cubejs-api/v1/load` with a bogus filter member) before deciding the fix size.
3. **Is the sidebar Liveops entry intentionally always-visible and un-localized?** Other sections gate on `isVisible(...)` and use `t('nav.<key>')`.

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Phase 1 builds clean primitives but ships a likely-broken `cubeHasGameDim` predicate (C1, runtime 400s), a token-swap cache race (C2, momentary cross-game data), a non-resetting error boundary (C3), and a 406-line file violating modularization rules (C4). Critical fixes are local and self-contained.
**Concerns/Blockers:** C1 blocks merge — needs decision on game-scoping strategy (drop applyGameFilter vs meta-driven predicate). C2/C3/C4 should be fixed in the same patch.
