# Segment detail header redesign — locked decisions (2026-06-24)

Variant **C** (condense-don't-hide) chosen. Proposal: `design-demos/segment-header-variants.html`.

## Build
1. **Scope toggle → title row.** Remove the standalone `SegmentScopeBar` row; render a compact `Everyone | Paying` segmented control inline in the title row. Paying note (`X% of segment · Clear`) demotes to tooltip / small inline.
2. **Collapsible frozen block (condense, don't hide).** One chevron at title-row left collapses KPI cards + AI brief. When collapsed, render a one-line **mini-stat strip** (Size 866,199 ▲0.1% · Paying 18.1k ▼1.6% · …) in the header so numbers persist; table reclaims ~120px. Persist collapsed state (localStorage).
3. **Members tab highlighted** = primary destination: brand-tinted active treatment + live count badge (segment.uid_count compact).
4. **Cadence consolidation.** Retire the legacy "Live · on demand" refresh-cadence editor (pill that PATCHed `refresh_cadence_min`). ONE capture pill in the header shows `● Live · {track_cadence}` and edits `track_cadence` (server already dual-writes refresh + snapshot). Monitor **view grain** stays separate (display-only downsample).
5. Tighten vertical rhythm across title row / KPI / AI brief; max space for Members table below tabs.

## Tokens
Reuse `segments.module.css` classes; new classes via `src/theme/tokens.css` vars only (lint + visual gate).
