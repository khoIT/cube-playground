# jus_vn VIP-care Playbook Coverage Unlock — Result

**Date:** 2026-06-10 (GMT+7) · **Plan:** `plans/260610-0000-jus-vn-playbook-coverage-unlock/` · **Mode:** `/cook --auto`
**Outcome:** baseline **6/21 → 13/21 enabled** (9 available + 4 partial) on real anchored jus data. Mirrors cfm's expansion. No fabrication, no registry edit, no server/client code change, no prod push.

## What shipped
4 new Cube YAML marts in `cube-dev/cube/model/cubes/jus/` (local cube mounts `./cube-dev/cube`; `jus_vn`→`jus`). Registry untouched — each mart exposes a logical member named exactly as a playbook's `dataRequirements`, so the per-game `/meta` verdict flips with zero registry edits.

| Mart (new) | Source table | Unlocks |
|---|---|---|
| `user_recharge_rolling.yml` | `std_ingame_user_recharge_daily` | 03 spend-spike, 04 spend-drop |
| `user_active_rolling.yml` | `std_ingame_user_active_daily.total_online_time` | 15 session-drop |
| `user_gameplay_daily.yml` | `mf_users` (role-level + LTV) | 06 top-leaderboard, 09 #1 achievement |
| `etl_prop_flow.yml` | `etl_ingame_item_flow` | 07 rare-item, 11 collector (both partial) |

## Live sweep result (full jus_vn sweep, anchor 2026-06-08)
opened=18,968 · profilesRefreshed=9,500 · status=partial (normal — not every playbook is available)

| PB | Name | Verdict | Cohort | Source mart / note |
|----|------|---------|-------:|-------|
| 01 | First deposit | available | 387 | mf_users (baseline) |
| 02 | VIP tier | available | 12,080 | mf_users LTV tier (baseline; VIP cohort, not whole base) |
| 03 | Spend spike | **available (NEW)** | 1,324 | user_recharge_rolling.spike_ratio ≥ 3 |
| 04 | Spend drop | **available (NEW)** | 623 | user_recharge_rolling.qualified_drop_ratio < 0.3 (of 7,825 engaged spenders) |
| 06 | Top leaderboard | **available (NEW)** | 10 | user_gameplay_daily.ladder_rank ≤ 10 |
| 09 | Major achievement | **available (NEW)** | 1 | user_gameplay_daily.ladder_rank == 1 |
| 14 | No login ≥ N days | available | 4,252 | mf_users.days_since_last_active (baseline) |
| 15 | Session-time drop | **available (NEW)** | 237 | user_active_rolling.qualified_session_ratio < 0.2 (of 24,850 heavy players) |
| 18 | Anniversary | available | 54 | mf_users.first_active_date (baseline) |
| 07 | Rare unlock | **partial (NEW)** | drill-down | etl_prop_flow.prop_id (raw event → no cohort) |
| 11 | Collector FOMO | **partial (NEW, incidental)** | drill-down | shares 07's `etl_prop_flow.prop_id` requirement |
| 19 | Pre-major-patch | partial | 0 | opsDriven — no ops_calendar data |
| 20 | New faction/server | partial | 0 | opsDriven — no ops_calendar data |
| 05,08,10,12,13,16,17,21 | — | unavailable | 0 | no jus source — fail-closed, no fabrication |

All available cohorts are non-empty and non-degenerate (no whole-base match). **Calibration was NOT needed** — the cfm-tuned qualification floors (₫500k spend, 30h session) produce sane jus cohorts as-is.

## Key decision: leaderboard metric (06/09)
Plan assumed ranking by fighting_power (战力). **Fighting power is 100% NULL in jus** — verified by direct Trino counts on `std_ingame_user_active_daily`, `mf_users`, and `mf_ingame_roles` (0 of 1.69M role rows populated). vip_level also empty. role_level is populated (866k) but 129,602 users tie at cap (lvl 69).

Surfaced to user; user chose **role_level + LTV tiebreak**. `user_gameplay_daily.ladder_rank = RANK() OVER (ORDER BY ingame_max_active_role_level DESC, ingame_total_recharge_value_vnd DESC)`. Result: top-of-board = level-cap players ordered by lifetime spend (₫3.93B → …), rank<=10 returns exactly 10, rank==1 exactly 1. Honest semantic: jus's leaderboard is "most-progressed, highest-value players", documented in the mart header. Cross-game member `ladder_rank` reused (cfm = PvP score, jus = progression+LTV).

## Cross-game safety (verified)
- cfm coverage unchanged: cfm still 12 available + 5 partial; cfm 07/11 still partial.
- jus 07/11-as-partial (no cohort row in aggregate) is **identical to cfm** — confirmed by comparing both `/api/care/cases/aggregate` responses. The 07/11 cohort-sweep error (`etl_prop_flow` requires a ≤31-day `log_date` bound) is the intended behavior-cube guard; partials are drill-down, not cohort sweeps — expected, not a regression.
- `user_gameplay_daily.yml` deliberately omits clan/guild/rank-drop members → 08/10/17 correctly stay unavailable (no false flip).

## Validation
- 59/59 care server tests pass (no server code changed — config-only).
- Live `/meta`, `/load`, full sweep, `/api/care/cases/aggregate`, `/api/care/data-freshness` all confirmed for jus_vn.
- Per-game as-of date surfaces: jus = 2026-06-08 (etl_prop_flow = 2026-06-09). Demo reads "real data, slightly lagged".
- Restarted `cube_api` + `cube-refresh-worker` (DEV_MODE=false = no hot-reload).

## Deferred / out of scope (no clean jus source — stay unavailable, no fabrication)
- 05 payment-fail, 13 sentiment, 16 support-ticket, 21 birthday — hard-blocked everywhere.
- 10/17 guild, 12 gacha — no jus table.
- 08 rank-drop (power near-monotonic, no per-match drop), 11 cohort (needs item-set enum — only partial drill-down via 07's source).

## Unresolved questions
1. **07/11 sweep error noise.** Cohort-sweep is attempted for the partial playbooks 07/11 and 500s on the date-bound guard (benign — partials are drill-down). Same on cfm. Worth a future guard to skip cohort-sweeping `partial` playbooks so the log stays clean — out of scope here (would touch server code).
2. **02 cohort size (12,080).** VIP-tier is large but is the VIP cohort by LTV tier (baseline behavior, not whole 866k base). Confirm the tier threshold is intended for jus scale, or calibrate later.
3. **role_level + LTV leaderboard** ranks the all-time progressed base (866k), not just anchor-day-active users. Top-10 are stable elite whales; a churned whale could rank top. Acceptable for "elite leaderboard"; revisit if CS wants active-only.
4. **fighting_power** may be populated upstream later — if so, revisit 06/09 to rank by 战力 as originally intended.
