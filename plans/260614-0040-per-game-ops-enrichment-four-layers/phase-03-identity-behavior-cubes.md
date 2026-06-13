# Phase 03 — Identity + Behavior Cubes (member-360 spine)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Reports: scout §2.3 (identity hazards), §5 (id namespaces)
- Prod oracle: `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_user_master.yaml` (geo/account dims, PII-excluded)
- Source tables: `vga.ingame_user_profile` (~2mo lag), `gds_da.mf_ip2location` (LIVE 2026-05-18),
  `thinking_data.{game}__events` (cfm 198M/jus 17.8M, ~4mo), `thinking_data.{game}__user_profiles` (~4mo)

## Overview
- **Priority:** P1 — feeds member360 + churn-gap signals.
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Author game-scoped identity/behavior cubes: a `user_geo` cube from `mf_ip2location` (LIVE),
  a `behavior_profile` cube from `thinking_data.{game}__user_profiles` (lagging), and a `lifecycle_profile`
  cube from `vga.ingame_user_profile` (lagging). The 528M/198M `__events` table is exploration-only and
  modeled at event grain ONLY with mandatory pre-agg (phase 8) — NOT joined to mf_users at row grain.

## Key Insights
- `mf_ip2location` is LIVE — the only fresh identity source. Powers geo-stability (first_ip≠last_ip), multi-country,
  VPN/fraud flags. Tag `[freshness: live]`. Key: `(game, user_id)` — verify user_id == mf_users.user_id in phase 1.
- `vga.ingame_user_profile` is the lifecycle truth-store (register/first-last login/charge, last-active) but lags
  ~2mo (unresolved Q4: sync throttle vs broken pipeline). Tag `[freshness: lagging]`; use for historical churn-gap, NOT live alerting.
- `thinking_data.{game}__user_profiles` carries precomputed LTV/VIP/purchase_count at user grain — usable as a
  cube; key = `user_ingame_id` (`user_vga_id` often NULL — unresolved Q6). Tag `[freshness: lagging]`.
- `{game}__events` (58 cols, 100M+) fans out massively → DO NOT join at row grain; if exposed at all, separate
  event-grain cube with date-partition pruning + CubeStore pre-agg only (phase 8). Default: defer to exploration.

## Requirements
- Functional: per game, `user_geo` (live), `lifecycle_profile` (lagging), `behavior_profile` (lagging) cubes
  joined to mf_users via phase-1 keys. Geo-stability dim, churn-gap (days since last-active) dim.
- Non-functional: user-grain cubes 1:1 to mf_users; events cube (if any) never row-joined.

## Architecture
- Data flow: source → cube SQL (phase-1 bridge; vga social-form id and thinking_data ingame id need translation) →
  join mf_users many_to_one → geo-stability / churn-gap dims.
- Files in `cubes/{cfm,jus}/` → game-scoped. thinking_data tables ARE per-game named (`cfm__user_profiles`) —
  schema/name resolved via cube.js driver config under that game's securityContext, not hardcoded in YAML.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/user_geo.yml`, `.../jus/user_geo.yml`
- Create: `cube-dev/cube/model/cubes/cfm/lifecycle_profile.yml`, `.../jus/lifecycle_profile.yml`
- Create: `cube-dev/cube/model/cubes/cfm/behavior_profile.yml`, `.../jus/behavior_profile.yml`
- Read: `vga_user_master.yaml` (PII-exclusion list to mirror), `cube-dev/cube/model/cubes/cfm/user_ips.yml` (existing geo grain)

## Implementation Steps
1. Lift phase-1 keys for mf_ip2location, ingame_user_profile, thinking_data user_profiles (cfm, jus).
2. `user_geo.yml`: dims first_country/last_country/first_ip_geo/last_ip_geo (geo only — NO raw IP dim public),
   geo-stability dim (`first_country != last_country`), multi-country flag. `[freshness: live]`.
3. `lifecycle_profile.yml`: register/first-last login+charge timestamps, last-active; churn-gap dim
   (days since last active). `[freshness: lagging]` + caveat "≤ ~2mo stale, historical use".
4. `behavior_profile.yml`: precomputed LTV/VIP/purchase_count/last_purchase_time from thinking_data user_profiles.
   `[freshness: lagging]`. Note user_vga_id NULL rate from phase 1.
5. DEFER `{game}__events` cube — note as exploration follow-up requiring phase-8 pre-agg; do not author at row grain now.
6. Mirror vga PII-exclusion: NO display_name/phone/email/raw-IP dims (public). Compile + per-game /meta verify.

## Todo List
- [ ] user_geo.yml (cfm, jus) + geo-stability dim + freshness:live
- [ ] lifecycle_profile.yml (cfm, jus) + churn-gap dim + freshness:lagging caveat
- [ ] behavior_profile.yml (cfm, jus) + freshness:lagging
- [ ] PII-exclusion mirrored (no raw IP/phone/email public dims)
- [ ] Events cube DEFERRED + documented as exploration follow-up
- [ ] Compile + per-game /meta verification

## Success Criteria
- 3 user-grain identity cubes compile per game, browsable, 1:1 to mf_users at the proven match-rate.
- Geo cube tagged live; vga + thinking_data cubes tagged lagging with staleness caveat.
- No raw PII dim is public.

## Risk Assessment
- **vga 2mo staleness used for live decisions** (Med×High): churn-gap from stale source misleads. Mitigate:
  freshness tag + UI guard (phase 7); prefer mf_ip2location/payer_daily for live signals.
- **thinking_data user_vga_id NULL** (Med×Med): join drops users. Mitigate: use user_ingame_id key per phase 1; document coverage.
- **events fan-out if someone row-joins later** (Low×High): Mitigate: explicit DEFER + phase-8-only note in plan.

## Security Considerations
- Geo at country/region grain only; NO raw IP public dim (PII). Mirror vga_user_master exclusion list.
- thinking_data carries device ids — keep `public: false`; do not export to UI.
