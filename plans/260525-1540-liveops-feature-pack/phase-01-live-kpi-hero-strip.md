---
phase: 1
title: "Live KPI hero strip"
status: pending
priority: P1
effort: "1-2d"
dependencies: []
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

`KPI_CONFIG` is a single source of truth in `src/pages/Liveops/kpi-config.ts`:

```ts
export const KPI_CONFIG = [
  { id: 'dau', label: 'DAU', measure: 'players.dau', timeDim: 'players.activeDate', deltaWindow: '1d' },
  { id: 'mau', label: 'MAU', measure: 'players.mau', timeDim: 'players.activeDate', deltaWindow: '7d' },
  { id: 'arpdau', label: 'ARPDAU', measure: 'revenue.arpdau', timeDim: 'revenue.txDate', deltaWindow: '1d', format: 'currency' },
  { id: 'crashes', label: 'Crashes', measure: 'crashes.count', timeDim: 'crashes.eventDate', deltaWindow: '1d', invertDelta: true },
  { id: 'd1ret', label: 'D1 retention', measure: 'cohorts.d1Retention', timeDim: 'cohorts.installDate', deltaWindow: '1d', format: 'percent' },
] as const;
```

Measure names are placeholders — wired per game when YAML schemas are confirmed (see unresolved Q in plan.md).

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

- [ ] `/liveops` route renders 5 KPI tiles with sparklines for active game.
- [ ] Delta % shown on each tile (red for crashes-up, green for KPI-up).
- [ ] Strip auto-refreshes every 45s; `LiveBadge` reflects last update.
- [ ] One failing KPI does not blank others.
- [ ] Game switch triggers refetch; no cross-game leak in sessionStorage cache (cache key includes gameId).
- [ ] Tests pass; no new TypeScript errors.

## Risk Assessment

- **Risk:** placeholder measure names (`players.dau` etc.) don't exist in production YAML.
  **Mitigation:** `kpi-config.ts` is per-game-overridable; fallback to "—" tile with tooltip if measure missing in meta.
- **Risk:** 5 parallel Cube queries on page open cause spike.
  **Mitigation:** Cube preaggregations handle this in production; locally rate-limit via `Promise.all` (no batching needed, all 5 are <50ms with preagg).
- **Risk:** setInterval drift while tab is backgrounded.
  **Mitigation:** add `document.visibilitychange` listener to pause refresh when hidden.
