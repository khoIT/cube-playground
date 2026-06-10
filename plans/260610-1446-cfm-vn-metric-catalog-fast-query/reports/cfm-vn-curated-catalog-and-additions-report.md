# CFM VN — Curated Catalog & Width Proposals

**Generated:** 2026-06-10 16:20 GMT+7  
**Scope:** Disposition of 57 presets + 12 new-metric proposals  
**Prior audit:** cfm-vn-metric-availability-matrix-report.md (20/57 working, 36 broken-ref, 1 stub)

---

## DECISIONS FOR USER

Short list of choices that only the user can make. All other dispositions are mechanical and recommended below.

1. **Repoint `revenue` → `revenue_vnd_real`?**  
   Current formula: `recharge.revenue_vnd` (iamount, 15× inflated by test traffic).  
   Safer: `recharge.revenue_vnd_real` (bridged, 710M VND on 2026-06-01).  
   Best: `user_recharge_daily.revenue_vnd_total` (same 710M, pre-agg, faster).  
   **Impact:** anomaly-detector (`anomaly-config.ts`) and liveops KPI board already use `user_recharge_daily.revenue_vnd_total` — they are NOT affected. The *metric preset catalog* (`revenue.yml`) still points at inflated `recharge.revenue_vnd`; the Catalog page and any chat-agent query that uses the `revenue` preset will return inflated values. Recommend repoint to `user_recharge_daily.revenue_vnd_total`.  
   → **Y / N / use revenue_vnd_real instead?**

2. **Recover 20 "game_key_metrics-recoverable" broken metrics (repoint from mf_users → game_key_metrics)?**  
   `game_key_metrics` (source: `cons_game_key_metrics_daily`) is in cfm_vn `/meta` with all required columns. Repointing changes the time grain for these metrics from "lifetime-user" to "acquisition-slice daily mart" — semantically correct for NRU, installs, cost, NPU, NNPU, rev_NPU, ROAS, CPI, CTR, CTI, clicks, impressions. The acquisition-slice split (media_source + campaign + platform) also provides richer breakdown.  
   **Trade-off:** acquisition-slice rows can be summed across slices to get totals, but an analyst must know to aggregate correctly (the pre-agg `key_metrics_by_source_daily` does this). Formula refs in presets (e.g. `nru.yml`: `mf_users.new_users`) need to be updated to `game_key_metrics.nru`.  
   → **Y (repoint) / N (leave broken) / partial (which metrics)?**

3. **Wire paying-retention (`rp`) via `new_user_retention.rpnpu_d7`?**  
   Preset currently references `mf_users.paying_retained_d7` + `mf_users.new_paying_users` (both absent). `new_user_retention` cube (source: `cons_game_new_user_retention_daily`) has `rpnpu_d7` (paying-retained at D7) and `npu` (base). Semantically equivalent. Pre-agg built.  
   → **Y / N?**

4. **Add the 12 new event-cube metrics (width proposals)?**  
   These expand coverage into economy, onboarding, and gacha domains — none exist in current catalog. All backed by verified columns in cubes that are already in `/meta`.  
   → **Y (all) / Y (pick subset) / N?**

5. **Drop all 4 funnel metrics + ACU/PCU/LCU + *_roles cluster permanently?**  
   - Funnel (4): no `funnel` cube; building one requires ETL work outside Cube YAML scope.  
   - ACU/PCU/LCU: no concurrency-snapshot pipeline for cfm_vn (confirmed: mf_users has no such columns and no concurrency source table exists in cfm schema).  
   - `*_roles` (active_role, paying_role, new_role, new_paying_role): `user_roles` cube has `distinct_roles` + `paying_roles` segment, but no day-grain additive count for *new* roles. Recoverable only as static totals, not time-series. Recommend drop from time-series catalog; keep `user_roles` available for member-360 queries.  
   → **Confirm drop / keep as "blocked" stubs?**

