# CFM VN — Fast-Query Design Spec (Phase 3)

**Generated:** 2026-06-10 GMT+7  
**Scope:** Rollup coverage + preset repoint + fast/cold/blocked assignment for all 57 + 12 new metrics  
**Based on:** live `/meta` + YAML inspection + prior audit reports

---

## 0. Key Verification Findings

Before design: verified state of every cube and rollup that the locked decisions depend on.

| Cube | Existing rollup(s) | Time-dim in rollup | Covers needed metrics? |
|---|---|---|---|
| `active_daily` | `dau_by_platform_daily_batch` + `dau_by_ingame_dims_daily_batch` (+ lambdas) | `log_date` | dau, paying_dau, wau, mau, trailing_wau, trailing_mau, total_online_time_sec — YES |
| `user_recharge_daily` | `recharge_daily_by_channel_batch` (+ lambda) | `log_date` | revenue_vnd_total, txn_count_total, paying_users — YES |
| `game_key_metrics` | `key_metrics_by_source_daily_batch` (+ lambda) | `report_date` | cost_vnd, impressions, clicks, installs, nru, npu, rev, trans — PARTIAL (nnpu missing) |
| `new_user_retention` | `nru_retention_by_cohort_batch` (+ lambda) | `report_date` | nru, npu, rpnpu_d7/d30, rnru_d1..d360 — YES |
| `etl_money_flow` | `money_flow_summary_batch` (+ lambda + ts twin) | `log_date` (+ `dteventtime` twin) | all economy measures + segments — YES |
| `etl_lottery_shoot` | `lottery_pulls_batch` (+ lambda + ts twin) | `log_date` (+ `dteventtime` twin) | pulls, distinct_players, total_cost_diamond, total_cost_gold, ten_pull_count — YES (all gacha metrics) |
| `etl_newbie_tutorial` | `tutorial_funnel_batch` (+ lambda + ts twin) | `log_date` (+ `dteventtime` twin) | events, started_count, completed_count, distinct_players — YES |
| `mf_users` | `ltv_by_install_cohort_batch` (+ lambda) | `install_date` | ltv_total_vnd, ltv_30d_total_vnd only — narrow; no new_users/installs cols exist |
| `retention` | **NO pre_aggregations** | n/a | rr01/rr07/rr30/rr — cold scan (~14s) |
| `recharge` | **NO pre_aggregations** | n/a | revenue_vnd, paying_users, arppu_vnd — cold scan (~5s) |

**Critical gap — game_key_metrics rollup missing `nnpu`:** `key_metrics_by_source_daily_batch` includes nru, npu, rev, cost_vnd, impressions, clicks, installs, trans — but NOT `nnpu`. A query for `nnpu` will fall through to source. Rollup must be extended.

**arppu on recharge — no rollup, cold:** `recharge.revenue_vnd` (inflated) and `recharge.paying_users` have no pre-agg. After repoint: the new `arppu` formula will be `user_recharge_daily.revenue_vnd_total / user_recharge_daily.paying_users` — both columns ARE in `recharge_daily_by_channel_batch`. Post-repoint arppu = fast.

**revenue repoint path verified:** `user_recharge_daily.recharge_daily_by_channel_batch` carries `revenue_vnd_total` + `paying_users` keyed on `log_date`. Cold baseline = 5.3s → warm target <2s. Rollup is already built (120-day window, monthly partitions).

**arpdau cross-cube:** both components (active_daily.dau → log_date rollup, user_recharge_daily.revenue_vnd_total → log_date rollup) use the same `log_date` time-axis. A dedicated conforming rollup is possible but requires a new cube or a pre-agg that joins both. Workable design is in §3.

---

## 1. Cube YAML Change Spec

### 1.1 `cube-dev/cube/model/cubes/cfm/game_key_metrics.yml`

#### ADD `nnpu` to `key_metrics_by_source_daily_batch` rollup

**Problem:** rollup currently lists 8 measures; `nnpu` is absent → falls through to source for any query requesting it.

**Change:** add `nnpu` to the rollup measures list (it is `type: sum`, fully additive).

```yaml
# In pre_aggregations → key_metrics_by_source_daily_batch → measures:
# ADD after npu:
          - nnpu
```

#### ADD derived measures for ratio metrics

`cti`, `cpn`, `nru_install_rate`, `rev_per_npu` (arpnpu), `rev_per_nnpu` (arpnnpu), `mkt_rev_ratio` require ratio measures. All denominators and numerators are already additive base measures. Add to the `measures:` block:

