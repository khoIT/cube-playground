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

## Phase 3 — Members tier view (TODO)
Members uses `segment.member_tiers` (server snapshot: top/middle/bottom 50 by LTV) +
live per-row enrichment. The snapshot is full-cohort; there is no paying-only tier set.
Options:
- (a) Client filter tier rows to `ltv > 0` — cheap, but counts/"of N members" header and
  bottom-tier semantics drift (bottom-of-snapshot payers ≠ true bottom payers).
- (b) Server: compute paying-only tiers in the refresh job (new `member_tiers_paying`)
  or a live ranked-members query scoped to `paying_lifetime`. Correct, larger.
Recommendation: (b) via the existing ranked-members pull path, scoped.

## Phase 4 — Care tab (TODO — bigger than implied)
**Constraint found during build:** `cs-care-builder.ts` resolves members from the
stored `uid_list_json` snapshot, which has NO per-uid LTV — so Care cannot be
paying-filtered from the snapshot alone. Needs:
- Live resolution of the paying-uid subset (segment predicate ∩ `paying_lifetime`,
  ranked by LTV, capped at `MAX_MEMBER_UIDS`), passed into `buildCsCarePayload`.
- `GET /api/segments/:id/cs-care?scope=paying` param → thread `payingOnly` into the builder.
- Scope-aware durable cache key (`segment_care_cache` is keyed by segment id today;
  paying & all must not collide).
- FE: `segment-cs-care.ts` client + `care-tab.tsx` pass the active scope.

## Open questions
1. Members Phase 3: accept the cheap client-side `ltv>0` filter (approx) or build
   paying tiers server-side (correct)?
2. Care Phase 4 confirmed bigger than the toggle (snapshot lacks LTV) — proceed with
   the live paying-uid resolver, or defer Care to a follow-up?
