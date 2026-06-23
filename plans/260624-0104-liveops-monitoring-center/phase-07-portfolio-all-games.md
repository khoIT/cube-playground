# Phase 07 — Portfolio (Command Center "All games")

**Priority:** P2 · **Status:** ✅ · Depends: 00 (KPI parity), 01

> **Built (2026-06-24):** `command-center/{portfolio-grid,portfolio-row,use-portfolio}.tsx` + a local "This game | All games" toggle on Command Center (`index.tsx`). **Design correction:** the global game selector has no "All games" sentinel, so the toggle is local state — NOT a global-selector change (avoids breaking the many single-game consumers). FE fan-out over the cached `/api/liveops/kpi-strip` + `/api/anomalies` endpoints (no cold Trino), bounded concurrency (batches of 5, Promise.allSettled), per-game error isolation, 60s poll. Ranked-by-revenue grid, WoW delta, revenue share, anomaly health flag; row click drills into single-game. Verified live (cfm/jus/ballistar). Toggle hidden in single-game workspaces. Gates pass.

## Goal
Publisher-altitude view: when the game selector is "All games", Command Center becomes a cross-title
portfolio — every title's common KPIs, normalized, ranked, MoM, contribution-to-revenue, health flags.
Drill into a title to switch to single-game mode.

## Key insights
- Reuse `Header/use-game-context.ts` (selector), `/cubes` 65-game registry, `Segments/funnel-builder/cross-game-compare.tsx` (per-game query + merge pattern).
- Uses the **common KPI subset** from Phase 00 (parity varies; cfm/jus richest).
- No new altitude page — it's a mode of the existing Command Center landing (per locked decision).

## Architecture
- Detect `game === ALL` in Command Center → render `portfolio-grid.tsx` instead of single-game trends.
- `use-portfolio.ts`: fan out the common-KPI query per visible/granted game (bounded concurrency), merge into rows; compute rank, WoW/MoM, % of portfolio revenue, health flag (tie to open anomalies count per game).
- Row click → set active game + route to single-game Command Center.

## Files
- Create: `src/pages/Liveops/command-center/portfolio-grid.tsx`, `.../command-center/use-portfolio.ts`, `.../command-center/portfolio-row.tsx`.
- Modify: `src/pages/Liveops/index.tsx` (branch on All-games; fill the Phase-01 portfolio slot).
- Reuse: `use-game-context.ts`, `funnel-builder/cross-game-compare.tsx` merge helper, anomaly counts per game.

## Steps
1. `use-portfolio` fan-out over granted games with the common KPI subset; bounded concurrency + per-game error isolation.
2. Portfolio grid: sortable, normalized KPIs, WoW/MoM, revenue-share, health flag (open anomaly count).
3. Drill: row → set active game → single-game Command Center.
4. Respect workspace grants (only games the user can see); honor prod cross-tenant trade-off note.

## Success criteria
- [ ] "All games" renders a ranked multi-title grid using the verified common KPI subset.
- [ ] Per-game tiles degrade independently (one game's failure ≠ blank grid).
- [ ] Health flag reflects open anomalies per game; drill switches context correctly.
- [ ] Single-game mode unchanged.

## Risks
- Fan-out of N games × heavy measures → use cached/rollup-served KPIs, bounded concurrency, skeletons; avoid N synchronous cold Trino reads.
- Workspace isolation: only query granted games; reuse existing game-context gating, don't widen access.
