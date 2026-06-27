---
phase: 6
title: "Frontend — per-segment consumption view (Concept E)"
status: pending
priority: P2
effort: "1.5d"
dependencies: [3]
---

# Phase 6: Consumption view (Concept E)

## Overview
A per-segment consumption page: summary strip, pull-volume-by-app stacked bars, status/health
panel, and a per-page pull log with CSV export. Lets an owner observe how the contract is
actually consumed and spot broken/stale/denied consumers.

## Requirements
- Functional: summary (pulls, consuming keys, members served, success %, p95, freshness@pull), daily stacked series by key, status breakdown, paginated pull log, export CSV.
- Non-functional: design tokens; GMT+7 times; files <200 LOC; empty-but-clear states.

## Architecture
New view rendered as a sub-section of the activation tab consuming Phase 3 `/consumption`.
**Reuse, don't rebuild (red-team):** the existing admin `AuditSection` (`api-keys-tab.tsx:550`) already renders a filterable pull-log table with status badges + states and takes an optional id filter — extend/reuse its row+badge pieces rather than re-implementing the log. **Charts MUST reuse `AssistantChartSection`** (`src/pages/chat/components/assistant-chart-section.tsx`, already used by /ops) — do NOT hand-roll a stacked-bar component. statusBreakdown shows only authenticated outcomes (200 / `no_snapshot` / `rate_limited`); 401s are not here (they live in server logs now).

## Related Code Files
- Create: `src/pages/Segments/detail/tabs/consumption/consumption-view.tsx` (orchestrator)
- Create: `src/pages/Segments/detail/tabs/consumption/consumption-summary-strip.tsx`
- (NO bespoke bars file — render the stacked daily series via `AssistantChartSection`)
- Create: `src/pages/Segments/detail/tabs/consumption/consumption-health-panel.tsx` (200/401/409/429)
- Create: `src/pages/Segments/detail/tabs/consumption/pull-log-table.tsx` (per-page rows, cursor paging, CSV export)
- Modify: `src/api/segments-client.ts` (`getConsumption(id, window)`)
- Read: existing chart renderer (check `src/pages/Liveops/**` or chat chart section) before hand-rolling bars

## Implementation Steps
1. `consumption-view`: window selector (24h/7d/30d); fetch `/consumption`; lay out summary → grid(bars + health) → pull log.
2. `summary-strip`: 6 tiles (tabular-nums); freshness@pull labelled "avg snapshot age when pulled".
3. Stacked daily series **via `AssistantChartSection`** (no bespoke bars file): one series per consuming key, colors = brand + violet + chart series; legend from `byKey`.
4. `health-panel`: status counts with proportional bars (success-ink / warning-ink / destructive-ink).
5. `pull-log-table`: newest-first per-page rows (time GMT+7, app, status badge, format, pages/rows, snapshot_ts, latency); "Load older" cursor; "Export log (CSV)".
6. Empty state: "No pulls yet — share the pull recipe with a downstream app."

## Success Criteria
- [ ] View renders summary + bars + health + log from real audit; window switch refetches.
- [ ] Authenticated failures — `no_snapshot` (409) and `rate_limited` (429) — appear with correct badges, not hidden. (401 failed-auth is intentionally not here; it's in server logs.)
- [ ] CSV export matches the table; times in GMT+7; visual parity with sibling pages.

## Risk Assessment
- Local instances may have no billing/pull data → charts empty; show disclosed-empty, don't read as bug (precedent: ops charts).
- Reuse the chat/ops chart renderer to avoid a bespoke chart maintenance burden — confirm it accepts a simple stacked series.
