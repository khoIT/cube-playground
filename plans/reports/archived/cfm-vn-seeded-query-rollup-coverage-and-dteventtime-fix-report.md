# cfm_vn Seeded-Query Rollup Coverage + dteventtime Pre-Agg Fix

Date: 2026-06-09 (GMT+7) · Scope: cfm_vn · Author: session work

## Goal
Find all seeded cfm_vn questions, derive the Cube queries they run, compare against
existing rollups, decide which rollups to add, and prove the fix via the manual
trigger script (`cube-dev/scripts/trigger-preagg-build.sh`).

## Sources
- Starter questions: `chat-service/seed/starter-questions-seed.json` → `games.cfm_vn` = **18**.
- Executed queries: `chat-service/runtime/seed/chat-snapshot.json` → `chat_turns[].artifacts_json[].query`
  for sessions where `game_id=cfm_vn` = **122 queries** (118 tagged `source:raw`).

## Coverage verdict (122 queries vs the 6 existing cfm rollups)
| Bucket | Count | Meaning |
|---|---|---|
| FITS existing rollup | 29 | members + log_date time-dim already match |
| **MISS — time-dim only** | **38** | measures+dims match; query bounds on `dteventtime`, rollup keyed on `log_date` |
| MISS — member (active_daily) | ~26 | needs `os_platform` / `is_recharge_day` / `country_code` + WAU/MAU |
| No rollup yet | ~22 | `etl_newbie_detail`(8), `mf_users`(4), `user_active_monthly`(2), `user_recharge_daily`(2) + singles |

### Root cause of the dominant gap
Every event-cube rollup is keyed on `time_dimension: log_date`, but the UI/agent bound
their time filter on `dteventtime` (the natural event timestamp). Cube only routes to a
pre-agg that is a superset of the query's members **including the exact time dimension** —
so the log_date rollups never matched the dteventtime queries and they fell through to a
full Trino source scan. Affects etl_login(12), etl_game_detail(12), etl_lottery_shoot(7),
etl_money_flow(5), etl_newbie_tutorial(2) = **38 queries**, fixable with one pattern.

## Proof (etl_login demo)
Added `login_activity_ts_batch` (same measures/dims as `login_activity_batch`, keyed on
`dteventtime`), trigger-built it, reloaded the serving model. Compiled SQL for the
canonical "login peak by hour×weekday" query:

```
BEFORE:  dteventtime → FROM etl_ingame_login                                   (RAW Trino)
AFTER:   dteventtime → FROM prod_pre_aggregations.etl_login_login_activity_ts_batch  (PRE-AGG)
         log_date    → FROM prod_pre_aggregations.etl_login_login_activity_batch      (unchanged)
```
Latency (admin session, renewQuery): pre-agg path **~0–1s** vs raw path **~5s**. Built with
no tz "future-seal" error — the `LEAST(MAX(dteventtime), current_timestamp)` build_range cap
prevents the open partition sealing a future end.

Note: `usedPreAggregations` reads empty in the JSON response because the `rollup_lambda`
unions live source — compiled SQL (`/cube-api/v1/sql`) is the reliable routing signal here.

## Rollups added this round (keep-both pattern)
1. **dteventtime sibling rollups** on the 5 event cubes (`*_ts_batch` + `*_ts` lambda),
   mirroring each cube's existing log_date rollup: etl_login, etl_game_detail,
   etl_lottery_shoot, etl_money_flow, etl_newbie_tutorial. +38 queries.
2. **`active_daily` second rollup** keyed on log_date/day with dims
   `{os_platform, is_recharge_day, country_code}` and additive measures
   `{dau, paying_dau, total_online_time_sec}`. +~17 queries.

## Trigger script fixes (`trigger-preagg-build.sh`)
- `--timer` flag (default 30s): the worker's 300s default never fires a sweep inside a
  short window (was reporting build-attempts=0 falsely).
- Outcome parser rewritten for real table names `<cube>_<rollup>_batch<YYYYMM>_<hash>`.
- Recreate at `CUBEJS_LOG_LEVEL=trace`: the `CREATE TABLE prod_pre_aggregations.…` lines
  the detector greps for are only emitted at trace; at info the build is invisible.

## Unresolved questions
- **`etl_newbie_detail` rollup deferred**: its demanded measures are `avg_*` and
  `distinct_players` — non-additive. A naive day-grain rollup returns wrong averages when a
  query aggregates across days. Needs measure remodeling (store sum+count, or
  count_distinct_approx) before a correct rollup can be added.
- **WAU/MAU/trailing measures** (active_daily) are rolling-window / non-additive — cannot
  live in a daily rollup; left raw (small result sets, not the latency pain).
- **Local-Trino data sparsity**: cfm_vn returned 0 rows for several probed date windows even
  as admin — raw scans confirm the data isn't in those ranges locally. Independent of
  pre-aggs; browser queries hit ranges that do have data.
- **Single-vs-double cost**: keep-both doubles build cost per event cube. etl_login demand
  is 100% dteventtime / 0% log_date, so switching (drop log_date) would halve its cost —
  kept both per user decision.