6. **LTV metrics: repoint from `mf_users.new_users` (absent) to `game_key_metrics.nru`?**  
   `ltv` = `revenue / new_users` (lifetime cumulation — semantically ambiguous when denominator is daily NRU). The metric may need a redesign if true LTV (NPV of cohort) is wanted. Recommend repoint + add a label clarification, or demote to draft.  
   → **Repoint + relabel / demote to draft / drop?**

---

## 1. Keep List (20 working)

| Metric ID | Cube | Status | Flag |
|---|---|---|---|
| dau | active_daily | keep | — |
| wau | active_daily | keep | — |
| mau | active_daily | keep | — |
| trailing_wau | active_daily | keep | — |
| trailing_mau | active_daily | keep | — |
| revenue | recharge | keep — **REPOINT NEEDED** | Formula → `recharge.revenue_vnd` inflated 15×; repoint to `user_recharge_daily.revenue_vnd_total` (see Decision 1) |
| transactions | recharge | keep | — |
| paying_users | recharge | keep | — |
| arppu | recharge | keep | — |
| gross_bookings | recharge | keep — **DEDUP NOTE** | exact duplicate of `revenue` (same formula: `recharge.revenue_vnd`); see Dedup table §3 |
| arpu | mf_users | keep | — |
| paying_users_30d | mf_users | keep | — |
| paying_rate_30d | mf_users | keep | — |
| paying_rate | mf_users | keep | — |
| rr01 | retention | keep | — |
| rr07 | retention | keep | — |
| rr30 | retention | keep | — |
| rr | retention | keep | — |
| trailing_mpu | user_recharge_daily | keep | — |
| trailing_wpu | user_recharge_daily | keep | — |
| arpdau | recharge + active_daily | keep — **STUB** | cross-cube join times out >15s; keep as draft/stub until pre-agg built |

---

## 2. Broken-Cluster Disposition Table

**Classification legend:**
- `drop` — no source data for cfm_vn; would require upstream ETL pipeline work
- `recoverable via game_key_metrics` — column exists in `cons_game_key_metrics_daily`, cube in meta, pre-agg built
- `recoverable via new_user_retention` — column in `cons_game_new_user_retention_daily`, cube in meta, pre-agg built
- `recoverable by wiring mf_users column` — column may exist in mf_users source table; requires YAML edit only
- `drop (no concurrency pipeline)` — cfm_vn has no upstream concurrency-snapshot table
- `drop (no funnel cube)` — requires new ETL + cube build

### 2A. Acquisition & Marketing cluster (12 metrics)

| Metric ID | Current broken ref | Disposition | Recoverable column / cube |
|---|---|---|---|
| nru | `mf_users.new_users` | **recoverable via game_key_metrics** | `game_key_metrics.nru` (col: `nru` in `cons_game_key_metrics_daily`) |
| installs | `mf_users.installs` | **recoverable via game_key_metrics** | `game_key_metrics.installs` (col: `installs`) |
| organic_installs | `mf_users.organic_installs` | **recoverable via game_key_metrics** | `game_key_metrics.installs` filtered `is_paid_install='0'` — no direct measure; needs new measure or segment in game_key_metrics YAML |
| paid_installs | `mf_users.paid_installs` | **recoverable via game_key_metrics** | `game_key_metrics.installs` filtered `is_paid_install='1'` — needs measure |
| cost | `mf_users.marketing_cost` | **recoverable via marketing_cost cube** | `marketing_cost.cost_vnd` (col: `cost_vnd`) or `game_key_metrics.cost_vnd` |
| cpi | `mf_users.marketing_cost` + `mf_users.installs` | **recoverable via game_key_metrics** | `game_key_metrics.cpi_vnd` already exists as derived measure |
| clicks | `mf_users.clicks` | **recoverable via marketing_cost cube** | `marketing_cost.clicks` (col: `click`) or `game_key_metrics.clicks` |
| impressions | `mf_users.impressions` | **recoverable via marketing_cost cube** | `marketing_cost.impressions` (col: `impression`) or `game_key_metrics.impressions` |
| ctr | `mf_users.clicks + impressions` | **recoverable via game_key_metrics** | `game_key_metrics.ctr` already derived |
| cti | `mf_users.installs + clicks` | **recoverable via game_key_metrics** | formula: `game_key_metrics.installs / game_key_metrics.clicks`; needs new derived measure |
| cpn | `mf_users.new_users + marketing_cost` | **recoverable via game_key_metrics** | formula: `game_key_metrics.cost_vnd / game_key_metrics.nru`; needs derived measure |
| nru_install_rate | `mf_users.new_users + installs` | **recoverable via game_key_metrics** | formula: `game_key_metrics.nru / game_key_metrics.installs`; needs derived measure |

