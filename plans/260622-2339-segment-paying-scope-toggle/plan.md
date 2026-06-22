# Segment "Paying users only" scope toggle

Non-destructive `?scope=paying` view that zooms the segment detail page into the
paying sub-cohort. Plus 2 new headline KPI cards (Whales, Lapsed this month).

Decisions (confirmed with user 2026-06-22):
- Affordance: **segmented control** `[ Everyone | Paying ]` in a scope bar above the KPIs.
- Degenerate cards under scope: **Paying users → Paying rate (base %), ARPU → ARPPU**.
- Care: **include** (user chose) — but see Phase 3 constraint discovered during build.

Scope primitive: cube segment `mf_users.paying_lifetime` (`ingame_total_recharge_value_vnd > 0`),
ANDed onto cohort queries. Only offered when `preset.hubCube === 'mf_users'`.

---

## Phase 1 — Headline KPI cards (DONE)
- `server/src/presets/bundles/mf-users-hub.yml`: add `whales` + `lapsed` headline KPIs.
  Measures already precomputed (used in Engagement/Monetization tabs); grid is
  `auto-fit minmax(180px)` so 6 cards reflow to 3×2. Icons already resolve.

## Phase 2 — Live-query scope core (DONE)
Covers Headline KPIs + Insights + Monitor (all route through `useSegmentCubeQuery`).
- `segment-scope-context.tsx` (NEW): URL-backed `scope` state, `available` gate, provider.
- `components/segment-scope-bar.tsx` + `.module.css` (NEW): segmented control, payer-count
  preview, active tint + "X% of segment" note + Clear.
- `use-segment-cube-query.ts`: read scope; append `paying_lifetime` to cohort queries;
  ignore stale full-segment server cache when scoped; `ignorePayingScope` escape hatch;
  NOT applied on the `uidsOverride` enrichment path.
- `components/headline-stats-row.tsx`: per-scope spec rewrite — Size live (payer count),
  Paying users → Paying rate (base, ignore-scope), ARPU → ARPPU; others scope-invariant.
- `detail-view.tsx`: wrap in provider, render scope bar (mf_users only).
- Verified: `tsc --noEmit` clean on touched files; 114 detail tests pass.

## Phase 3 — Members tier view (DONE)
Chose option (b) — correct, live server recompute (not the cheap `ltv>0` client filter,
which drifts tier semantics). The payer sub-cohort is re-ranked into fresh
top/middle/bottom-50 with offset windows sized off the PAYER total.
- `services/segment-cohort-context.ts` (NEW): shared resolver — identity/preset/prefix/
  meta/rank/nameDim + ANDs `<hub>.paying_lifetime` onto the cohort segments; reads the
  predicate from stored `cube_query_json` (same basis as every live card). Plus
  `countPayingCohort` + `resolveRankedPayingUids`.
- `services/segment-paying-tiers.ts` (NEW): `computePayingMemberTiers` → reuses the exact
  refresh-job `computeMemberTiers` engine (same query shape/dedup/name handling).
- `routes/segment-member-tiers.ts` (NEW): `GET /member-tiers?scope=paying` + 10-min
  process-local cache (sub-scope is never precomputed; no durable serve-stale).
- FE: `api/segment-member-tiers.ts` (NEW), `tabs/paying-members-view.tsx` (NEW; loading/
  empty/unavailable/error states → feeds the SAME `TieredMembersView`), `sample-users-tab.tsx`
  branches on scope.

## Phase 4 — Care tab (DONE)
Live paying-uid resolver as flagged. The snapshot lacks per-uid LTV, so under paying scope
the builder resolves the payer subset live (predicate ∩ `paying_lifetime`, ranked, capped
at `MAX_MEMBER_UIDS=5000`) and feeds it through the unchanged downstream build.
- `cs-care-builder.ts`: `BuildCsCareOptions.payingOnly` (defaults off → precompute/refresh
  paths untouched); `coverage.truncated` now reflects the live cap.
- `routes/segment-cs-care.ts`: `?scope=paying` → separate process-local cache (no collision
  with the durable full-cohort cache) + `buildCsCarePayload({payingOnly:true})`.
- FE: `api/segment-cs-care.ts` scope param, `care-tab.tsx` re-fetches on scope flip + shows a
  paying badge. Interim `ScopeNotAppliedNote` deleted (both tabs now covered).

Tests: `server/test/segment-member-tiers-route.test.ts` (NEW), +2 paying cases in
`segment-cs-care-route.test.ts`. server tsc / FE tsc (touched) / theme-lint clean; 114 FE
detail tests + 38 server care/tier tests pass. Code-review: no blockers.

## Resolved
1. Members: built paying tiers server-side (option b) — correct over the cheap client filter.
2. Care: proceeded with the live paying-uid resolver (user: "continue on member, care").

## Open questions
None. (Minor: FE `available` gate and backend hub gate are derived independently but both
fail OPEN — a mismatch degrades to the full snapshot, never silently paying-filters a
non-payer cohort. A shared gate helper is YAGNI today.)
