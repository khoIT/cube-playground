---
phase: 4
title: "Frontend — library lane split + served badge + publish action (Concept B)"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 4: Library lanes (Concept B)

## Overview
Split the Segments library into a **Served downstream** lane (small, high-stakes, contract
columns) above an **Exploration** lane (scratch, last-edited + a Publish ramp), with a served
badge on rows. Mirrors the huashu Concept B mock.

## Requirements
- Functional: two labelled lanes; served rows show SLA/consumers/last-pulled/token; exploration rows show last-edited + "Publish →"; a filter (All/Exploration/Served) remains.
- Non-functional: design tokens only; served accent = `--layer-segment` violet; each new file <200 LOC.

## Architecture
Extend `Segment` type with `lifecycle` + `serving` summary; render lane components reusing the
existing row/cell pieces. Publish action calls Phase 1 endpoint then re-lists.

## Related Code Files
- Modify: `src/types/segment-api.ts` (add `lifecycle`, `served_at`, optional `serving` summary, `consumer_count`)
- Modify: `src/pages/Segments/library/library-view.tsx` (group rows into two lanes; keep filter pills)
- Create: `src/pages/Segments/library/served-lane.tsx`, `src/pages/Segments/library/exploration-lane.tsx`
- Create: `src/pages/Segments/library/cells/served-badge.tsx`, `src/pages/Segments/library/cells/sla-cell.tsx`
- Modify: `src/pages/Segments/library/row-actions-menu.tsx` (add "Publish for downstream" / "Demote")
- Modify: `src/pages/Segments/library/library-filter-pills.tsx` (Exploration/Served), `src/api/segments-client.ts` (publish/demote calls)

## Implementation Steps
1. Types: add lifecycle + serving summary fields from Phase 1 list response.
2. `library-view`: partition by `lifecycle` — `served` → ServedLane; `draft` → ExplorationLane; **`deprecated` → ExplorationLane but with a distinct "retired contract" badge** (red-team #1: `deprecated` must be *readable*, not silently identical to draft). Preserve search/sort/bulk; lane header shows count + one-line purpose + faint rule.
3. ServedLane columns: name, Snapshot SLA (sla-cell: on-time/late from serving.nextReadyAt vs cadence), Members, Consumers (reuse destinations-cell idea / consumer chips), Last pulled, Token status.
4. ExplorationLane columns: name, Health, Size, Last edited, Publish button.
5. `served-badge`: violet lozenge w/ broadcast glyph; show inline on served rows everywhere the name renders.
6. Publish/Demote in row-actions: confirm modal (demote shows consumer list from 409 guard); on success re-list.

## Success Criteria
- [ ] Served segments render only in the Served lane with contract columns; exploration in its lane with Publish.
- [ ] Publishing an exploration segment moves it to the Served lane after refresh; demote (no consumers) moves it back.
- [ ] Visual parity check vs Dashboards/Cohort pages (tokens, spacing, radius). No raw hex.

## Risk Assessment
- Don't double-fetch: the list endpoint already returns lifecycle+serving (Phase 1) — avoid an N+1 per-row contract call.
- Empty served lane state: show a one-line "No segments published yet — publish one from Exploration" hint, not a blank gap.