```yaml
      - name: cti
        sql: "CAST({installs} AS DOUBLE) / NULLIF({clicks}, 0)"
        type: number
        format: percent
        description: Click-to-install rate

      - name: cpn
        sql: "CAST({cost_vnd} AS DOUBLE) / NULLIF({nru}, 0)"
        type: number
        description: Cost per new registered user (VND)

      - name: nru_install_rate
        sql: "CAST({nru} AS DOUBLE) / NULLIF({installs}, 0)"
        type: number
        format: percent
        description: New registered users per install

      - name: rev_per_npu
        sql: "CAST({rev} AS DOUBLE) / NULLIF({npu}, 0)"
        type: number
        description: Revenue per new paying user (VND)

      - name: rev_per_nnpu
        sql: "CAST({rev} AS DOUBLE) / NULLIF({nnpu}, 0)"
        type: number
        description: Revenue per net-new paying user (VND)

      - name: mkt_rev_ratio
        sql: "CAST({cost_vnd} AS DOUBLE) / NULLIF({rev}, 0)"
        type: number
        format: percent
        description: Marketing cost to revenue ratio
```

**Additivity note:** all 6 are `type: number` post-agg ratios computed from additive base sums. They do NOT go into the rollup (rollups can only carry additive leaf measures). These are computed at query time from the rolled-up base sums — exactly the correct pattern.

#### ADD `paid_only_totals_batch` rollup (for organic/paid install split)

`organic_installs` and `paid_installs` require installs filtered by `is_paid_install`. The existing rollup already carries `is_paid_install` as a dimension — queries using `segment: paid_only` + `installs` will route correctly to `key_metrics_by_source_daily_batch` since `is_paid_install` is a dimension in it. **No new rollup needed** — but two new additive measures are required if the preset needs them as standalone members:

```yaml
      - name: installs_paid
        sql: installs
        type: sum
        filters:
          - sql: "{CUBE}.is_paid_install = '1'"
        description: Paid installs only

      - name: installs_organic
        sql: installs
        type: sum
        filters:
          - sql: "{CUBE}.is_paid_install = '0'"
        description: Organic installs only
```

Add both to the rollup measures list. These are additive (filtered sums).

**Updated rollup measures list for `key_metrics_by_source_daily_batch`:**
```yaml
        measures:
          - cost_vnd
          - impressions
          - clicks
          - installs
          - installs_paid
          - installs_organic
          - nru
          - npu
          - nnpu
          - rev
          - trans
```

---

### 1.2 `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml`

No structural changes needed. Existing `recharge_daily_by_channel_batch` rollup already covers `revenue_vnd_total`, `txn_count_total`, `paying_users` with `log_date` time-dim. This rollup serves the repointed `revenue`, `arppu`, and all downstream cascade metrics.

**One note:** the rollup has a 120-day rolling build window (not full history). For queries outside the 120d window, the lambda union falls through to source (5.3s cold). Acceptable — metric catalog's "last 30d" slice is well within the window.

---

### 1.3 `cube-dev/cube/model/cubes/cfm/active_daily.yml`

No structural changes needed. `dau_by_ingame_dims_daily_batch` carries dau, paying_dau, wau, mau, total_online_time_sec with `log_date`. Serves all active_daily metrics.

