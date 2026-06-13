# Phase 05 — Acquisition Best-Effort (DEFER CAC cost)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Reports: scout §2.2; prod-layers report §2 (acquisition partial, no CAC cube)
- Existing dims (already in spine): `cube-dev/cube/model/cubes/cfm/mf_users.yml:30-55` (install_date, install_month,
  media_source, campaign_id, is_paid_install, appsflyer_id, country, os_platform); jus equivalent in `cubes/jus/mf_users.yml`
- Existing pre-agg dim set already lists country/media_source/is_paid_install/os_platform (`cfm/mf_users.yml:322-325`)

## Overview
- **Priority:** P2 — best-effort exposure; strategic but join-fragile.
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Expose the acquisition dims ALREADY in mf_users via channel→LTV exploration views, and
  surface organic-vs-paid + install-cohort breakdowns. EXPLICITLY DEFER the CAC spend cube and
  bundle_code↔game_id map — neither exists in dev or prod (prod-layers report §2). Document the blocker as a
  follow-up plan. NO new event tables; this is a view/measure layer over existing mf_users dims.

## Key Insights
- mf_users ALREADY carries every acquisition dim needed for channel→LTV (verified `cfm/mf_users.yml:30-55,109,151`).
  No new cube required for the user-side — only exploration views + measures composing acquisition dim × LTV measure.
- CAC is BLOCKED: no media-cost cube anywhere, and `bundle_code↔game_id` mapping does not exist (unresolved Q2;
  prod-layers report §2 "you must create"). Building CAC now would require inventing the mapping — out of scope.
- `appsflyer_id` is device-level; keep `public: false` (already so) — not an analytics dim.
- These dims are mf_users-derived → `[freshness: live]` (live to yesterday).

## Requirements
- Functional: per game, a `acquisition_ltv` view (or measures on mf_users) breaking LTV / payer-rate / retention
  by media_source × is_paid_install × install_month × country. Organic-vs-paid segment dim (phase 7 consumes).
- Non-functional: pure composition over existing dims; no new source-table scans.
- Explicitly NOT building: CAC/CPI cube, bundle_code map, install→pay cost-payback. Documented as follow-up.

## Architecture
- Data flow: existing mf_users dims → exploration view composing acquisition dim × LTV/payer measures.
  Lives in `cubes/{cfm,jus}/` (view) → game-scoped. No bridge needed (mf_users IS the game spine).

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/acquisition_ltv.yml`, `.../jus/acquisition_ltv.yml`
  (thin cube/view over mf_users acquisition dims + LTV measures; or fold into user_360 view in phase 6 if simpler — DRY)
- Create (follow-up doc): `plans/260614-0040-per-game-ops-enrichment-four-layers/reports/deferred-cac-followup.md`
  (records the bundle_code↔game_id blocker + what a future CAC plan needs)
- Read: `cube-dev/cube/model/cubes/cfm/mf_users.yml`, `cube-dev/cube/model/cubes/cfm/marketing_cost.yml` (what cost data, if any, exists locally)

## Implementation Steps
1. Confirm jus mf_users carries the same acquisition dims (grep `cubes/jus/mf_users.yml`); add any missing dim
   to jus mf_users for parity (KISS — only the dims already present in cfm).
2. Decide DRY: if a standalone `acquisition_ltv` cube duplicates mf_users measures, prefer adding acquisition
   breakdown measures directly to user_360 view (phase 6) instead. Author the thin cube ONLY if it adds value
   (e.g. pre-agg target). Document the choice.
3. Add organic-vs-paid + paid-install-window segment definitions (consumed in phase 7).
4. Write `deferred-cac-followup.md`: state bundle_code↔game_id absence, no media-cost cube, what's needed to unblock.
5. Compile + per-game /meta verify.

## Todo List
- [ ] jus mf_users acquisition-dim parity check (add missing only)
- [ ] acquisition_ltv exposure (cube OR fold into user_360 — document DRY decision)
- [ ] organic-vs-paid + install-window dims for segments
- [ ] deferred-cac-followup.md written
- [ ] Compile + per-game /meta verification

## Success Criteria
- Channel→LTV browsable per game in Playground/Catalog.
- CAC explicitly deferred with a written follow-up documenting the blocker (no half-built cost cube).
- No new event-table scans introduced.

## Risk Assessment
- **Scope creep into CAC** (Med×Med): temptation to invent bundle map. Mitigate: hard DEFER + follow-up doc; locked decision.
- **DRY violation (duplicate LTV measures)** (Low×Low): Mitigate: prefer view-level breakdown over a redundant cube.

## Security Considerations
- `appsflyer_id` stays `public: false` (device id). No PII introduced — all dims already in mf_users.