### 2B. Revenue × New-User cluster (7 metrics)

| Metric ID | Current broken ref | Disposition | Recoverable column / cube |
|---|---|---|---|
| npu | `mf_users.new_paying_users` | **recoverable via game_key_metrics** | `game_key_metrics.npu` (col: `npu`) |
| nnpu | `mf_users.new_register_and_paying_users` | **recoverable via game_key_metrics** | `game_key_metrics.nnpu` (col: `nnpu`) |
| rev_npu | `mf_users.rev_new_paying_users` | **recoverable via game_key_metrics** | `game_key_metrics.rev / game_key_metrics.npu`; needs derived measure (`rev_per_npu`) |
| arpnpu | same | **recoverable via game_key_metrics** | same as rev_npu |
| rev_nnpu | `mf_users.rev_new_register_and_paying_users` | **recoverable via game_key_metrics** | `game_key_metrics.rev / game_key_metrics.nnpu`; needs derived measure |
| arpnnpu | same | **recoverable via game_key_metrics** | same as rev_nnpu |
| ltv / ltv_30 | `mf_users.new_users` (denominator) | **recoverable via game_key_metrics** (with semantics caveat) | `game_key_metrics.nru` as denominator; numerator should be `game_key_metrics.rev` (daily cohort). See Decision 6. |

### 2C. ROAS cluster (2 metrics)

| Metric ID | Current broken ref | Disposition | Recoverable column / cube |
|---|---|---|---|
| roas | `mf_users.rev_per_install_d7 + marketing_cost` | **recoverable via game_key_metrics** | `game_key_metrics.roas` already exists as `rev / cost_vnd` |
| roas_07 | same | **recoverable via game_key_metrics** | `game_key_metrics.roas` (game_key_metrics does not distinguish D0 vs D7 ROAS — it is "period ROAS"; may need label correction) |
| mkt_rev_ratio | `mf_users.marketing_cost` | **recoverable via game_key_metrics** | formula: `game_key_metrics.cost_vnd / game_key_metrics.rev`; needs derived measure |

### 2D. Paying-retention (1 metric)

| Metric ID | Current broken ref | Disposition | Recoverable column / cube |
|---|---|---|---|
| rp | `mf_users.paying_retained_d7` + `mf_users.new_paying_users` | **recoverable via new_user_retention** | `new_user_retention.rpnpu_d7 / new_user_retention.npu`; pre-agg built; see Decision 3 |

### 2E. Concurrency cluster (4 metrics)

| Metric ID | Current broken ref | Disposition | Evidence |
|---|---|---|---|
| acu | `mf_users.acu` | **drop (no concurrency pipeline)** | mf_users source table has no ACU column; no `std_` or `cons_` concurrency table found in cfm schema. Needs data-platform work. |
| ccu | `mf_users.ccu` | **drop (no concurrency pipeline)** | same |
| pcu | `mf_users.pcu` | **drop (no concurrency pipeline)** | same |
| lcu | `mf_users.lcu` | **drop (no concurrency pipeline)** | same |

### 2F. Role metrics cluster (4 metrics)

| Metric ID | Current broken ref | Disposition | Evidence |
|---|---|---|---|
| paying_role | `mf_users.paying_roles` | **drop (no day-grain time-series)** | `user_roles` cube has `distinct_roles` + `paying_roles` segment but no time dimension. Lifetime total only — not a time-series metric. |
| new_paying_role | `mf_users.new_paying_roles` | **drop** | no "new role" event source wired to day grain |
| new_role | `mf_users.new_roles` | **drop** | same; `user_roles.first_active_date` exists but not materialized as daily count |
| active_role | `mf_users.active_roles` | **drop** | `user_roles` has `distinct_roles` (lifetime) but no active-day series |

