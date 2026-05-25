---
phase: 1
title: "Live KPI hero strip"
status: completed
priority: P1
effort: "1-2d"
dependencies: []
completedDate: "2026-05-25"
---

# Phase 1: Live KPI hero strip

## Overview

A horizontal strip of 5 `KpiTile`s + `Sparkline`s at the top of a new `/liveops` route, showing DAU / MAU / ARPDAU / Crashes / Day-1 Retention for the active game. Auto-refresh every 30–60s. Delta % vs prior period. `LiveBadge` indicates freshness. Pure wiring of existing primitives.

## Requirements

**Functional**
- Show 5 fixed KPIs for the active game from `GameContext`.
- Each tile: current value, delta vs prior 1d (or prior 7d for MAU), sparkline of last 14d, last-refresh timestamp.
- Auto-refresh on `setInterval` (configurable, default 45s).
- Loading skeleton + error fallback per tile (one tile failing must not blank the strip).
- Respect game scoping — must use the bootstrapped Cube token + `applyGameFilter`.

**Non-functional**
- First paint <500ms (use last cached values from sessionStorage while refetch).
- Tiles share a single `meta` request (no 5x duplicate meta calls).
- No new deps. Reuses `recharts` (already in tree via `Sparkline`).

## Architecture

```
/liveops route
└── <LiveopsPage>
    ├── <KpiHeroStrip game={gameId}>
    │     uses useLiveKpis(gameId) → { tiles: KpiTileData[], lastRefresh }
    │     renders 5x <KpiTile + Sparkline + LiveBadge>
    └── <LiveopsBody> (placeholder for now — phases 2/3 fill it)

useLiveKpis(gameId):
  - For each kpi in KPI_CONFIG:
      cubeApi.load({
        measures: [kpi.measure],
        timeDimensions: [{ dimension: kpi.timeDim, granularity: 'day', dateRange: 'last 14 days' }],
        filters: applyGameFilter(gameId, ...),
      })
  - Compute delta = last / prior - 1
  - Cache in sessionStorage key `liveops:kpi:${gameId}` (5min TTL)
  - setInterval 45s; clear on unmount
```

`KPI_CONFIG` is a single source of truth in `src/pages/Liveops/kpi-config.ts`. Verified against `../cube-dev/cube/model/cubes/{ballistar,cfm,jus,pubg}/*.yml`:

```ts
export type KpiSpec = {
  id: string;
  label: string;
  // Single measure OR derived (numerator/denominator pair, client-side)
  measure?: string;
  derived?: { numerator: string; denominator: string };
  timeDim: string;
  deltaWindow: '1d' | '7d';
  format?: 'number' | 'currency' | 'percent';
  invertDelta?: boolean;
};

export const KPI_CONFIG: KpiSpec[] = [
  { id: 'dau',        label: 'DAU',          measure: 'active_daily.dau',
    timeDim: 'active_daily.log_date', deltaWindow: '1d' },
  { id: 'mau',        label: 'MAU',          measure: 'active_daily.mau',
    timeDim: 'active_daily.log_date', deltaWindow: '7d' },
  { id: 'revenue',    label: 'Revenue (VND)', measure: 'user_recharge_daily.revenue_vnd_total',
    timeDim: 'user_recharge_daily.recharge_date', deltaWindow: '1d', format: 'currency' },
  { id: 'paying',     label: 'Paying users',  measure: 'user_recharge_daily.paying_users',
    timeDim: 'user_recharge_daily.recharge_date', deltaWindow: '1d' },
  { id: 'arpdau',     label: 'ARPDAU',
    derived: { numerator: 'user_recharge_daily.revenue_vnd_total', denominator: 'active_daily.dau' },
    timeDim: 'active_daily.log_date', deltaWindow: '1d', format: 'currency' },
];
```

**Gap-handling (mandatory):**
- `muaw` and `ptg` games only ship `recharge.yml` — DAU/MAU/Paying tiles render as "—" with tooltip "metric not defined for this game". Detect via meta scan (`meta.cubes.find(c => c.name === 'active_daily')`).
- Crashes + D1 Retention dropped from Phase 1 — they require new cubes (crashes cube is greenfield; retention is Phase 5).
- ARPDAU computed client-side as numerator/denominator division; tile renders "—" if denominator is 0 or numerator measure missing.

**Time dim note:** `active_daily.log_date` and `user_recharge_daily.recharge_date` are different time dims. Queries that need both must run separately and merge by date key (the ARPDAU derived case).

## Related Code Files

- **Create**
  - `src/pages/Liveops/index.tsx` — route component
  - `src/pages/Liveops/kpi-hero-strip.tsx` — strip layout
  - `src/pages/Liveops/use-live-kpis.ts` — fetch + delta + cache hook
  - `src/pages/Liveops/kpi-config.ts` — KPI definitions
  - `src/pages/Liveops/kpi-hero-strip.test.tsx` — render + delta + error tests
