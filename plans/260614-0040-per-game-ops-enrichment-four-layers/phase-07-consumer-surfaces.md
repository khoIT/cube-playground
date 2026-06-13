# Phase 07 — Consumer Surfaces (segments, dashboards, care/member360)

## Context Links
- Design system (MANDATORY): `docs/design-guidelines.md`; tokens `src/theme/tokens.css`; page-header pattern
  `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx`
- Segment surfaces: `src/pages/Segments/`, predicate catalog `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts`
- Care/member360: `src/pages/Segments/member360/`, `src/pages/Segments/member360/care-history-360/`,
  `src/pages/Segments/detail/tabs/care/`, `src/pages/Dashboards/cs/member360/`
- Segment metric registry: `server/src/lakehouse/segment-metric-registry.ts` (evidence-gated)
- Dashboard card pattern: `src/pages/Dashboards/tile-chart-boundary.tsx`, `pin-to-dashboard-*`

## Overview
- **Priority:** P1 — turns the data layers into usable product.
- **Status:** pending · **Depends on:** Phase 6.
- **Description:** Wire the new members into existing consumer surfaces: (a) new segment DIMENSIONS (payer tier,
  recency, geo-stability, churn-gap, CSAT/VIP, acquisition channel), (b) dashboard cards using design tokens,
  (c) Care-console / member360 hooks consuming the new monetization/identity/CS layers. Does NOT rebuild
  Segments/Care/member360 — they already exist and consume cube data; this HOOKS into them.

## Key Insights
- Segments + Care console + member360 already shipped and consume cube data (per task brief + dir listing).
  New dims become available because they're cube members (phase 6); the predicate catalog (`use-predicate-member-catalog.ts`)
  reads from cube meta — verify it picks them up automatically (same meta-driven pattern as Catalog).
- segment-metric-registry is EVIDENCE-GATED: only mart-backed metrics whose join probe PASSED get rows. New
  LIVE monetization marts (pmt_user_daily-backed) are candidates — add registry rows ONLY after phase-1 probe passed.
- Freshness tier MUST guard live UI: a lagging member (vga/cs) used in a live alerting card is wrong. Add a
  freshness badge/guard in the UI so users see "lagging — historical" on cards built from lagging cubes.
- ALL UI work follows design-guidelines.md: tokens not raw hex, fixed page-header pattern, semantic status tokens,
  spacing scale. Cross-check against an adjacent existing page before shipping.

## Requirements
- Functional: new segment dims selectable in segment editor; ≥1 dashboard card per layer (payer-360, geo/churn,
  CS/CSAT, acquisition-channel); member360/care surfaces show new monetization+identity+CS facts.
- Non-functional: design-token compliance; freshness badge on lagging-sourced cards; no PII in UI.

## Architecture
- Data flow: cube members (phase 6) → predicate catalog (segments) + tile queries (dashboards) + member360 readers.
  Live metrics → segment-metric-registry rows (gated by phase-1 probe). Lagging cubes → carry freshness badge.
- Files: FE surfaces hook existing components; BE registry gets new rows. No new physical cube names in app code
  (logical names + member-resolver passthrough on local).

## Related Code Files
- Modify: `server/src/lakehouse/segment-metric-registry.ts` (add LIVE monetization mart rows — gated by phase-1 probe pass)
- Modify/verify: `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts` (confirm auto-pickup of new dims)
- Create: dashboard card components under `src/pages/Dashboards/` (per-layer; <200 LOC each; design tokens)
- Modify: `src/pages/Segments/member360/*`, `src/pages/Segments/detail/tabs/care/*` (surface new facts)
- Read: `docs/design-guidelines.md`, `src/theme/tokens.css`, `src/pages/Dashboards/index.tsx` (header pattern)

## Implementation Steps
1. Verify predicate catalog auto-picks new dims (meta-driven). If gated, register new dims.
2. Add segment dims: payer tier/recency, geo-stability, churn-gap, CSAT/VIP, acquisition channel (organic-vs-paid).
3. Add segment-metric-registry rows for LIVE monetization marts — ONLY for (game, mart) pairs whose phase-1 join
   probe PASSED (follow the file's evidence-gating contract). Do NOT add lagging cs/vga marts as live metrics.
4. Build dashboard cards (one per layer) using design tokens + page-header pattern; cross-check vs Dashboards/Cohort page.
   Add a freshness badge (semantic token) reading the cube's freshness tier; lagging cards labeled "historical".
5. Wire member360 / care tabs to show new monetization (gross LTV/recency), identity (geo-stability/churn-gap),
   CS (recent tickets/CSAT/VIP) facts. Reuse existing reader patterns; no PII.
6. Visual cross-check each surface against an adjacent existing page (drift = bug).

## Todo List
- [ ] Verify/register new segment dims in predicate catalog
- [ ] Segment dims: payer, geo, churn, CSAT/VIP, acquisition
- [ ] segment-metric-registry rows for LIVE marts (probe-gated only)
- [ ] Dashboard cards per layer (design tokens + freshness badge)
- [ ] member360 / care tab hooks for new facts
- [ ] Design cross-check vs adjacent pages

## Success Criteria
- New dims usable in segment editor; ≥1 card per layer renders with design tokens.
- Live monetization metric movement works in segments (registry rows present, probe-gated).
- Lagging-sourced cards visibly badged historical; no PII rendered.

## Risk Assessment
- **Freshness leak into live decision** (Med×High): lagging card read as current. Mitigate: mandatory freshness badge + label.
- **Design drift** (Med×Med): new cards don't match system. Mitigate: tokens-only + adjacent-page cross-check (design-guidelines).
- **Registry row added for unprobed mart** (Med×High): zero-join metric. Mitigate: evidence-gating contract; only probe-passed pairs.

## Security Considerations
- No raw PII in any surface (geo at country grain, no IP/phone/email). member360 redacts per existing patterns.
- CS contact resolution stays in CS tooling (scout §4.4) — product shows game user_id + reachability metadata only.
