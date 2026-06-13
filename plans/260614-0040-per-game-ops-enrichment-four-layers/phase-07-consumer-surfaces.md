# Phase 07 — Consumer Surfaces (segments, dashboards, care/member360)

## Context Links
- Design system (MANDATORY): `docs/design-guidelines.md`; tokens `src/theme/tokens.css`; page-header pattern
  `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx`
- Predicate catalog (auto-discovers dims from /meta): `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts`
- member360 readers (VERIFIED): declarative panel registry `src/pages/Segments/member360/member360-panels.ts`
  (each game points at its `user_360.yml` view family — adding members = config + view, not new components);
  query hook `src/pages/Segments/member360/use-member-cube-query.ts`; care tab `src/pages/Segments/detail/tabs/care/`
- Segment metric registry: `server/src/lakehouse/segment-metric-registry.ts:1-19` (bare-mart, evidence-gated, no derived)
- TOKENLESS members endpoint: `server/src/routes/segments.ts:458-465`, `server/src/services/member-profile-runner.ts:103-118`

## Overview
- **Priority:** P1 — turns the data layers into usable product. Per-layer incremental (monetization cards first).
- **Status:** pending · **Depends on:** Phase 6.
- **Description:** Wire new members into existing surfaces: (a) segment DIMENSIONS — a VERIFICATION step, not new
  code (the predicate catalog auto-discovers from /meta); (b) dashboard cards using design tokens; (c) Care-console /
  member360 hooks (config entries in `member360-panels.ts` + view extension, NOT new components). Does NOT rebuild
  Segments/Care/member360 — they already consume cube data; this HOOKS into them.