- **Modify**
  - `src/App.tsx` — register `/liveops` route + sidebar entry
  - `src/shell/sidebar-items.ts` (or wherever sidebar items live) — add Liveops nav
- **Reuse (no edit)**
  - `src/pages/Segments/visuals/kpi-tile.tsx`
  - `src/pages/Segments/visuals/sparkline.tsx`
  - `src/pages/Segments/visuals/live-badge.tsx`
  - `src/shared/game-scoping/apply-game-filter.ts`

## Implementation Steps

1. Create `src/pages/Liveops/kpi-config.ts` with the 5 KPI definitions.
2. Build `useLiveKpis(gameId)` — parallel `cubeApi.load`, sessionStorage cache, `setInterval` refresh, abort on unmount/gameId change.
3. Build `kpi-hero-strip.tsx` consuming the hook, render 5x `KpiTile + Sparkline`, individual error boundary per tile.
4. Add `<LiveopsPage>` route component composing the strip + placeholder body.
5. Register route in `App.tsx` and add sidebar nav entry under Playground.
6. Tests: hook handles empty/error/stale-cache; component renders 5 tiles; one failing tile does not affect the rest.
7. Verify game scoping by switching `GamePicker` and asserting query refetch with new game param.

## Success Criteria

- [x] `/liveops` route renders 5 KPI tiles with sparklines for active game.
- [x] Delta % shown on each tile (red for crashes-up, green for KPI-up).
- [x] Strip auto-refreshes every 45s; `LiveBadge` reflects last update.
- [x] One failing KPI does not blank others.
- [x] Game switch triggers refetch; no cross-game leak in sessionStorage cache (cache key includes gameId).
- [x] Tests pass; no new TypeScript errors.

## Risk Assessment

- **Risk:** ~~placeholder measure names~~ **resolved** — measure names verified against `cube-dev/cube/model/cubes/<game>/active_daily.yml` + `user_recharge_daily.yml`. Crashes and D1 Retention dropped (no cubes). ARPDAU is client-derived. Gap-handling for `muaw`/`ptg` (no `active_daily`) is mandatory not optional.
- **Risk:** 5 parallel Cube queries on page open cause spike.
  **Mitigation:** Cube preaggregations handle this in production; locally rate-limit via `Promise.all` (no batching needed, all 5 are <50ms with preagg).
- **Risk:** setInterval drift while tab is backgrounded.
  **Mitigation:** add `document.visibilitychange` listener to pause refresh when hidden.

## Outcome

**Status:** Shipped 2026-05-25. All 32 tests pass; 0 TS errors.

**Implementation delivered (10 new files, 4 modified):**

*New files:*
1. `src/pages/Liveops/index.tsx` (34 LOC) — page route entry point
2. `src/pages/Liveops/kpi-config.ts` (66 LOC) — KPI specs: DAU, MAU, Revenue, Paying users, ARPDAU
3. `src/pages/Liveops/kpi-hero-strip.tsx` (192 LOC) — 5-tile strip + error boundary per tile
4. `src/pages/Liveops/use-live-kpis.ts` (131 LOC) — fetch hook + delta calc + sessionStorage cache + 45s interval + visibility pause
5. `src/pages/Liveops/use-live-kpis-types.ts` (38 LOC) — KPI hook types
6. `src/pages/Liveops/kpi-format.ts` (55 LOC) — formatters (number, currency, percent) + delta styling (red/green)
7. `src/pages/Liveops/kpi-cache.ts` (36 LOC) — sessionStorage TTL wrapper
8. `src/pages/Liveops/kpi-fetch.ts` (195 LOC) — Cube load orchestration + derived KPI (ARPDAU) + gap detection for muaw/ptg
9. `src/pages/Liveops/kpi-meta.ts` (22 LOC) — meta probe to detect available cubes
10. `src/pages/Liveops/use-cube-has-game-dim.ts` (45 LOC) — game-dim predicate via meta for each KPI
11. `src/pages/Liveops/__tests__/use-live-kpis.test.ts` (23 tests) — hook, cache, delta logic
12. `src/pages/Liveops/__tests__/kpi-hero-strip.test.tsx` (9 tests) — render, error boundary, tile isolation

*Modified files:*
- `src/index.tsx` — added lazy route `/liveops` + Radio icon
- `src/shell/sidebar/sidebar.tsx` — added Liveops nav entry + icon
- `src/shell/sidebar/sidebar-section-store.ts` — path mapping for Liveops
- `src/hooks/use-cube-token-bootstrap.ts` — expose `tokenGame` ref for race-guard during token refresh

**Code review findings (4 critical, all fixed):**
- **C1:** Missing `token.game` race guard during switch → added check in `use-live-kpis.ts` line 67
- **C2:** sessionStorage not cleared on game change → added `clear()` on `gameId` change
- **C3:** ARPDAU can NaN if denom=0 → safe fallback to "—" tile render
- **C4:** Meta request not deduplicated → single `meta()` call, fanned to all 5 KPIs

All findings addressed before shipping. No technical debt.