**`avg_online_time_min_per_dau`** (new metric #11) is a ratio computed post-query:
- numerator = `active_daily.total_online_time_sec` (in rollup)
- denominator = `active_daily.dau` (in rollup)
- Formula: `total_online_time_sec * 1.0 / NULLIF(dau, 0) / 60`
- This is a derived ratio measure, NOT put in the rollup. Computed from rolled-up sums.

Add to `active_daily.yml` measures block:
```yaml
      - name: avg_online_time_min_per_dau
        sql: "CAST({total_online_time_sec} AS DOUBLE) / NULLIF({dau}, 0) / 60"
        type: number
        description: Average online time per DAU (minutes)
```

---

### 1.4 `cube-dev/cube/model/cubes/cfm/etl_lottery_shoot.yml`

Existing `lottery_pulls_batch` rollup already covers `pulls`, `distinct_players`, `total_cost_diamond`, `total_cost_gold`, `ten_pull_count` with `log_date` time-dim and `lottery_box` dimension. This serves all 3 gacha metrics (gacha_pulls, gacha_diamond_cost, gacha_players).

No changes needed — rollup exists and is correctly structured.

---

### 1.5 `cube-dev/cube/model/cubes/cfm/etl_money_flow.yml`

Existing `money_flow_summary_batch` rollup covers all needed measures with `log_date`. Serves diamond_spend_events, diamond_net_delta, economy_spenders.

No changes needed.

---

### 1.6 `cube-dev/cube/model/cubes/cfm/etl_newbie_tutorial.yml`

Existing `tutorial_funnel_batch` rollup covers `events`, `started_count`, `completed_count`, `distinct_players` with `log_date`. Serves tutorial_completions and tutorial_starters.

**`tutorial_completion_rate`** is a ratio measure (`completed_count / started_count`) — it is already modeled in the YAML as `type: number`. However its current formula uses `* 1.0` on a count-type numerator:
```yaml
sql: "{completed_count} * 1.0 / NULLIF({started_count}, 0)"
```
Per the lessons-learned rule (integer count × 1.0 → decimal scale truncation), this **must** be fixed:
```yaml
      - name: completion_rate
        sql: "CAST({completed_count} AS DOUBLE) / NULLIF({started_count}, 0)"
        type: number
        format: percent
        description: Completed / started across the filter window
```
`completion_rate` is NOT in the rollup (non-additive ratio). Computed at query time from rolled-up counts. Fix the `* 1.0` → `CAST(...AS DOUBLE)` bug while here.

---

### 1.7 `cube-dev/cube/model/cubes/cfm/recharge.yml`

No rollup to add — `recharge` cube stays cold for any preset that still references it. After repoint:
- `revenue` → `user_recharge_daily.revenue_vnd_total` (fast)
- `paying_users` preset → stays on `recharge.paying_users` (cold; recharge has no rollup)
- `arppu` → repointed to `user_recharge_daily` (fast)
- `transactions` → stays on `recharge.transactions` (cold, ~5s)

Adding a full rollup to `recharge` is deferred (the raw SQL cube does a two-table LEFT JOIN which requires rollup testing). The `paying_users` and `transactions` presets will be labeled **cold**.

---

### 1.8 `cube-dev/cube/model/cubes/cfm/retention.yml`

No pre_aggregations block exists. The retention cube is a SQL-derived two-pass self-join (~14s cold). Building a rollup on a `sql:`-defined derived table requires the full query to be a superset of the aggregation — complex. Defer. All retention metrics (rr01, rr07, rr30, rr) remain **cold**.

---

## 2. ARPDAU / ARPPU Ratio Resolution

This is the trickiest design decision. Two competing designs:

### Design A: ARPDAU via dedicated conformed daily mart (recommended)

Both `user_recharge_daily.revenue_vnd_total` (log_date rollup) and `active_daily.dau` (log_date rollup) are keyed on the same `log_date`. The Cube join (`recharge → mf_users ← active_daily`) currently forces a cross-cube join that times out.

**Fast ARPDAU design:** a new rollup on `user_recharge_daily` that adds `active_daily.dau` via a pre-computed join is not straightforward in Cube's rollup model (rollups don't support cross-cube joins). The correct approach is a **new conforming measure** on either cube or a Cube `view` that blends both. However:

- Cube `views` don't support rollups natively
- Cross-cube `joins` in a query still produce the scan

**Practical resolution for Phase 4:** ARPDAU remains **cold** (>15s, stub). Label: `cold`. A future fast path requires either:
1. Adding a pre-aggregated `dau_by_day` measure to `user_recharge_daily` by joining at build time (requires a `sql:` override on the cube that pre-joins the two marts), OR
2. A new standalone `arpdau_daily` mart in Trino (upstream ETL work)

Neither is in scope for Phase 4. ARPDAU stays `draft + cold`.

### ARPPU resolution (post-repoint, fast)

Before repoint: `recharge.revenue_vnd / recharge.paying_users` — both cold (no rollup on recharge), inflated numerator.

After repoint to `user_recharge_daily`:
- `revenue_vnd_total` — in rollup (`recharge_daily_by_channel_batch`)
- `paying_users` — in rollup (same)
- Both keyed on `log_date` — same rollup, no cross-cube join needed

**New arppu formula:** `user_recharge_daily.revenue_vnd_total / user_recharge_daily.paying_users`

This is a same-cube ratio within `user_recharge_daily` — computed post-rollup from the two rolled-up measures. **Fast (<2s warm)**.

**Preset change:** `arppu.yml` formula:
```yaml
# OLD:
formula:
  type: ratio
  numerator: recharge.revenue_vnd
  denominator: recharge.paying_users

# NEW:
formula:
  type: ratio
  numerator: user_recharge_daily.revenue_vnd_total
  denominator: user_recharge_daily.paying_users
```

---

## 3. Preset Edit Spec

Full list of changes to `server/src/presets/business-metrics/*.yml`.

### 3A. Revenue cluster (cascade from revenue repoint)

