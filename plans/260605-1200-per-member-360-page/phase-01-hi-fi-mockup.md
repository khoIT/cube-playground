---
phase: 1
title: "Hi-Fi Mockup"
status: pending
priority: P2
effort: "0.5d"
dependencies: []
---

# Phase 1: Hi-Fi Mockup

## Overview
Produce a clickable hi-fi HTML mockup of the per-member 360 page via the `huashu-design` skill, as a cheap layout-approval gate before any React. Locks panel order, header shape, KPI strip, section grouping, PII tagging, and the Behavior date-range control.

## Requirements
- Functional: single static HTML page showing a representative cfm member 360 — page-header (icon + uid title + `cfm` eyebrow), KPI strip, core panels (profile vitals, roles, devices[PII], ips[PII], activity timeline, recharge timeline, monthly rollups), and a collapsed "Behavior" section with a date-range picker placeholder + event-panel stubs.
- Non-functional: uses the repo's design tokens visually (Inter, semantic soft·ink, card borders/radius per `docs/design-guidelines.md`); reads as belonging with Dashboards/Cohort/Segments.

## Architecture
Static artifact only — no app wiring. Mirror layout conventions from `src/pages/Dashboards/index.tsx` + `src/pages/Liveops/cohort/index.tsx` headers. Use realistic placeholder values from a sample cfm user (pull a few via Trino harness in `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/trino_q.py` if helpful) so the mockup is concrete, not lorem.

## Related Code Files
- Create: `plans/260605-1200-per-member-360-page/visuals/member-360-mockup.html`
- Read: `docs/design-guidelines.md`, `src/theme/tokens.css`, `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx`

## Implementation Steps
1. Invoke `huashu-design`; provide design-guidelines.md + tokens.css + an adjacent page screenshot as the design system context (do NOT blank-slate).
2. Lay out: header → KPI strip (LTV, total active days, payer tier, lifecycle/engagement segment, max role level) → core panels grid → collapsed Behavior section.
3. Tag device/IP panels with a small "PII" chip (use `--warning-soft`/`--warning-ink` or `--muted` token visual).
4. Show the 31d date-range control on the Behavior section header.
5. Save to `visuals/`; present to user for layout sign-off.

## Success Criteria
- [ ] `visuals/member-360-mockup.html` opens standalone, renders all core panels + collapsed Behavior section.
- [ ] Visually consistent with an adjacent existing page (typography/padding/radius/color).
- [ ] PII panels visibly tagged; Behavior section shows a ≤31d date control.
- [ ] User approves layout before Phase 3 build.

## Risk Assessment
- Mockup drifts from token system → cross-check against a real page screenshot before sign-off.
- Over-investing in mockup detail → it's an approval gate, not the implementation; keep to one pass + iterate on user feedback.
