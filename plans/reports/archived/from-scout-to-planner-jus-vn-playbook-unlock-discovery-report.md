# jus_vn Playbook-Unlock Discovery — live Trino + registry gap map

**Date:** 2026-06-10 (GMT+7) · **Method:** live `game_integration.jus_vn` Trino introspection (`cube-dev/examples/trino_introspect.py`, creds from running `cube-api-dev`) + registry/YAML cross-ref. Mirrors the cfm_vn coverage-expansion approach (plan `260609-1515`).

## TL;DR
- jus_vn is a **wuxia/social MMO** (garden-farm, NPC tour, fighting-power, role-class), **NOT an FPS**. No ladder / clan / lottery / room-match tables exist.
- jus cube dir has **10 cubes** vs cfm's 28 — missing every rolling/gameplay mart.
- **Baseline today ≈ 6/21**: 01,02,14,18 available (mf_users members present) + 19,20 partial (ops).
- **Realistic ceiling ≈ 11–12/21** with honest mapping. Comparable to cfm's 12.

## jus_vn Trino inventory (game_integration.jus_vn)
- **Master/identity:** `mf_users`, `mf_ingame_roles` (role_id↔user_id, LTV `ingame_total_recharge_value_vnd`, `fighting_power`, `role_level`, `vip_level`), `mf_ingame_devices/ips`, `map_ingame_*`.
- **Recharge:** `std_ingame_user_recharge_daily` (per-user daily, `log_date` + `ingame_total_recharge_value_vnd`), `std_ingame_role_recharge_daily`, `cons_game_user_recharge_daily`, `etl_ingame_recharge`.
- **Active/session:** `std_ingame_user_active_daily` (per-user daily, `log_date` + `total_online_time` + `fighting_power`), `etl_ingame_login/logout`, `cons_game_user_active_daily`.
- **jus-native gameplay (NOT FPS):** `etl_ingame_item_flow` (item_id/reason/place), `etl_ingame_garden_farm_crop_harvest`, `etl_ingame_npc_im_tour`, `etl_ingame_money_flow`, `etl_ingame_ccu`.
- **Absent (vs cfm):** no ladder/leaderboard table, **no guild/clan table**, no lottery/gacha table, no room/match table.

## Per-playbook gap map (21 total)
| # | Playbook | Requirement | jus verdict | Unlock path |
|---|----------|-------------|-------------|-------------|
| 01 | First deposit | `mf_users.first_recharge_date` | ✅ **available now** | none (member present) |
| 02 | VIP tier | `mf_users.ltv_total_vnd` | ✅ **available now** | none |
| 03 | Spend spike | `user_recharge_rolling.spike_ratio` | 🟢 buildable | new jus `user_recharge_rolling` mart over `std_ingame_user_recharge_daily` |
| 04 | Spend drop | `user_recharge_rolling.qualified_drop_ratio` | 🟢 buildable | same mart |
| 05 | Payment failure | `payment_txn.failed_count` | ⛔ blocked | none anywhere |
| 06 | Top leaderboard | `user_gameplay_daily.ladder_rank` | 🟡 honest map | new jus `user_gameplay_daily` ranking by **fighting_power** (战力 = MMO leaderboard) |
| 07 | Rare unlock | `etl_prop_flow.prop_id` | 🟡 partial (optional) | map to `etl_ingame_item_flow` (per-member raw, like cfm) |
| 08 | Rank drop | `user_gameplay_daily.ladder_rank_drop_48h` | 🔴 defer | power is near-monotonic; no per-match drop signal |
| 09 | Major achievement | `user_gameplay_daily.ladder_rank` (=1) | 🟡 honest map | same mart as 06 (top-1 by power) |
| 10 | Guild instability | `user_gameplay_daily.clan_switched_recent` | ⛔ no source | **no guild/clan table in jus** |
| 11 | Collector FOMO | `user_gameplay_daily.limited_set_owned_count` | 🔴 defer | needs item-set enum (cfm deferred too) |
| 12 | Gacha bad-luck | `etl_lottery_shoot.draws_since_ssr` | ⛔ no source | **no lottery table in jus** |
| 13 | Negative sentiment | `chat_sentiment.score` | ⛔ blocked | none anywhere |
| 14 | No login ≥N days | `mf_users.days_since_last_active` | ✅ **available now** | none |
| 15 | Session-time drop | `user_active_rolling.qualified_session_ratio` | 🟢 buildable | new jus `user_active_rolling` over `std_ingame_user_active_daily.total_online_time` |
| 16 | Negative ticket | `support_ticket.sentiment` | ⛔ blocked | none anywhere |
| 17 | Leave/disband guild | `user_gameplay_daily.clan_left_recent` | ⛔ no source | **no guild/clan table** |
| 18 | Anniversary | `mf_users.first_active_date` | ✅ **available now** | none |
| 19 | Pre-major-patch | (ops calendar) | 🟡 partial (ops) | opsDriven — already partial |
| 20 | New faction/server | (ops event) | 🟡 partial (ops) | opsDriven — already partial |
| 21 | Birthday | `mf_users.birth_date` | ⛔ blocked | demographics not modeled |

