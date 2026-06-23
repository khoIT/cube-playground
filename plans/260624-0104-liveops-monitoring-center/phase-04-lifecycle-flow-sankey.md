# Phase 04 — Lifecycle flow Sankey (Diagnostics tab 3)

**Priority:** P1 · **Status:** ✅ · Depends: 00 (state rule), 01

> **Built (2026-06-24):** `services/lifecycle-flow.ts` + `routes/lifecycle-flow.ts` (GET /api/lifecycle-flow, aggregate `lifecycle_stage × is_paying_user` — no PII) + FE `lifecycle-flow-view.tsx` (5 real state stat-cards, verified live: cfm_vn core 117k/lapsing 59k/churned 6.5M) + hand-rolled SVG `lifecycle-sankey.tsx` + "seed segment" hook. **State counts are REAL Cube data; transitions = disclosed-empty** (mf_users has no history → no fabrication; ribbons show "populate once daily snapshots accumulate"). No migration 070 (not needed for weekly v1). Build gates pass. **Forward note:** transition ribbons require the segment-snapshot-delta accumulation path to be activated later.

## Goal
Temporal state-flow: New / Core / Lapsing / Reactivated / Churned with last-week→this-week transition
volumes + state stat-cards, highlighting the at-risk flow (mockup tab 3).

## Key insights
- **Blocks on Phase 00 lifecycle-state rule** (no Cube dimension exists).
- Transition source candidates: segment-membership lakehouse snapshot **delta** (from_state/to_state) or computed from cohort recency.
- Render: hand-rolled SVG ribbons (mockup, proven) preferred over recharts Sankey for token/control parity.

## Architecture
- Backend `server/src/routes/lifecycle-flow.ts` + `services/lifecycle-flow.ts`: given game + window, classify each user into a state at t-1 and t per the Phase-00 rule, aggregate (from,to) counts. If snapshot-delta path: read existing snapshot tables; if recency path: Cube/Trino query.
- FE: `Liveops/diagnostics/lifecycle/lifecycle-flow-view.tsx` (state stat-cards + Sankey SVG from mockup), `use-lifecycle-flow.ts`.
- Risk-flow highlight: flag the largest adverse transition (e.g. Core→Lapsing); "Seed a segment" hook → Segments editor prefilled with that cohort.

## Files
- Create: `server/src/routes/lifecycle-flow.ts`, `server/src/services/lifecycle-flow.ts`, (if rollup needed) migration `070-lifecycle-state-transitions.sql`.
- Create: `src/pages/Liveops/diagnostics/lifecycle/lifecycle-flow-view.tsx`, `.../lifecycle/lifecycle-sankey.tsx`, `.../lifecycle/use-lifecycle-flow.ts`, `src/api/lifecycle-flow.ts`.
- Reuse/reference: mockup SVG sankey, `Segments/compare/overlap-venn.tsx`, segment editor seed flow.

## Steps
1. Implement the Phase-00 state rule in the service; aggregate transition matrix for a window.
2. Route + types; weekly granularity v1 (daily only if Phase 00 confirms a rollup).
3. FE stat-cards + Sankey ribbons (hand-rolled SVG, design tokens); highlight adverse flow.
4. "Seed segment from flow" → Segments editor with the at-risk predicate prefilled.

## Success criteria
- [ ] Five states with counts + WoW deltas; ribbons sum to node totals.
- [ ] At-risk flow highlighted; "Seed a segment" opens editor prefilled.
- [ ] Serves cfm_vn (+ jus_vn if Phase 00 green); other games show "not available" cleanly.
- [ ] Matches mockup visual on tokens.

## Risks
- If snapshot delta is daily-only and weekly transitions need rollup → add the migration `070-*` sub-task or ship weekly-from-daily-diff approximation, disclosed in UI.
- State thresholds (recency windows) are a product decision from Phase 00 — surface them in a tooltip (like cohort retention definition).
