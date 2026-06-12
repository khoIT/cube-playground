---
phase: 6
title: Metric series — three-lens Trino endpoint + UI
status: completed
priority: P2
effort: 1.5d
dependencies:
  - 2
  - 5
---

# Phase 6: Metric series — three-lens Trino endpoint + UI

## Overview
Per-(segment, day) metric series joining membership snapshots to per-user daily fact marts at query time, parameterized by cohort lens. The core "metrics movement across time" capability. Server-side Trino SQL — deliberately NOT a Cube model (lenses are anchor-parameterized self-intersections Cube can't express; Cube enters in Phase 7 over the materialized aggregate).

## Key Insights
- Three lenses, all derived from existing tables (locked decision — no new snapshot tables):
  - **current**: `membership@d ⨝ fact@d` per day d — composition artifacts possible (whale exits move ARPU with no behavior change).
  - **entry** (closed cohort): uid set = `delta WHERE change='entered' AND snapshot_date>=anchor`; join that fixed set to `fact@d` for all d ≥ anchor — tracked even after members exit. Experimentation-correct lens.
  - **stayers**: `membership@anchor ∩ membership@d ⨝ fact@d` — survivor-biased by construction; UI MUST label it.
- Metric→mart binding comes from the Phase 2 eligibility matrix — start with 2 metrics × 2 games (revenue + active for cfm_vn, jus_vn), encoded in a small server registry module, not hardcoded in SQL strings.
- Join-key correctness is the #1 failure mode: membership uid namespace = segment's resolved identity dim; mart user column must match (matrix records this per mart). cfm vopenid trap applies.
- Per-user facts are never copied — locked decision; this endpoint is the JOIN side of "persist the non-recomputable, join the immutable".

## Requirements
- Functional: `GET /api/segments/:id/metric-series?metric=<key>&lens=current|entry|stayers&anchor=YYYY-MM-DD&days=N` → `{date, value, memberCount}[]` + lens metadata; FE adds metric line(s) + lens switcher (Segmented) + anchor DatePicker to the trajectory panel; stayers view carries a visible survivor-bias caption.
- Non-functional: days clamped ≤120; anchor required for entry/stayers (400 otherwise); 30s statement timeout; serialize Trino calls per request (no fan-out); same TTL cache pattern as Phase 5; metric registry validates (game, metric) eligibility before any SQL.

## Architecture
`segment-metric-registry.ts` (per-game: metric_key → {schema-relative mart, uid col, date col, value SQL expr, agg}) → `segment-metric-series-reader.ts` builds lens SQL → `runQuery` against game's `GAME_SCHEMA` schema with fully-qualified `stag_iceberg.khoitn.*` membership refs (cross-catalog join, same pattern as the snapshot writer's INSERT…SELECT) → route → FE.

## Related Code Files
- Create: `server/src/lakehouse/segment-metric-registry.ts`, `server/src/lakehouse/segment-metric-series-reader.ts`, route handler (co-locate with Phase 5 trajectory route), tests for lens SQL generation + registry gating; FE `src/pages/Segments/detail/cards/metric-trajectory-controls.tsx` (lens switcher + anchor) extending `trajectory-card.tsx`
- Read: Phase 2 matrix report, `server/src/lakehouse/lakehouse-trino-connector.ts`, `docs/lessons-learned.md` (identity/join entries)

## Implementation Steps
1. Registry: seed from Phase 2 matrix verdicts — only `eligible` (game, mart) rows; include dedupe strategy where matrix says `eligible-with-dedupe`.
2. Reader: one SQL template per lens; uid-set CTE (lens-resolved) joined to mart by uid+date; aggregate `sum/avg(value)` + `count(distinct uid)` per date. All literals via `toSqlLiteral`; dates validated `^\d{4}-\d{2}-\d{2}$`.
3. Route + validation (lens/anchor/days/metric eligibility) + cache.
4. **UI showcase first (huashu-design):** the lens switcher + anchor + survivor-bias treatment is the most design-sensitive surface in this plan — use the `huashu-design` skill to produce 2–3 HTML variants (lens Segmented placement, anchor DatePicker integration, how the stayers bias caption reads, metric/member-count dual-line composition) with real-shaped sample series and `src/theme/tokens.css` tokens; user picks/mixes a variant before any React is written (huashu variants → user picks → React pattern).
5. FE: implement chosen variant — metric select (from eligible metrics for the segment's game), lens Segmented control, anchor DatePicker (entry/stayers only), survivor-bias caption on stayers, member-count secondary line.
6. Live verification on one real segment per demo game: current vs entry vs stayers diverge plausibly; entry cohort continues past member exits (spot-check one exited uid still counted).
7. Record P95 latency over 10 varied calls → feeds Phase 7 gate decision.

## Success Criteria
- [x] All 3 lenses return correct series for real segments in cfm_vn and jus_vn (entry lens verified live to include exited members; post-review: entry lens re-verified live after switch to post-entry-only per-member clock)
- [x] Ineligible (game, metric) rejected with 400 METRIC_NOT_ELIGIBLE before touching Trino (tested)
- [x] Stayers UI visibly labeled survivor-biased (payload flag + tab blurb + banner)
- [x] Latency measurements recorded (reports/metric-series-latency-and-phase7-gate-evidence.md, P95 ≈ 1.7s)
- [x] tsc + suites green (server 31, FE 37 after review fixes)

## Risk Assessment
- Zero-row joins from namespace mismatch → registry entries require the Phase 2 join-probe to have passed; add a runtime warning when memberCount ≫ joined rows.
- Heavy scans on long ranges → days cap + partition-pruned membership side; mart side filtered by date range. If still slow, that IS the Phase 7 trigger — don't optimize speculatively here.
- Cube-only derived metrics (model-internal logic) not representable in raw SQL → out of scope for registry v1; only mart-backed metrics. Note in registry doc-comment.