## Key Insights
- **Segment dims are a VERIFICATION step (red-team #15e):** `use-predicate-member-catalog.ts` reads from cube meta —
  new dims become selectable automatically once they're cube members (phase 6), same meta-driven pattern as Catalog.
  So step 1 is "verify auto-pickup", not "write dim-registration code". Only register manually IF auto-pickup fails.
- **member360 "hook in" = config + view (VERIFIED):** `member360-panels.ts` is a declarative registry; each game points
  at its `user_360.yml` view family; new panels = config entries mapped to ~4 generic renderers + the view members from
  phase 6. `use-member-cube-query.ts` sends the per-member query (logical→physical translate, behavior date-bound). No
  new reader component needed.
- **segment-metric-registry is bare-mart + evidence-gated + no-derived (red-team #12):** entries are BARE std-mart
  tables under the game schema; YAML-internal derived metrics are NOT representable here. Adding a LIVE monetization
  mart row is a REGISTRY EXTENSION (only after the phase-1 probe PASSED) — reconcile against the existing STD_RECHARGE
  binding (it may already cover daily recharge). Do NOT add lagging cs/vga marts as live metrics.
- **Freshness badge is a LABEL, not a guard (red-team #5):** a lagging member (cs 2-day) shown on a card gets a
  "historical" badge so users know it isn't live — but nothing BLOCKS its use. Advisory only.
- **Members-API PII (red-team #11 — RESOLVED 2026-06-14: auth-gate before exposing monetization dims):** new
  monetization/CS/VIP dims added to a preset would flow through the currently-UNAUTHENTICATED
  `GET /api/segments/:id/members` (`server/src/routes/segments.ts:458-465` + `member-profile-runner.ts:103-118` build
  dims/measures from `memberColumns`) → a token-free payer/CS dossier. **Decision: add authentication to that endpoint
  BEFORE any monetization/CS/VIP dim (LTV, payer_tier, CSAT, VIP) enters a preset's `memberColumns`.** This is a REQUIRED
  sub-task of this phase, not an open question. Keep the `public:false` PII deny-list on every cube too
  (phone/email/IP/device/staff-id) as defense in depth.
- ALL UI work follows design-guidelines.md: tokens not raw hex, fixed page-header pattern, semantic status tokens,
  spacing scale. Cross-check an adjacent existing page before shipping.

## Requirements
- Functional: verify new segment dims selectable; ≥1 dashboard card per LANDED layer (monetization first); member360 /
  care surfaces show new facts via panel-registry config + view members. **Add authentication to
  `GET /api/segments/:id/members` BEFORE any monetization/CS/VIP dim enters a preset's `memberColumns`** (required sub-task).
- Non-functional: design-token compliance; freshness badge (label) on lagging-sourced cards; no PII in UI; no
  monetization/CS/VIP dim in the members-API endpoint while it is still unauthenticated.

## Architecture
- Data flow: cube members (phase 6) → predicate catalog (segments, auto) + tile queries (dashboards) + member360 panel
  registry. Live monetization mart → segment-metric-registry row (gated by phase-1 probe). Lagging cubes → freshness
  badge (label).

## Related Code Files
- Modify (REQUIRED auth-gate, before any monetization/CS/VIP dim enters a preset): `server/src/routes/segments.ts:458-465`
  (add authentication to `GET /api/segments/:id/members`); `server/src/services/member-profile-runner.ts:103-118` reads
  `memberColumns` downstream — no change needed there, the gate is at the route.
- Modify (extension, probe-gated): `server/src/lakehouse/segment-metric-registry.ts` (LIVE monetization mart row, after
  reconciling vs existing STD_RECHARGE)
- Verify (not modify unless gated): `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts`
- Create: dashboard card components under `src/pages/Dashboards/` (<200 LOC each; design tokens; freshness badge)
- Modify: `src/pages/Segments/member360/member360-panels.ts` (panel config entries), care tab under
  `src/pages/Segments/detail/tabs/care/`
- Read: `docs/design-guidelines.md`, `src/theme/tokens.css`, `src/pages/Dashboards/index.tsx`

## Implementation Steps
1. VERIFY predicate catalog auto-picks new dims (meta-driven). Register manually ONLY if auto-pickup fails.
2. Add segment-metric-registry row(s) for LIVE monetization mart — ONLY for (game, mart) pairs whose phase-1 probe
   PASSED; reconcile against existing STD_RECHARGE (don't duplicate). Do NOT add lagging cs/vga marts.
3. Build dashboard cards (monetization first, then per landed layer) using design tokens + page-header pattern;
   cross-check vs Dashboards/Cohort. Add a freshness BADGE (semantic token) reading the cube's freshness tier; lagging
   cards labeled "historical" (label only).
4. Wire member360 / care via `member360-panels.ts` config entries pointing at the new user_360 members + the care tab
   components. Reuse `use-member-cube-query.ts`; no new reader.
5. **Members-API auth-gate (REQUIRED, do FIRST among the PII steps):** add authentication to
   `GET /api/segments/:id/members` (`server/src/routes/segments.ts:458-465`) BEFORE adding any monetization/CS/VIP dim
   (LTV, payer_tier, CSAT, VIP) to a preset's `memberColumns`. Keep PII dims `public:false` on the cubes regardless
   (defense in depth). Only after auth lands may the monetization/CS/VIP dims enter presets.
6. Visual cross-check each surface against an adjacent existing page (drift = bug).

## Todo List
- [ ] Verify segment dims auto-pickup (register only if gated)
- [ ] segment-metric-registry LIVE monetization row (probe-gated, reconciled vs STD_RECHARGE)
- [ ] Dashboard cards per landed layer (design tokens + freshness badge label)
- [ ] member360 panel-registry config + care tab entries (no new readers)
- [ ] Add auth to GET /api/segments/:id/members (segments.ts:458-465) BEFORE any monetization/CS/VIP dim enters a preset
- [ ] PII dims kept public:false on every cube (defense in depth)
- [ ] Design cross-check vs adjacent pages

## Success Criteria
- New dims usable in segment editor (verified auto-pickup); ≥1 card per landed layer renders with design tokens.
- Live monetization metric movement works (registry row present, probe-gated, reconciled).
- Lagging-sourced cards visibly badged historical (label); no PII rendered.
- `GET /api/segments/:id/members` requires authentication before any monetization/CS/VIP dim is added to a preset
  (no token-free payer/CS dossier reachable).

## Risk Assessment
- **Tokenless PII dossier** (High×High, user policy): monetization/CS/VIP dim leaks via the unauthenticated endpoint.
  Mitigate: auth-gate `GET /api/segments/:id/members` BEFORE any such dim enters a preset (required sub-task);
  `public:false` PII deny-list on every cube as defense in depth.
- **Registry row for unprobed/duplicate mart** (Med×High): zero-join or double-count. Mitigate: evidence-gating + STD_RECHARGE reconcile.
- **Design drift** (Med×Med): tokens-only + adjacent-page cross-check.
- **Freshness badge mistaken for a block** (Low×Med): it's a label. Mitigate: documented advisory.

## Security Considerations
- No raw PII in any surface (geo at country grain; no IP/phone/email/device/staff-id). member360 redacts per existing patterns.
- CS contact resolution stays in CS tooling; product shows game user_id + reachability metadata only.
