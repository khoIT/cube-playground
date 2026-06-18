---
phase: 7
title: "Movement monitor UI (huashu)"
status: pending
priority: P2
effort: "2d"
dependencies: [6]
---

# Phase 7: Movement monitor UI (huashu)

## Overview

Revamp the segment **monitor view** to show how the cohort drifts over time (and
intraday): KPI trend lines, membership churn-in/out, and per-user state distribution
shifts — with a **view-time granularity toggle** (`15m|1h|3h|6h|12h|daily`). Design the
surface with **huashu-design** (hi-fi HTML variants first → user picks/mixes → React),
per the project standard for important UI. Strictly follow `docs/design-guidelines.md`.

## Requirements

- Functional: a **Movement** tab on the segment detail page with three sections —
  (a) KPI trend lines (canonical KPIs), (b) membership movement (entered/exited bars +
  member_count line), (c) distribution-trend with a dimension selector
  (lifecycle_stage / payer_tier / churn_risk / country / os_platform).
- Functional: **granularity toggle** bound to the segment's available capture cadence
  in the visible range (`effective_granularity` from Phase 6) — never offer a finer
  option than captured for that range.
- Functional: **cadence-change handling on display** (the user's question) — see below.
- Functional: a **capture-cadence control** to set the segment's `snapshot_cadence`
  (editor/admin gated), defaulting daily; explains it changes *capture*, not just view.
- Functional: date-range control; freshness badge (GMT+7); empty/loading/stale states.
- Non-functional: reuse `AssistantChartSection` — do not hand-roll charts. Tokens only,
  Inter, fixed header/tab patterns; cross-check Insights/Dashboards. Each section <200 LOC.

## Architecture

### huashu-design step (before React)

1. Run `/huashu-design` to produce hi-fi HTML variants of the monitor view (KPI strip +
   trend lines + churn bars + distribution stack + granularity toggle + cadence-change
   annotation). Explore 2–3 directions consistent with the existing design system.
2. User picks/mixes a direction. Only then translate the chosen variant to React.

### Display when cadence toggles (hour ↔ daily) — the user's question

- The chart plots native `snapshot_ts` points; the granularity toggle downsamples
  view-side (Phase 6 already returns downsampled series + metadata). Concretely:
  - **Toggle resolution is clamped to `effective_granularity`** for the visible range:
    if the range includes a daily-captured era, the finest selectable option is `daily`
    (finer options disabled with a tooltip: "captured daily in part of this range").
  - **Coarser is always fine:** picking `daily` over a mixed hourly→daily window renders
    one close-point/day everywhere — a single coherent line, no seam.
  - **Finer than captured renders as a step (carry-forward):** in a daily era viewed at
    `1h`, the daily value holds flat between captured points (dashed/step style), so it
    reads as "no intraday detail captured here", not as fake hourly data.
  - **Annotate `cadence_changes`:** a subtle vertical marker + legend note at each ts
    where capture cadence changed ("→ hourly", "→ daily"), so a density change in the
    line is explained, not mysterious.
- Net: switching a segment between hour and daily never breaks the chart — the series is
  continuous; only point density and the toggle's finest option change, both annotated.

## Related Code Files

- Create: `src/pages/Segments/detail/tabs/movement-tab.tsx` + `kpi-trend-section.tsx`,
  `membership-movement-section.tsx`, `state-distribution-trend-section.tsx`,
  `snapshot-cadence-control.tsx`.
- Modify: segment detail tab registry; a small PATCH route to set `snapshot_cadence`
  (editor-gated) if not already covered by segment update.
- Read/reuse: `preset-tab.tsx` (data-load + layout), `AssistantChartSection`,
  `Liveops/cohort/index.tsx` + `Dashboards/index.tsx` (header/spacing), `tokens.css`,
  `docs/design-guidelines.md`, Phase 6 endpoints.

## Implementation Steps

1. `/huashu-design` variants of the monitor view → user selects.
2. Build `movement-tab.tsx` shell (header/eyebrow, date-range, granularity toggle, freshness badge).
3. Implement the three sections feeding Phase-6 shapes into `AssistantChartSection`.
4. Clamp the granularity toggle to `effective_granularity`; render step/carry-forward for
   finer-than-captured ranges; draw `cadence_changes` annotations.
5. Add `snapshot-cadence-control.tsx` (set capture cadence; editor-gated; default daily).
6. Empty/loading/stale states. Cross-check typography/padding/radius/color vs Insights/Dashboards.

## Success Criteria

- [ ] Movement tab renders KPI trend, churn-in/out, distribution-trend from live endpoints.
- [ ] Granularity toggle clamps to `effective_granularity`; coarser always works.
- [ ] Mixed hourly→daily window: `daily` view is one coherent line; `1h` view shows step/carry-forward in the daily era; cadence-change markers visible.
- [ ] Capture-cadence control changes the segment's cadence (editor-gated; default daily).
- [ ] huashu variants produced + a direction chosen before React build.
- [ ] Tokens-only + `AssistantChartSection`; visually consistent with Insights/Dashboards.
- [ ] `npm run build` clean; component tests pass.

## Risk Assessment

- **Chart-shape mismatch** → Phase 6 returns props pre-aligned to `AssistantChartSection`; verify one section first.
- **Toggle implies data that isn't captured** → step/carry-forward + disabled finer options + annotations prevent misreading.
- **Design drift** → mandatory huashu + cross-check + token-only rule.
- **Non-mf_users distribution dims** → selector allow-list exposes only captured mf_users dims (plan Open Q3).