### 2G. Funnel cluster (4 metrics)

| Metric ID | Current broken ref | Disposition | Evidence |
|---|---|---|---|
| cvr_cdn_download | funnel cube absent | **drop** | no `funnel` cube in cfm_vn; `ordered_event_funnel` has incompatible schema (step_count only) |
| cvr_install | same | **drop** | same |
| cvr_login_form | same | **drop** | same |
| cvr_register | same | **drop** | same |

---

## 3. Dedup Table

Two or more preset IDs backed by the exact same formula ref.

| Concept | IDs | Current formula | Canonical pick | Action |
|---|---|---|---|---|
| Gross revenue (inflated) | `revenue`, `gross_bookings` | both → `recharge.revenue_vnd` | `revenue` (Tier 1, certified) | `gross_bookings` should repoint to a separate billing measure or be removed. Keep as draft if billing cube is planned. |
| ROAS (after recovery) | `roas`, `roas_07` | will both → `game_key_metrics.roas` | `roas` (keep, relabel as "period ROAS") | `roas_07` should be distinct if D7 cumulative ROAS is needed — requires a separate `roas_d7` measure in game_key_metrics. Otherwise drop `roas_07` or alias. |
| Active Users (after recovery) | `nru` (via gkm) and existing DAU | different cubes, different grains | no dedup needed | — |

---

## 4. Width Proposals — 12 New Metrics

All proposals use cubes verified in cfm_vn `/meta`. All measures are additive (sum/count/count_distinct). Day dimension is `log_date` unless noted.

### Domain: Economy (from etl_money_flow)

| # | ID | Label | Formula | Source cube | Day dim | Dimension cuts | Column evidence |
|---|---|---|---|---|---|---|---|
| 1 | `diamond_spend_events` | Diamond spend events | `etl_money_flow.out_events` + segment `diamond_only` + segment `spends_only` | etl_money_flow | `log_date` | money_type, reason_base_label | `addorreduce='1'`, `imoneytype='1'` → `out_events` measure |
| 2 | `diamond_net_delta` | Diamond net flow | `etl_money_flow.total_delta` + segment `diamond_only` | etl_money_flow | `log_date` | money_type, reason_action_label | `delta` col → `total_delta` measure; net = in − out already |
| 3 | `economy_spenders` | Distinct economy spenders | `etl_money_flow.distinct_players` + segment `spends_only` | etl_money_flow | `log_date` | money_type | `playerid` → `distinct_players` (count_distinct_approx) |

### Domain: Gacha / Economy (from etl_lottery_shoot)

| # | ID | Label | Formula | Source cube | Day dim | Dimension cuts | Column evidence |
|---|---|---|---|---|---|---|---|
| 4 | `gacha_pulls` | Gacha pulls | `etl_lottery_shoot.pulls` | etl_lottery_shoot | `log_date` | lottery_box (gold/diamond/king), is_ten_pull | `count(*)` on etl_ingame_lotteryshoot → `pulls` |
| 5 | `gacha_diamond_cost` | Diamond spent on gacha | `etl_lottery_shoot.total_cost_diamond` | etl_lottery_shoot | `log_date` | lottery_box | `costdiamond` col → `total_cost_diamond` sum |
| 6 | `gacha_players` | Distinct gacha players | `etl_lottery_shoot.distinct_players` | etl_lottery_shoot | `log_date` | lottery_box | `playerid` → `distinct_players` |

### Domain: Onboarding (from etl_newbie_tutorial)