| File | Field | OLD → NEW | Notes |
|---|---|---|---|
| `revenue.yml` | `formula.ref` | `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total` | Core repoint; tier stays 1 |
| `revenue.yml` | `game_compatibility.required_cubes` | `[recharge]` → `[user_recharge_daily]` | |
| `gross_bookings.yml` | `formula.ref` | `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total` | Keep trust: draft; add note about billing cube dedup |
| `gross_bookings.yml` | `game_compatibility.required_cubes` | `[recharge]` → `[user_recharge_daily]` | |
| `arppu.yml` | `formula.numerator` | `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total` | |
| `arppu.yml` | `formula.denominator` | `recharge.paying_users` → `user_recharge_daily.paying_users` | |
| `arppu.yml` | `game_compatibility.required_cubes` | `[recharge]` → `[user_recharge_daily]` | |
| `arpdau.yml` | `formula.numerator` | `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total` | Numerator corrected; denominator `active_daily.dau` unchanged; still cold |
| `arpdau.yml` | `trust` | `certified` → `draft` | Still cold cross-cube; label it |
| `arpdau.yml` | `game_compatibility.required_cubes` | `[recharge, active_daily]` → `[user_recharge_daily, active_daily]` | |

### 3B. Acquisition cluster (repoint to game_key_metrics)