## Proposed phasing (high-value first)
1. **Verify baseline live** — restart-free `/meta` probe confirms 01/02/14/18 available + 19/20 partial for jus. Fix any member-name mismatch in registry (fails closed today).
2. **Recharge rolling mart** (jus `user_recharge_rolling`) → unlocks **03, 04**. Direct port of cfm mart (grain = per-user as-of data-anchor, trailing 1/7/30d CASE-window SUMs). Source `std_ingame_user_recharge_daily`.
3. **Active rolling mart** (jus `user_active_rolling`) → unlocks **15**. Source `std_ingame_user_active_daily.total_online_time`.
4. **Power-leaderboard gameplay mart** (jus `user_gameplay_daily` exposing `ladder_rank` = RANK by fighting_power) → unlocks **06, 09**. Honest semantic: fighting-power ranking is the MMO leaderboard. Document the cross-game member reuse.
5. **(Optional) Rare-item partial** — map 07 to `etl_ingame_item_flow` (per-member only, partial). Defer 08/11.
6. **Calibrate + validate + coverage surface** — per-playbook live cohort, calibrate thresholds from jus distributions, confirm CS dashboard shows non-empty plausible cohorts. Restart `cube-api` + `cube-refresh-worker` (DEV_MODE=false = no hot-reload).

## Honest-mapping decisions (per user: investigate then map, no fabrication)
- **06/09 ladder_rank → fighting_power rank**: legitimate (战力 leaderboard). Keep registry member name `ladder_rank`; jus YAML defines it over power. Documented as cross-game logical member.
- **10/17 guild, 12 gacha**: **stay unavailable** — no jus source. Do not fabricate.
- **08 rank-drop, 11 set-completion**: defer — signal not cleanly derivable.

## Anchor / mechanics carry-over from cfm (reuse, don't rediscover)
- Per-game **data as-of anchor** (relative windows resolve from MAX log-date-with-data, not now()). Already built (Phase-01 of cfm plan).
- Marts must land in **`cube-dev/cube/model/cubes/jus/`** (local cube mounts `./cube-dev`; resolves `jus_vn`→`jus`). `../cube-api` tree is NOT served locally.
- `user_id` must be `public: true` in marts (PK, cohort fetcher selects it).
- Partition-prune via scalar subquery (not CROSS-JOIN-derived bound) to keep cold queries < 15s client timeout.

## Open questions
1. **06/09 honest map** — confirm fighting-power ranking is an acceptable stand-in for "leaderboard" for the jus demo (vs leaving 06/09 unavailable). Recommended: yes.
2. **07 rare-item partial** — include this round, or defer with 08/11? (cfm left prop playbooks partial.)
3. **Scope of marts** — jus-only (matches "cfm_vn-only" cfm decision) vs generalize. Assumed jus-only.