| # | ID | Label | Formula | Source cube | Day dim | Dimension cuts | Column evidence |
|---|---|---|---|---|---|---|---|
| 7 | `tutorial_completions` | Tutorial completions | `etl_newbie_tutorial.completed_count` | etl_newbie_tutorial | `log_date` | tutorial_id | `tutorialstatus='1'` → `completed_count` |
| 8 | `tutorial_completion_rate` | Tutorial completion rate | `etl_newbie_tutorial.completion_rate` | etl_newbie_tutorial | `log_date` | tutorial_id | `completed_count / started_count` → `completion_rate` |
| 9 | `tutorial_starters` | Tutorial starters (distinct players) | `etl_newbie_tutorial.distinct_players` | etl_newbie_tutorial | `log_date` | — | `distinct_players` (count_distinct_approx on playerid) |

### Domain: Gameplay / Engagement (from user_gameplay_daily + active_daily)

| # | ID | Label | Formula | Source cube | Day dim | Dimension cuts | Column evidence |
|---|---|---|---|---|---|---|---|
| 10 | `total_online_time_hrs` | Total online time (hours) | `active_daily.total_online_time_sec / 3600` | active_daily | `log_date` | country_code, os_platform | `total_online_time` col → `total_online_time_sec` sum |
| 11 | `avg_online_time_min_per_dau` | Avg session time per DAU (min) | `active_daily.total_online_time_sec * 1.0 / NULLIF(active_daily.dau, 0) / 60` | active_daily | `log_date` | — | derived from existing measures |

### Domain: Revenue Quality (from user_recharge_daily — already in meta)

| # | ID | Label | Formula | Source cube | Day dim | Dimension cuts | Column evidence |
|---|---|---|---|---|---|---|---|
| 12 | `iap_revenue` | IAP revenue (VND) | `recharge.iap_rev_vnd` (via `recharge` cube) — **or** add `iap_rev` to game_key_metrics | game_key_metrics | `report_date` | — | `iap_rev` col in `cons_game_key_metrics_daily` → `game_key_metrics.iap_rev` already in meta |

**Note on proposals 1–3:** `etl_money_flow` is 1.35B rows. The cube has a `money_flow_summary` rollup_lambda pre-agg; queries against `log_date` with `money_type` + `reason_*` dimensions will hit the pre-agg (confirmed in YAML: pre-agg includes `events`, `in_events`, `out_events`, `total_in`, `total_out`, `total_delta`, `distinct_players` with `money_type` + `reason_base_label` + `reason_action_label` dimensions). Without the pre-agg built, cold-Trino fallback will be slow or timeout. Ship after confirming the pre-agg is sealed.

**Note on proposals 4–6:** `etl_lottery_shoot` is 213M rows. No pre-agg exists in the YAML for daily grain — only raw table. Recommend adding a `lottery_summary_batch` rollup before shipping these metrics for real-time use.

---

## 5. Summary Scoreboard

| State | Count | IDs |
|---|---|---|
| Keep (working) | 20 | dau, wau, mau, trailing_wau, trailing_mau, revenue*, transactions, paying_users, arppu, gross_bookings*, arpu, paying_users_30d, paying_rate_30d, paying_rate, rr01, rr07, rr30, rr, trailing_mpu, trailing_wpu |
| Keep (stub — needs pre-agg) | 1 | arpdau |
| Recoverable via game_key_metrics (repoint) | 20 | nru, npu, nnpu, installs, paid_installs, organic_installs, cost, cpi, clicks, impressions, ctr, cti, cpn, nru_install_rate, rev_npu, arpnpu, rev_nnpu, arpnnpu, roas, roas_07, mkt_rev_ratio, ltv, ltv_30 |
| Recoverable via new_user_retention (repoint) | 1 | rp |
| Drop (no source data for cfm_vn) | 12 | acu, ccu, pcu, lcu, paying_role, new_paying_role, new_role, active_role, cvr_cdn_download, cvr_install, cvr_login_form, cvr_register |
| New width proposals | 12 | diamond_spend_events, diamond_net_delta, economy_spenders, gacha_pulls, gacha_diamond_cost, gacha_players, tutorial_completions, tutorial_completion_rate, tutorial_starters, total_online_time_hrs, avg_online_time_min_per_dau, iap_revenue |