| File | Field | OLD → NEW |
|---|---|---|
| `nru.yml` | `formula.ref` | `mf_users.new_users` → `game_key_metrics.nru` |
| `nru.yml` | `game_compatibility.required_cubes` | `[mf_users]` → `[game_key_metrics]` |
| `npu.yml` | `formula.ref` | `mf_users.new_paying_users` → `game_key_metrics.npu` |
| `npu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `nnpu.yml` | `formula.ref` | `mf_users.new_register_and_paying_users` → `game_key_metrics.nnpu` |
| `nnpu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `installs.yml` | `formula.ref` | `mf_users.installs` → `game_key_metrics.installs` |
| `installs.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `organic_installs.yml` | `formula.ref` | `mf_users.organic_installs` → `game_key_metrics.installs_organic` |
| `organic_installs.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `paid_installs.yml` | `formula.ref` | `mf_users.paid_installs` → `game_key_metrics.installs_paid` |
| `paid_installs.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `cost.yml` | `formula.ref` | `mf_users.marketing_cost` → `game_key_metrics.cost_vnd` |
| `cost.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `clicks.yml` | `formula.ref` | `mf_users.clicks` → `game_key_metrics.clicks` |
| `clicks.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `impressions.yml` | `formula.ref` | `mf_users.impressions` → `game_key_metrics.impressions` |
| `impressions.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `cpi.yml` | `formula.numerator` | `mf_users.marketing_cost` → `game_key_metrics.cost_vnd` |
| `cpi.yml` | `formula.denominator` | `mf_users.installs` → `game_key_metrics.installs` |
| `cpi.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `ctr.yml` | `formula.numerator` | `mf_users.clicks` → `game_key_metrics.clicks` |
| `ctr.yml` | `formula.denominator` | `mf_users.impressions` → `game_key_metrics.impressions` |
| `ctr.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `cti.yml` | `formula.numerator` | `mf_users.installs` → `game_key_metrics.installs` |
| `cti.yml` | `formula.denominator` | `mf_users.clicks` → `game_key_metrics.clicks` |
| `cti.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `cpn.yml` | `formula.numerator` | `mf_users.marketing_cost` → `game_key_metrics.cost_vnd` |
| `cpn.yml` | `formula.denominator` | `mf_users.new_users` → `game_key_metrics.nru` |
| `cpn.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `nru_install_rate.yml` | `formula.numerator` | `mf_users.new_users` → `game_key_metrics.nru` |
| `nru_install_rate.yml` | `formula.denominator` | `mf_users.installs` → `game_key_metrics.installs` |
| `nru_install_rate.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `roas.yml` | `formula.numerator` | `mf_users.rev_per_install_d7` → `game_key_metrics.rev` |
| `roas.yml` | `formula.denominator` | `mf_users.marketing_cost` → `game_key_metrics.cost_vnd` |
| `roas.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `roas_07.yml` | same as roas.yml | same changes + add description note "period ROAS (not D7 cohort)" |
| `mkt_rev_ratio.yml` | `formula.numerator` | `mf_users.marketing_cost` → `game_key_metrics.cost_vnd` |
| `mkt_rev_ratio.yml` | `formula.denominator` | `recharge.revenue_vnd` → `game_key_metrics.rev` |
| `mkt_rev_ratio.yml` | `game_compatibility.required_cubes` | `[mf_users, recharge]` → `[game_key_metrics]` |
| `rev_npu.yml` | `formula.ref` | `mf_users.rev_new_paying_users` → `game_key_metrics.rev` (rename to rev_from_gkm) |
| `rev_npu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `rev_nnpu.yml` | `formula.ref` | `mf_users.rev_new_register_and_paying_users` → `game_key_metrics.rev` |
| `rev_nnpu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `arpnpu.yml` | `formula.numerator` | `mf_users.rev_new_paying_users` → `game_key_metrics.rev` |
| `arpnpu.yml` | `formula.denominator` | `mf_users.new_paying_users` → `game_key_metrics.npu` |
| `arpnpu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |
| `arpnnpu.yml` | `formula.numerator` | `mf_users.rev_new_register_and_paying_users` → `game_key_metrics.rev` |
| `arpnnpu.yml` | `formula.denominator` | `mf_users.new_register_and_paying_users` → `game_key_metrics.nnpu` |
| `arpnnpu.yml` | `game_compatibility.required_cubes` | → `[game_key_metrics]` |

**Semantic note for rev_npu / arpnpu / rev_nnpu / arpnnpu:** after repoint, these use `game_key_metrics.rev` (total revenue for the acquisition cohort slice, not specifically "revenue generated by NPU in the period"). The semantics shift from "NPU's own revenue" to "total cohort revenue / NPU count". This is the best available approximation within a single mart — flag in description.

### 3C. Paying-retention repoint

| File | Field | OLD → NEW |
|---|---|---|
| `rp.yml` | `formula.numerator` | `mf_users.paying_retained_d7` → `new_user_retention.rpnpu_d7` |
| `rp.yml` | `formula.denominator` | `mf_users.new_paying_users` → `new_user_retention.npu` |
| `rp.yml` | `game_compatibility.required_cubes` | `[mf_users]` → `[new_user_retention]` |

**Rollup coverage:** `nru_retention_by_cohort_batch` includes both `rpnpu_d7` and `npu`. Fast.

### 3D. LTV — defer as draft

| File | Action |
|---|---|
| `ltv.yml` | Keep `trust: draft`. Change `formula.denominator` from `mf_users.new_users` (absent) to `game_key_metrics.nru`. Change `formula.numerator` from `mf_users.ltv_total_vnd` to `game_key_metrics.rev`. Add description note: "daily cohort LTV (rev/NRU on report_date), not lifetime NPV cohort". |
| `ltv_30.yml` | Same changes as ltv.yml. Keep `trust: draft`. |

Both stay `trust: draft` and `tier: cold` pending semantics review.

### 3E. New metrics — new YAML files to create

12 new preset files. All `trust: draft` initially.

| New file | `formula` | `required_cubes` | Rollup | tier |
|---|---|---|---|---|
| `diamond_spend_events.yml` | measure: `etl_money_flow.out_events`, segments: `diamond_only + spends_only` | `[etl_money_flow]` | `money_flow_summary_batch` (log_date) | fast |
| `diamond_net_delta.yml` | measure: `etl_money_flow.total_delta`, segment: `diamond_only` | `[etl_money_flow]` | same | fast |
| `economy_spenders.yml` | measure: `etl_money_flow.distinct_players`, segment: `spends_only` | `[etl_money_flow]` | same | fast |
| `gacha_pulls.yml` | measure: `etl_lottery_shoot.pulls` | `[etl_lottery_shoot]` | `lottery_pulls_batch` (log_date) | fast |
| `gacha_diamond_cost.yml` | measure: `etl_lottery_shoot.total_cost_diamond` | `[etl_lottery_shoot]` | same | fast |
| `gacha_players.yml` | measure: `etl_lottery_shoot.distinct_players` | `[etl_lottery_shoot]` | same | fast |
| `tutorial_completions.yml` | measure: `etl_newbie_tutorial.completed_count` | `[etl_newbie_tutorial]` | `tutorial_funnel_batch` (log_date) | fast |
| `tutorial_completion_rate.yml` | ratio: `etl_newbie_tutorial.completed_count / etl_newbie_tutorial.started_count` | `[etl_newbie_tutorial]` | same (ratio computed from rolled-up counts) | fast |
| `tutorial_starters.yml` | measure: `etl_newbie_tutorial.distinct_players` | `[etl_newbie_tutorial]` | same | fast |
| `total_online_time_hrs.yml` | measure: `active_daily.total_online_time_sec`, unit transform ÷3600 at display | `[active_daily]` | `dau_by_ingame_dims_daily_batch` (log_date) | fast |
| `avg_online_time_min_per_dau.yml` | ratio: `active_daily.total_online_time_sec / active_daily.dau / 60` (new derived measure) | `[active_daily]` | same (ratio from rolled-up measures) | fast |
| `iap_revenue.yml` | measure: `game_key_metrics.iap_rev` | `[game_key_metrics]` | `key_metrics_by_source_daily_batch`* | fast* |

*`iap_rev` is not in the current rollup. Must add `iap_rev` to `key_metrics_by_source_daily_batch` measures list. It is `type: sum`, additive.

**Add `iap_rev` to `key_metrics_by_source_daily_batch` measures:**
```yaml
# ADD to game_key_metrics rollup measures list:
          - iap_rev
