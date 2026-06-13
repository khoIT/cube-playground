# Phase 03 — Identity + Behavior Cubes (member-360 spine)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Source report: `plans/reports/Explore-260614-1340-iceberg-identity-behavior-schema-map-report.md`
- Big-cube guard: `cube-dev/cube/cube.js:91-120` (`BEHAVIOR_VIEWS` + `TIME_DIM_FIELDS`)
- Source tables (iceberg): `gds_da.etl_user_profile` ((game_id,user_id), 3.25M, daily LIVE),
  `vga.std_all_game_user_profile` ((game_id,user_id), 400.6M, daily), `vnggames.std_user_profile` (1.17M, alt),
  `gds_da.etl_sdk_login` (login event, 285M — DEFERRED, PII heavy)

## Overview
- **Priority:** P1 — feeds member360 + churn-gap signals. Lands AFTER the MVP monetization layer (incremental).
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Author game-scoped identity cubes keyed on `(game_id, user_id)` directly (NO vga_id routing):
  a `user_geo`/profile cube from `gds_da.etl_user_profile` (LIVE — install/register/active/charge timestamps,
  media_source, country), and a `lifecycle_profile` cube from `vga.std_all_game_user_profile` (login channels,
  in-game purchase, churn signals). The 285M `gds_da.etl_sdk_login` event table is DEFERRED (no Phase-7 consumer;
  PII heavy) — modeled at event grain ONLY if/when a consumer is named, with mandatory pre-agg + big-cube guard.

## Key Insights
- **Avoid the vga_id graph** (report findings 1–3): `vga.latest_vga_user.id` is a DIFFERENT M:N namespace, not the
  game user_id. Use the DIRECT game-scoped `(game_id, user_id)` snowflake tables. Join on `(game_id constant + user_id)`
  to mf_users.
- **`gds_da.etl_user_profile` is LIVE (daily)** — install_time, register_time, first/last_active, first/last_charge,
  media_source, campaign_id at (game_id, user_id) grain. Tag `[freshness: live]`. Powers churn-gap (days since
  last_active) + lifecycle dims. Carries `device_id`/`appsflyer_id` → keep `public:false`.
- **`vga.std_all_game_user_profile`** (400.6M across all games) — login channels, in-game purchase, churn signals at
  (game_id, user_id). Filter to the game's game_id. Daily batch. Tag `[freshness: lagging]` only if phase-1 shows a
  staleness gap; otherwise `[freshness: live]` per the report's "Batch daily ~24h" classification — phase-1 max-date
  decides the tag (do NOT assume lagging).
- **`gds_da.etl_sdk_login` (285M) is the geo/device event source but PII-HEAVY** (IP, device_id, idfa, idfv,
  android_id — all `public:false`) and fans out massively → DEFER. If ever authored: separate event-grain cube +
  date-partition prune (`ds`) + CubeStore pre-agg (phase 8) + MUST be added to `cube.js` `BEHAVIOR_VIEWS` and its time
  dim to `TIME_DIM_FIELDS` (cube.js:91-120) or it escapes the unbounded-query 4xx guard.

## Requirements
- Functional: per game, `user_geo` (profile/geo/lifecycle from etl_user_profile, LIVE) and `lifecycle_profile`
  (vga profile) cubes joined to mf_users on `(game_id, user_id)`. Geo dim (first/last country), churn-gap
  (days since last_active) dim.
- Non-functional: user-grain cubes 1:1 to mf_users at the proven match-rate; events table NEVER row-joined.

## Architecture
- Data flow: `iceberg.gds_da.etl_user_profile` / `iceberg.vga.std_all_game_user_profile` → cube `sql:` (filter
  `game_id = <game>`) → join mf_users many_to_one on user_id → geo/churn-gap dims.
- **Game-scope is the `game_id` filter** in the cube SQL, NOT folder placement (red-team #1). The 3-part iceberg ref
  is cross-catalog (proven). Identity report flags PII columns to set `public:false`.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/user_geo.yml`, `.../jus/user_geo.yml`
- Create: `cube-dev/cube/model/cubes/cfm/lifecycle_profile.yml`, `.../jus/lifecycle_profile.yml`
- Read: identity schema-map report (PII-exclusion list); `cube-dev/cube/model/cubes/cfm/user_ips.yml` (existing geo grain)
- DEFERRED (do NOT create now): `*/behavior_events.yml` from etl_sdk_login

## Implementation Steps
1. Lift phase-1 keys + game_id values + match-rates for etl_user_profile and std_all_game_user_profile (cfm, jus).
2. `user_geo.yml`: cube `sql:` filters `game_id = <game>`; dims first/last country (geo only — NO raw IP public),
   geo-stability dim (`first_country != last_country`); lifecycle timestamps + churn-gap (days since last_active).
   Tag per phase-1 max-date (likely `[freshness: live]`). `device_id`/`appsflyer_id` → `public:false`.
3. `lifecycle_profile.yml`: from std_all_game_user_profile — login channels, in-game purchase flags, churn signals;
   filter game_id. Tag per phase-1 max-date. PII cols `public:false`.
4. DEFER the etl_sdk_login events cube — note as exploration follow-up: requires phase-8 pre-agg + cube.js big-cube
   guard registration + a named Phase-7 consumer. Do NOT author at row grain now.
5. Mirror the report's PII-exclusion: NO display_name/phone/email/raw-IP/device dims public. Compile (isolated) +
   per-game /meta verify; confirm only the active game's rows return.

## Todo List
- [ ] user_geo.yml (cfm, jus) + geo-stability + churn-gap dims; freshness tag per phase-1 max-date
- [ ] lifecycle_profile.yml (cfm, jus) from std_all_game_user_profile; PII public:false
- [ ] PII-exclusion mirrored (no raw IP/device/phone/email public dims)
- [ ] etl_sdk_login events cube DEFERRED + documented (needs consumer + guard + pre-agg)
- [ ] Game-isolation (game_id filter) verified at runtime
- [ ] Compile (isolated) + per-game /meta verification

## Success Criteria
- 2 user-grain identity cubes compile per game, browsable, 1:1 to mf_users at the proven match-rate, game-isolated.
- Freshness tag matches the phase-1 max-date evidence (not assumed).
- No raw PII dim is public; events cube explicitly deferred.

## Risk Assessment
- **Routing through vga_id by mistake** (Med×High): M:N namespace fans out / drops users. Mitigate: use direct
  (game_id, user_id) tables only; phase-1 proves the key.
- **etl_sdk_login row-joined later** (Med×High): 285M scan blowup + escapes the guard. Mitigate: explicit DEFER +
  mandatory cube.js big-cube guard registration if ever authored (red-team #6).
- **Assumed-lagging tag wrong** (Low×Med): mislabels a live source. Mitigate: tag from phase-1 max-date evidence.

## Security Considerations
- Geo at country/region grain only; NO raw IP public dim (PII). Mirror the identity report exclusion list.
- etl_user_profile / etl_sdk_login carry device_id/idfa/IP → keep `public:false`; never export to UI.