*`revenue` needs repoint; `gross_bookings` is a dedup of `revenue`.

Post-recovery total (if all recoverable accepted): **41 working + 12 new = 53** metrics, dropping 12 structurally absent ones.

---

## 6. Revenue Blast Radius — Confirmed

Who consumes `recharge.revenue_vnd` (inflated, 15×)?

| Consumer | Measure used | Inflated? |
|---|---|---|
| `revenue.yml` preset formula | `recharge.revenue_vnd` | YES — catalog + chat agent |
| `gross_bookings.yml` preset formula | `recharge.revenue_vnd` | YES — catalog + chat agent |
| `arpdau.yml` preset formula | `recharge.revenue_vnd` (numerator) | YES — but also times out |
| `arppu.yml` preset formula | `recharge.revenue_vnd` + `recharge.paying_users` | YES |
| `preagg-readiness.ts` (line 72) | `recharge.revenue_vnd` | YES — readiness probe uses inflated measure |
| `anomaly-config.ts` | `user_recharge_daily.revenue_vnd_total` | NO — correct |
| `liveops-kpi-config.ts` | `user_recharge_daily.revenue_vnd_total` | NO — correct |
| `kpi-config.ts` (frontend) | `user_recharge_daily.revenue_vnd_total` | NO — correct |
| `daily-health.yml` dashboard | `user_recharge_daily.revenue_vnd_total` | NO — correct |
| `playbook-registry.ts` | `user_recharge_daily.revenue_vnd` (per-user) | OK — per-user scope, not total |

**Blast radius conclusion:** The monitoring stack (anomaly detector, liveops KPI board, daily-health dashboard) is already on the correct measure. Only the metric preset YAML files (`revenue.yml`, `gross_bookings.yml`, `arpdau.yml`, `arppu.yml`) and `preagg-readiness.ts` still reference the inflated `recharge.revenue_vnd`. Fixing `revenue.yml` (Decision 1) cascades to all four affected presets. `preagg-readiness.ts:72` is a secondary fix — it uses `recharge.revenue_vnd` as a readiness probe measure, which will fail to find a pre-agg partition for the wrong reason.

---

## Unresolved Questions

1. **`organic_installs` / `paid_installs`:** `game_key_metrics` has `is_paid_install` as a segment dimension but no dedicated additive measures. Recovering these requires adding two new measures (`installs_paid`, `installs_organic`) to `game_key_metrics.yml` or accepting the `installs` measure + segment filter pattern. User decision: add measures to YAML or drop organic/paid split?

2. **`roas_07` vs `roas`:** `game_key_metrics.roas` is period-ROAS (`rev / cost_vnd` in the query window), NOT D7-cumulative ROAS from install cohort. If `roas_07` means "D7 cumulative revenue / cost for installs on that day", it requires a cohort join (install day + D7 revenue) not available in `game_key_metrics`. Needs clarification: is D7-ROAS required, or is period ROAS acceptable under the `roas_07` label?

3. **LTV semantics:** `ltv` / `ltv_30` presets use `new_users` as denominator for a "lifetime" metric — this makes sense as "LTV per cohort" when queried on the install/register date. Repointing denominator to `game_key_metrics.nru` changes the time-dimension from "user install_date" to "report_date" (daily cohort). Are callers expected to query by install-cohort date, or by calendar date? This drives the correct source choice.

4. **`etl_lottery_shoot` pre-agg:** No daily rollup pre-agg exists in the YAML. Proposals 4–6 will cold-scan 213M rows without one. Should a `lottery_summary_batch` pre-agg be added to `etl_lottery_shoot.yml` before these metrics ship?

5. **`game_key_metrics` data presence:** The pre-agg `key_metrics_by_source_daily_batch` partition was not built locally (probed, got pre-agg-not-built error). The source table `cons_game_key_metrics_daily` exists in the Trino schema and the SQL compiled correctly. Is this mart populated for cfm_vn in production (vs the local dev workspace)? If the mart is empty, all 20 "recoverable via game_key_metrics" metrics will return 0/null.