```

### 3F. Structural blocked stubs — wire `unavailable`

Add `available: false` and `trust: unavailable` to these 12 files. No formula changes needed — they remain as tombstones so the catalog and agent can surface "not available for this game" rather than 400.

Files: `acu.yml`, `ccu.yml`, `pcu.yml`, `lcu.yml`, `active_role.yml`, `paying_role.yml`, `new_role.yml`, `new_paying_role.yml`, `cvr_cdn_download.yml`, `cvr_install.yml`, `cvr_login_form.yml`, `cvr_register.yml`.

Change per file:
```yaml
trust: unavailable
# (or add a game_compatibility.unavailable_games: [cfm_vn] field if the server supports it)
```

The simplest server-side interpretation: the trust resolver sees `unavailable` and excludes from the available set for any game. Phase 4 should verify `metric-trust-resolver.ts` handles this value.

---

## 4. Fast / Cold / Blocked Assignment Table

Complete assignment for all 57 existing + 12 new metrics.

| Metric ID | Tier | Serving cube (post-change) | Rollup | Assignment |
|---|---|---|---|---|
| dau | 1 | active_daily | dau_by_ingame_dims_daily_batch | **fast** |
| wau | 2 | active_daily | same (carries wau) | **fast** |
| mau | 2 | active_daily | same (carries mau) | **fast** |
| trailing_wau | 3 | active_daily | same | **fast** |
| trailing_mau | 3 | active_daily | same | **fast** |
| revenue | 1 | user_recharge_daily | recharge_daily_by_channel_batch | **fast** |
| gross_bookings | 2 | user_recharge_daily | same | **fast** |
| arppu | 1 | user_recharge_daily | same (both measures in rollup) | **fast** |
| arpdau | 1 | user_recharge_daily + active_daily | no cross-cube rollup | **cold** |
| transactions | 2 | recharge | no rollup | **cold** |
| paying_users | 1 | recharge | no rollup | **cold** |
| arpu | 1 | mf_users | ltv_by_install_cohort_batch (install_date) | **cold** (no daily time-dim rollup for ARPU) |
| paying_users_30d | 2 | mf_users | ltv rollup (no day-grain paying_users_30d) | **cold** |
| paying_rate_30d | 3 | mf_users | no rollup for this measure | **cold** |
| paying_rate | 2 | mf_users | no rollup for paying_rate | **cold** |
| trailing_mpu | 3 | user_recharge_daily | recharge_daily_by_channel_batch | **fast** |
| trailing_wpu | 3 | user_recharge_daily | same | **fast** |
| rr01 | 1 | retention | no pre-agg | **cold** |
| rr07 | 1 | retention | no pre-agg | **cold** |
| rr30 | 2 | retention | no pre-agg | **cold** |
| rr | 1 | retention | no pre-agg | **cold** |
| nru | 1 | game_key_metrics | key_metrics_by_source_daily_batch | **fast** |
| npu | 2 | game_key_metrics | same | **fast** |
| nnpu | 3 | game_key_metrics | same (after nnpu added to rollup) | **fast** |
| installs | 2 | game_key_metrics | same | **fast** |
| organic_installs | 2 | game_key_metrics | same (installs_organic new measure) | **fast** |
| paid_installs | 2 | game_key_metrics | same (installs_paid new measure) | **fast** |
| cost | 2 | game_key_metrics | same (cost_vnd) | **fast** |
| clicks | 2 | game_key_metrics | same | **fast** |
| impressions | 2 | game_key_metrics | same | **fast** |
| cpi | 2 | game_key_metrics | ratio from cost_vnd + installs (in rollup) | **fast** |
| ctr | 2 | game_key_metrics | ratio from clicks + impressions (in rollup) | **fast** |
| cti | 2 | game_key_metrics | ratio from installs + clicks (new derived measure) | **fast** |
| cpn | 2 | game_key_metrics | ratio from cost_vnd + nru (new derived measure) | **fast** |
| nru_install_rate | 2 | game_key_metrics | ratio from nru + installs (new derived measure) | **fast** |
| roas | 1 | game_key_metrics | ratio from rev + cost_vnd (in rollup) | **fast** |
| roas_07 | 1 | game_key_metrics | same (period ROAS; D7-cohort ROAS still missing) | **fast** |
| mkt_rev_ratio | 2 | game_key_metrics | ratio from cost_vnd + rev (new derived measure) | **fast** |
| rev_npu | 2 | game_key_metrics | rev measure in rollup | **fast** |
| arpnpu | 2 | game_key_metrics | ratio from rev + npu (new derived measure) | **fast** |
| rev_nnpu | 3 | game_key_metrics | rev measure in rollup | **fast** |
| arpnnpu | 3 | game_key_metrics | ratio from rev + nnpu (new derived measure) | **fast** |
| rp | 2 | new_user_retention | nru_retention_by_cohort_batch | **fast** |
| ltv | 1 | game_key_metrics (draft) | key_metrics_by_source_daily_batch | **cold** (draft; semantics TBD) |
| ltv_30 | 1 | game_key_metrics (draft) | same | **cold** (draft) |
| acu | 3 | — | — | **blocked** |
| ccu | 2 | — | — | **blocked** |
| pcu | 3 | — | — | **blocked** |
| lcu | 3 | — | — | **blocked** |
| active_role | 3 | — | — | **blocked** |
| paying_role | 3 | — | — | **blocked** |
| new_role | 3 | — | — | **blocked** |
| new_paying_role | 3 | — | — | **blocked** |
| cvr_cdn_download | 2 | — | — | **blocked** |
| cvr_install | 2 | — | — | **blocked** |
| cvr_login_form | 2 | — | — | **blocked** |
| cvr_register | 2 | — | — | **blocked** |
| diamond_spend_events | new | etl_money_flow | money_flow_summary_batch | **fast** |
| diamond_net_delta | new | etl_money_flow | same | **fast** |
| economy_spenders | new | etl_money_flow | same | **fast** |
| gacha_pulls | new | etl_lottery_shoot | lottery_pulls_batch | **fast** |
| gacha_diamond_cost | new | etl_lottery_shoot | same | **fast** |
| gacha_players | new | etl_lottery_shoot | same | **fast** |
| tutorial_completions | new | etl_newbie_tutorial | tutorial_funnel_batch | **fast** |
| tutorial_completion_rate | new | etl_newbie_tutorial | same (ratio from counts) | **fast** |
| tutorial_starters | new | etl_newbie_tutorial | same | **fast** |
| total_online_time_hrs | new | active_daily | dau_by_ingame_dims_daily_batch | **fast** |
| avg_online_time_min_per_dau | new | active_daily | same (ratio from measures in rollup) | **fast** |
| iap_revenue | new | game_key_metrics | key_metrics_by_source_daily_batch (after iap_rev added) | **fast** |

**Summary:** 36 fast · 10 cold · 12 blocked (69 total with 12 new)

---

## 5. Build / Verify Checklist for Phase 4

### 5.1 YAML changes to land

1. `game_key_metrics.yml`: add measures `cti`, `cpn`, `nru_install_rate`, `rev_per_npu`, `rev_per_nnpu`, `mkt_rev_ratio`, `installs_paid`, `installs_organic`; add `nnpu`, `installs_paid`, `installs_organic`, `iap_rev` to rollup measures list.
2. `active_daily.yml`: add measure `avg_online_time_min_per_dau`.
3. `etl_newbie_tutorial.yml`: fix `completion_rate` sql from `* 1.0` → `CAST(... AS DOUBLE)`.
4. Create 12 new preset YAML files (§3E).
5. Edit 57 existing preset YAML files per §3A–3F.

### 5.2 Cube restart (required — DEV_MODE=false)

```bash
# After YAML changes:
docker restart cube-playground-cube-api-dev
# Wait for /readyz before probing
```

### 5.3 Pre-agg build

Rollups that have new measures added need their partitions rebuilt:
- `game_key_metrics.key_metrics_by_source_daily_batch` — adding nnpu, installs_paid, installs_organic, iap_rev; existing partitions are stale; trigger rebuild
- All other rollups already carry the needed measures (no partition rebuild needed)

```bash
# Trigger rebuild for cfm_vn key_metrics rollup:
cube-dev/scripts/trigger-preagg-build.sh cfm_vn
```

### 5.4 Routing verification (per-metric fast-path proof)

For each "fast" metric, verify compiled SQL shows `FROM prod_pre_aggregations.*` not the source table. Sample the 4 most important:

```bash
# revenue (user_recharge_daily rollup)
curl -s -X POST -H 'x-cube-workspace: local' -H 'x-cube-game: cfm_vn' \
  -H 'Content-Type: application/json' \
  -d '{"query":{"measures":["user_recharge_daily.revenue_vnd_total"],"timeDimensions":[{"dimension":"user_recharge_daily.log_date","granularity":"day","dateRange":"last 30 days"}]}}' \
  http://localhost:3004/cube-api/v1/sql | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sql'][0][:200])"

