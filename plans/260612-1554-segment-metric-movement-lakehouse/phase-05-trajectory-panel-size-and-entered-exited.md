---
phase: 5
title: Trajectory panel — size + entered/exited (zero-compute quick win)
status: completed
priority: P1
effort: 5h
dependencies:
  - 1
---

# Phase 5: Trajectory panel — size + entered/exited (zero-compute quick win)

## Overview
Segment-detail trajectory panel: cohort size over time + entered/exited bars, read straight from `segment_membership_daily`/`_delta`. Pure counts on existing tables — no metric joins yet. First visible consumer of the lakehouse layer.

## Key Insights
- Both series are single-partition-pruned aggregates: `count(*) GROUP BY snapshot_date` filtered by (game_id, segment_id) — cheap even on cold Trino.
- Local dev reads shared Trino fine (`lakehouseConnectorFromEnv` falls back to `cube-dev/.env`) even when local snapshot writing is disabled.
- Today's size-history serve path is SQLite `segment_refresh_log` (sparse, refresh-cadence points, capped) — this panel supersedes it for snapshot-covered segments but does NOT remove it (fallback for segments without snapshots).
- Existing chart primitives: `src/pages/Segments/detail/cards/line-chart-card.tsx`, `card-shell.tsx` — reuse, don't re-derive (design-guidelines mandate).

## Requirements
- Functional: GET endpoint returning {date, members}[] + {date, entered, exited}[]; FE panel on segment detail (monitor tab or new Trajectory card) with line + bars; graceful empty state ("no snapshots yet — first snapshot lands tonight") when no partitions exist.
- Non-functional: server-side cache (daily data → cache until next GMT+7 day or 1h TTL, whichever simpler); Trino statement timeout reuse (`LAKEHOUSE_STATEMENT_TIMEOUT_MS` is 120s — use a tighter 20s for these reads); admin-token never exposed to FE.

## Architecture
FE → `GET /api/segments/:id/trajectory?days=90` → server resolves segment (game_id) from SQLite → two Trino aggregates via `runQuery` → cached JSON. No Cube involvement.

## Related Code Files
- Create: `server/src/routes/segment-trajectory.ts` (or extend `server/src/routes/segments.ts` if <200 LOC total), `server/src/lakehouse/segment-trajectory-reader.ts`, FE `src/pages/Segments/detail/cards/trajectory-card.tsx` + test
- Modify: route registration in `server/src/index.ts`, segment detail tab/card composition (`detail-view.tsx` or `monitor-tab.tsx`)
- Read: `server/src/lakehouse/lakehouse-trino-connector.ts`, `src/pages/Segments/detail/cards/line-chart-card.tsx`

## Implementation Steps
1. `segment-trajectory-reader.ts`: `readSizeSeries(gameId, segmentId, days)` + `readDeltaSeries(...)` — parameter-validated (date math server-side, ids via `toSqlLiteral`), 20s timeout, returns typed rows.
2. Route: auth-consistent with existing segment reads; 404 unknown segment; `days` clamped 7–180; in-memory TTL cache keyed (segmentId, days).
3. **UI showcase first (huashu-design):** before writing the React card, use the `huashu-design` skill to produce 2–3 HTML design variants of the trajectory panel (line+bars composition, axis treatment, empty state) seeded with real-shaped sample data and design tokens from `src/theme/tokens.css`; present to user, let them pick/mix, THEN implement the chosen variant as React (established pattern: huashu variants → user picks → React).
4. FE `trajectory-card.tsx`: size line (primary) + entered/exited bars (secondary axis or stacked beneath); tokens only (`var(--positive)` entered, `var(--destructive-ink)` exited); empty + error states.
5. Mount on segment detail for `type='predicate'` segments with a game_id; hide otherwise.
6. Tests: reader SQL shape (literal escaping, clamping), route cache behavior, FE render with data/empty/error fixtures.

## Success Criteria
- [ ] Detail page renders ≥7-day history — BLOCKED on history accrual: only 2 snapshot partitions exist (06-10, 06-12); mechanism verified live on available days incl. gap rendering
- [x] Segment without snapshots shows informative empty state, no error noise (tested)
- [x] Repeat view within TTL issues zero Trino queries (cache-hit test)
- [x] tsc + suites green both sides

## Risk Assessment
- Trino cold-start variance (3.5–15s known) on first load → loading state + cache makes it once-per-TTL; acceptable for v1.
- Segment recreated with same id semantics (delete/recreate) → series may mix definitions; Phase 4's definition hash enables a future "definition changed" marker on the chart — note as follow-up, don't build now.
