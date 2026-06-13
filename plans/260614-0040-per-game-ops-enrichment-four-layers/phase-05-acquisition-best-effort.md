# Phase 05 — Acquisition Best-Effort (channel-grain CAC OK; DEFER bundle-level CAC)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- EXISTING cost cube (corrects "no media-cost cube anywhere"): `cube-dev/cube/model/cubes/cfm/marketing_cost.yml`,
  `cube-dev/cube/model/cubes/jus/marketing_cost.yml` — spend/impressions/clicks by channel/campaign/adset/ad +
  media_source; carries native + USD + VND cost. Channel-grain CAC/CPI/CPC/CPM computable TODAY.
- Existing acquisition dims (spine): `cube-dev/cube/model/cubes/cfm/mf_users.yml` (install_date, install_month,
  media_source, campaign_id, is_paid_install, appsflyer_id, country, os_platform)
- jus mf_users identity-merge hazard: `cube-dev/cube/model/cubes/jus/mf_users.yml:2-35` (max()-merge over dual rows)
- DEAD appsflyer map: `iceberg.appsflyer.map_appsflyer_games` (27 rows, 1 active = tpg)

## Overview
- **Priority:** P2 — best-effort exposure; strategic but partially join-fragile. Lands after MVP (incremental).
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Expose the acquisition dims ALREADY in mf_users via channel→LTV exploration views, AND compose
  channel-grain CAC from the EXISTING `marketing_cost` cube (spend ÷ installs/payers by media_source). DEFER only
  **bundle-level CAC** (`gds_bundle_code`-keyed cost), which has no working bridge. Document the bundle-level blocker.

## Key Insights
- **CORRECTED (red-team #10):** a media-cost cube EXISTS (`marketing_cost.yml`, both games) with spend + CPC/CPM at
  channel/campaign grain. So **channel-grain CAC is computable today** (marketing_cost spend by media_source ÷
  mf_users installs/payers by media_source). Only BUNDLE-level CAC (per `gds_bundle_code`) is blocked.
- mf_users ALREADY carries every user-side acquisition dim for channel→LTV. No new cube for the user side — only
  exploration views + measures composing acquisition dim × LTV measure.
- **jus mf_users is NOT identical to cfm** (red-team #14, verified `jus/mf_users.yml:2-35`): jus `max()`-merges two
  disjoint identity rows (a bare GDS-id row with attribution dims + an `@vng_vie…` row with ingame dims). So jus
  acquisition dims (media_source/campaign/is_paid_install) come from the merged half, not a plain column. The
  channel→LTV view for jus must read the MERGED dims (already merged in jus mf_users SQL) — do NOT assume cfm-parity
  attribution; verify the merged dim is non-NULL for payers before trusting channel attribution.
- `appsflyer_id` is device-level → keep `public:false`. These dims are mf_users-derived → `[freshness: live]`.
- `iceberg.appsflyer.map_appsflyer_games` is DEAD → no per-game bundle CAC bridge. `mdm.map_product_code.gds_bundle_code`
  is a POSSIBLE future bundle↔cost bridge (follow-up, not this round).

## Requirements
- Functional: per game, an `acquisition_ltv` exploration view (or measures on mf_users) breaking LTV/payer-rate/retention
  by media_source × is_paid_install × install_month × country; PLUS channel-grain CAC measures composing marketing_cost
  spend with mf_users installs/payers by media_source. Organic-vs-paid segment dim (phase 7 consumes).
- Non-functional: pure composition over existing dims + existing marketing_cost cube; no new source-table scans.
- Explicitly NOT building: BUNDLE-level CAC, `gds_bundle_code↔cost` bridge. Documented as follow-up.

## Architecture
- Data flow: mf_users acquisition dims + `marketing_cost` spend → exploration view composing acquisition dim ×
  (LTV/payer measures + channel CAC). Lives in `cubes/{cfm,jus}/` → game-scoped (mf_users + marketing_cost are
  already game-scoped). No bridge needed for the user side; CAC joins spend↔installs on media_source.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/acquisition_ltv.yml`, `.../jus/acquisition_ltv.yml` (thin view over mf_users
  acquisition dims + LTV measures + marketing_cost channel CAC; OR fold into user_360 in phase 6 if simpler — DRY)
- Create (follow-up doc): `reports/deferred-cac-followup.md` (records the BUNDLE-level CAC blocker + dead appsflyer map
  + gds_bundle_code as a possible future bridge)
- Read: `cube-dev/cube/model/cubes/{cfm,jus}/mf_users.yml`, `cube-dev/cube/model/cubes/{cfm,jus}/marketing_cost.yml`

## Implementation Steps
1. Confirm jus mf_users carries the merged acquisition dims (`jus/mf_users.yml` merge block) and that they're non-NULL
   for payers (the merge hazard) — spot-check via Trino. Add any missing dim only for parity (KISS).
2. DRY decision: if a standalone `acquisition_ltv` cube duplicates mf_users measures, prefer adding the breakdown +
   channel-CAC measures to user_360 (phase 6). Author the thin cube ONLY if it adds value (e.g. pre-agg target). Document.
3. Compose channel-grain CAC: marketing_cost spend by media_source ÷ mf_users installs (and payers) by media_source.
   Handle jus's merged attribution dim (not cfm-parity).
4. Add organic-vs-paid + paid-install-window segment definitions (consumed in phase 7).
5. Write `deferred-cac-followup.md`: state BUNDLE-level CAC blocker (dead appsflyer map; gds_bundle_code future bridge).
   NOTE: channel-grain CAC is NOT deferred — it ships here.
6. Compile (isolated) + per-game /meta verify.

## Todo List
- [ ] jus mf_users merged acquisition-dim verification (non-NULL for payers) + parity check
- [ ] acquisition_ltv exposure (cube OR fold into user_360 — document DRY decision)
- [ ] Channel-grain CAC measures from marketing_cost (jus merge-hazard handled)
- [ ] organic-vs-paid + install-window dims for segments
- [ ] deferred-cac-followup.md (BUNDLE-level only; channel-grain ships)
- [ ] Compile (isolated) + per-game /meta verification

## Success Criteria
- Channel→LTV AND channel-grain CAC browsable per game in Playground/Catalog.
- BUNDLE-level CAC explicitly deferred with a written follow-up; channel-grain CAC shipped (marketing_cost exists).
- jus attribution-merge handled (not assumed cfm-parity); no new event-table scans.

## Risk Assessment
- **jus attribution-merge mishandled** (Med×High): reading a non-merged dim yields NULL channel for jus payers.
  Mitigate: read the merged dim from jus mf_users SQL; verify non-NULL for payers.
- **Scope creep into bundle CAC** (Med×Med): temptation to invent the gds_bundle_code↔cost bridge. Mitigate: hard
  DEFER (bundle only) + follow-up doc.
- **DRY violation (duplicate LTV measures)** (Low×Low): prefer view-level breakdown over a redundant cube.

## Security Considerations
- `appsflyer_id` stays `public:false` (device id). No PII introduced — all dims already in mf_users / marketing_cost.