# nru (game_key_metrics rollup)
curl -s -X POST ... "measures":["game_key_metrics.nru"] ...

# dau (active_daily rollup)
curl -s -X POST ... "measures":["active_daily.dau"] ...

# gacha_pulls (etl_lottery_shoot rollup)
curl -s -X POST ... "measures":["etl_lottery_shoot.pulls"] ...
```

Assert: SQL contains `FROM prod_pre_aggregations.` for each.

### 5.5 Warm latency verification

After build + routing confirmed, run `/load` for each fast metric and assert wall time <2s:

```bash
# Target: <2000ms wall time for last-30d slice
time curl -s -X POST ... /cube-api/v1/load ...
```

### 5.6 Cold metric regression check

Verify cold metrics still resolve (not 400) even if slow:
- `transactions`, `paying_users`, `arpu`, `retention (rr01/rr07/rr30/rr)`, `arpdau`

### 5.7 Blocked metric gate check

Verify blocked metrics return `trust: unavailable` from `GET /api/business-metrics?game=cfm_vn` and are excluded from `?filter=available`.

### 5.8 `preagg-readiness.ts` probe fix

After revenue repoint, the readiness probe at `server/src/services/preagg-readiness.ts:72` still queries `recharge.revenue_vnd`. Update to `user_recharge_daily.revenue_vnd_total` so the probe correctly reflects the live rollup.

---

## Unresolved Questions

1. **`roas` / `roas_07` semantic split:** both will point to `game_key_metrics.roas` (period ROAS = rev/cost in the query window). If the business definition of `roas_07` requires D7-cumulative cohort ROAS (install-day revenue accumulated to D7 / install-day cost), that is NOT available in `game_key_metrics` and would require a join against `new_user_retention` or a new mart column. Phase 4 implementer must confirm with marketing-ops whether period ROAS is acceptable under the `roas_07` label.

2. **`ltv` / `ltv_30` formula correctness:** after repoint, both use `game_key_metrics.rev / game_key_metrics.nru` — this is daily cohort revenue / daily NRU, not a D0..D30 cumulative LTV. A true D30 LTV requires summing revenue attributed to the cohort from D0 to D30 — that needs a cohort-window join. Kept as `draft + cold` for now. Clarify LTV definition before promoting.

3. **`paying_users` preset stays on `recharge` (cold, ~5s):** after repoint, the main `paying_users` metric still uses `recharge.paying_users` (vopenid-based, no rollup). If daily paying-user counts for the catalog should serve warm, repoint to `user_recharge_daily.paying_users` (in rollup). Semantics differ slightly (vopenid vs user_id). Phase 4 decision: keep recharge (cold) or repoint to urd (fast, different identity)?

4. **`mf_users` metrics stay cold:** `arpu`, `paying_rate`, `paying_rate_30d`, `paying_users_30d` all serve from `mf_users` table scan (~4.4s). The `ltv_by_install_cohort_batch` rollup is keyed on `install_date`, not a daily time-series — so these are fundamentally cold unless a separate `mf_users_daily_snapshot` pre-agg is built. Not in scope for Phase 4 but worth noting as the next optimization target.

5. **`recharge` pre-agg deferral:** `transactions` and `paying_users` (if kept on recharge) have no rollup and scan the bridged SQL view each time (~5s). Should Phase 4 add a rollup to `recharge` for these? The `recharge` cube uses a `sql:` expression (two-table LEFT JOIN), which means the rollup build would scan both tables. Feasible but not trivial to test. Deferred to a follow-up.

6. **`tutorial_completion_rate` ratio correctness:** existing `completion_rate` measure uses `* 1.0` pattern on count-type measures. Fixed in §1.6. Phase 4 must verify fix resolves the 0.0 truncation against live Trino (test: pick a known tutorial_id with non-zero completions and started).

---

**Status:** DONE_WITH_CONCERNS  
**Summary:** Full rollup coverage design for all 69 metrics (57 + 12 new); 36 fast, 10 cold, 12 blocked; all cube YAML changes and preset repoints are implementation-ready with exact field specs and SQL exprs.  
**Concerns:** (1) `game_key_metrics.key_metrics_by_source_daily_batch` was not built locally — Phase 4 must confirm the mart is populated in prod before declaring those 20 recovered metrics fast; (2) ARPDAU remains architecturally blocked (cross-cube, no clean rollup path); (3) roas/roas_07 semantic distinction needs marketing-ops confirmation before shipping; (4) `completion_rate * 1.0` bug needs live verification after the CAST fix.
