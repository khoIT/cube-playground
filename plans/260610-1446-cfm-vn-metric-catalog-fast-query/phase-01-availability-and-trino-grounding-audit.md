---
phase: 1
title: "Availability & Trino-grounding audit (cfm_vn)"
status: completed
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Availability & Trino-grounding audit (cfm_vn)

## Overview
For each of the 57 catalog metrics, prove it actually resolves and returns data for
cfm_vn against the live model — separating "listed" from "works". Read-only.

## Requirements
- Functional: per-metric verdict ∈ {resolvable+data, resolvable+empty, broken-ref, stub-errors,
  **no-data**}. Resolve logical cube → cfm physical cube (`recharge`/`retention`/`funnel` are
  `sql:`-defined, not `sql_table`), confirm each referenced measure exists in cfm `/meta`, and
  probe one live query (last-7d, day grain) per distinct backing cube.
- **Data presence, not just schema** (red-team): "modeled ≠ has data". Each backing cube/
  event table must return non-trivial rows in a recent window, else its metrics are `no-data`
  (excluded from width + seeds). DESCRIBE alone is insufficient.
- **cfm recharge PK verdict** (red-team hard finding): cfm `recharge` is `sql:`-defined with
  both `transaction_id`(vng_transaction) and `fsequence_no`; we audited *jus*, not cfm. Verify
  cfm's declared recharge PK is genuinely unique (single-row-per-transaction) — a daily revenue
  rollup will dedup on it, so a non-unique PK re-triggers the ~800× inflation bug. Output a
  clear pass/fail; **Phase 4 is blocked on this**.
- **Wire verdicts into availability**: broken-ref / stub-errors / no-data metrics must flow into
  `game_compatibility` (server/src/types/business-metric.ts + care/availability.ts) so the chat
  agent stops offering dead cfm_vn metrics — this is itself an accuracy win, but only if wired.
- Non-functional: record cold-Trino wall time per cube as the Phase-3/4 baseline.

## Architecture
Probe via the server proxy at `:3004` (`/cube-api/v1/{meta,load,sql}`) with
`x-cube-workspace: local`, `x-cube-game: cfm_vn` (NOT raw :4000 — proxy injects token).
Group the 57 by backing cube so each cube is probed once, not 57×.

## Related Code Files
- Read: `server/src/presets/business-metrics/*.yml` (the 57 defs)
- Read: `server/src/types/business-metric.ts`, `server/src/care/availability.ts` (compat logic)
- Read: `cube-dev/cube/model/cubes/cfm/*.yml` (logical→physical resolution)
- Create: `plans/.../reports/cfm-vn-metric-availability-matrix-report.md`

## Implementation Steps
1. Parse the 57 presets → (id, tier, formula, required logical cubes, measures).
2. Build logical→cfm-physical map; flag any ref with no cfm cube/measure (broken-ref).
3. For each distinct backing cube: GET `/meta` (measure exists?) + one `/load` probe
   (returns rows? errors? wall time). `sql:`-defined cubes (recharge/retention/funnel) are
   the error-risk — probe explicitly.
4. Classify each metric; record cold wall time per cube.

## Success Criteria
- [ ] All 57 classified with evidence (meta hit + probe result + timing + data-presence).
- [ ] Broken-refs / stub-errors / no-data listed explicitly (gate Phase 2/3) AND wired into availability.
- [ ] cfm recharge PK pass/fail recorded (Phase-4 blocker).
- [ ] Cold per-cube baseline recorded for the <2s target.

## Risk Assessment
- `sql:`-cube probe errors (e.g. cros recharge_date type bug seen before) → log, don't block.
- Approx measures (count_distinct_approx) "empty" vs "zero" ambiguity → probe a known-active window.

## Next steps
Feeds Phase 2 (curation must know what's broken) and Phase 3 (cold baselines).
