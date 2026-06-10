# Cross-Game Master Metric List

**Purpose:** Canonical reference for metrics across all games. Each concept row tracks backing cube, assignment (fast/cold/blocked), and rollup status per game. Use this to drive per-game rollout (link to per-game template: `metric-catalog-per-game-rollout-template.md`).

**Last updated:** 2026-06-10  
**cfm_vn status:** Complete (Phase 3 design spec locked)  
**Template row:** cfm_vn is the first fully-mapped column; subsequent games follow the same structure.

---

## Key Definitions

- **fast:** serves warm (<2s) from pre-agg rollup; usable for real-time dashboard/chat
- **cold:** resolves against Trino; 5–15s latency; acceptable for batch/offline analysis
- **blocked:** no backing cube or measure in any variant; omitted from catalog or marked unavailable
- **agnostic concept:** metric meaning + formula shape + ratio class + canonical time-dim are identical across games
- **game-specific:** physical cube name, column name, or schema family differs (etl_/std_/cons_ prefix, or raw vs bridged)

Notation: `cube.measure` is shorthand; actual resolution depends on game's workspace.

---

## A. Foundational User-Count Metrics

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|---------|----|---|----|----|----|
| Daily Active Users | `dau` | engagement | count_distinct on day | 1 | `active_daily.dau` | **fast** (rollup: `dau_by_ingame_dims_daily_batch`, `log_date`) | canonical day-dim: log_date; TBD for jus (uses dt_log?) |
| Weekly Active Users | `wau` | engagement | count_distinct trailing 7 days | 2 | `active_daily.wau` | **fast** (same rollup) | trailing grain calculated by rollup |
| Monthly Active Users | `mau` | engagement | count_distinct trailing calendar month | 2 | `active_daily.mau` | **fast** (same rollup) | calendar month = report_date MTD |
| Trailing WAU | `trailing_wau` | engagement | wau on start of week | 3 | `active_daily.trailing_wau` | **fast** (same rollup) | week starts on Sunday (or per game) |
| Trailing MAU | `trailing_mau` | engagement | mau on start of month | 3 | `active_daily.trailing_mau` | **fast** (same rollup) | calendar month edge |

### Per-Game Divergences
- **jus_vn:** active_daily uses `dt_log` instead of `log_date` — same concept, different column name; rollup: TBD
- **Other games:** TBD per availability audit

---

## B. Revenue & Monetization

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Daily Revenue | `revenue` | monetization | sum daily revenue VND | 1 | `user_recharge_daily.revenue_vnd_total` | **fast** (rollup: `recharge_daily_by_channel_batch`, `log_date`) | REPOINTED from `recharge.revenue_vnd` (15× inflated by test traffic); bridged source only |
| Paying Users | `paying_users` | monetization | count_distinct paying users per day | 1 | `recharge.paying_users` | **cold** (no rollup on recharge, ~5s) | recharge uses vopenid; TBD for cross-game identity |
| ARPPU | `arppu` | monetization | revenue / paying_users, same-cube ratio | 1 | `user_recharge_daily.revenue_vnd_total / user_recharge_daily.paying_users` | **fast** (both in rollup) | REPOINTED; same-cube after bridge |
| Transactions | `transactions` | monetization | count daily recharge transactions | 2 | `recharge.transactions` | **cold** (no rollup, ~5s) | PK verified PASS; distinct payment event count |
| Gross Bookings | `gross_bookings` | monetization | revenue synonym | 2 | `user_recharge_daily.revenue_vnd_total` | **fast** (same as revenue) | REPOINTED; dedup candidate with revenue (same formula) |
| Trailing Monthly Payers | `trailing_mpu` | monetization | distinct payers MTD | 3 | `user_recharge_daily.trailing_mpu` | **fast** (rollup: `recharge_daily_by_channel_batch`) | trailing edge metric |
| Trailing Weekly Payers | `trailing_wpu` | monetization | distinct payers WTD | 3 | `user_recharge_daily.trailing_wpu` | **fast** (same rollup) | trailing edge metric |

### Per-Game Divergences
- **jus_vn:** recharge PK is COMPOSITE (account_id + pay_time + transid + role_id + prepaid_detail_item_id); cfm PK is simple (vng_transaction); impacts fan-out + dedup strategy
- **jus_vn:** day-dimension likely `log_date` or `pay_date` — TBD per audit
- **Other games:** unknown; audit per template

---

## C. User Acquisition & Install Metrics

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| New Registered Users | `nru` | acquisition | count_distinct new installs/registers per day | 1 | `game_key_metrics.nru` | **fast** (rollup: `key_metrics_by_source_daily_batch`, `report_date`) | REPOINTED from mf_users; additive daily cohort count |
| New Paying Users | `npu` | acquisition | count_distinct first-time payers | 2 | `game_key_metrics.npu` | **fast** (same rollup) | REPOINTED |
| New Register & Paying Users | `nnpu` | acquisition | subset of npu: registered AND paid same day | 3 | `game_key_metrics.nnpu` | **fast** (rollup updated; was missing) | REPOINTED; day-grain cohort |
| Installs | `installs` | acquisition | count install events (or session starts) | 2 | `game_key_metrics.installs` | **fast** (same rollup) | REPOINTED from mf_users |
| Organic Installs | `organic_installs` | acquisition | installs where is_paid_install='0' | 2 | `game_key_metrics.installs_organic` (new measure) | **fast** (new filtered measure added to rollup) | REPOINTED + new measure wired |
| Paid Installs | `paid_installs` | acquisition | installs where is_paid_install='1' | 2 | `game_key_metrics.installs_paid` (new measure) | **fast** (new filtered measure) | REPOINTED + new measure wired |

### Per-Game Divergences
- **game_key_metrics** cube is game-agnostic (cons_game_key_metrics_daily per-game mart); schema varies by game (column names stable, but source pipeline differs)
- **mf_users equivalents:** many games have mf_users; cfm lacks new_users, new_paying_users columns (data-platform gap) — that's why repoint to game_key_metrics is necessary
- **Time dimension:** game_key_metrics uses `report_date` (not `log_date`); different semantic from active_daily (report vs event date)

---

## D. User Retention Cohorts

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| D1 Retention Rate | `rr01` | retention | retained_d1 / cohort_size, cohort day | 1 | `retention.retained_d1 / retention.cohort_size` | **cold** (no pre-agg on derived cube, ~14s) | classic cohort metric |
| D7 Retention Rate | `rr07` | retention | retained_d7 / cohort_size | 1 | `retention.retained_d7 / retention.cohort_size` | **cold** (same) | most-watched retention gate |
| D30 Retention Rate | `rr30` | retention | retained_d30 / cohort_size | 2 | `retention.retained_d30 / retention.cohort_size` | **cold** (same) | long-tail retention |
| Retention (cohort time-series) | `rr` | retention | all day measures: cohort_size, retained_d1..d360 | 1 | `retention.*` | **cold** (SQL-derived, no rollup) | all days from cohort; used for waterfall views |
| Paying-User D7 Retention | `rp` | retention | paying_retained_d7 / new_paying_users, cohort D7 | 2 | `new_user_retention.rpnpu_d7 / new_user_retention.npu` | **fast** (rollup: `nru_retention_by_cohort_batch`) | REPOINTED from mf_users; paying cohort retention |

### Per-Game Divergences
- **retention cube schema:** all games likely have cohort_date + day-offset + retained_dN columns; cfm has `sql:`-derived self-join (two passes of active_daily)
- **new_user_retention cube:** exists as cons_game_new_user_retention_daily per game; pre-agg may differ

---

## E. Marketing & ROI Metrics

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Marketing Cost | `cost` | marketing | sum marketing spend VND | 2 | `game_key_metrics.cost_vnd` | **fast** (rollup: `key_metrics_by_source_daily_batch`) | REPOINTED from mf_users; by media source |
| Cost Per Install | `cpi` | marketing | cost / installs, ratio | 2 | `game_key_metrics.cost_vnd / game_key_metrics.installs` | **fast** (derived measure from rollup) | REPOINTED + new derived measure |
| Cost Per NRU | `cpn` | marketing | cost / nru | 2 | `game_key_metrics.cost_vnd / game_key_metrics.nru` (new measure) | **fast** (new ratio added) | REPOINTED + new derived |
| Clicks | `clicks` | marketing | sum ad clicks | 2 | `game_key_metrics.clicks` | **fast** (rollup) | REPOINTED from mf_users |
| Impressions | `impressions` | marketing | sum ad impressions | 2 | `game_key_metrics.impressions` | **fast** (rollup) | REPOINTED |
| Click-Through Rate | `ctr` | marketing | clicks / impressions | 2 | `game_key_metrics.clicks / game_key_metrics.impressions` | **fast** (derived from rollup) | REPOINTED |
| Click-to-Install Rate | `cti` | marketing | installs / clicks (new) | 2 | `game_key_metrics.installs / game_key_metrics.clicks` (new measure) | **fast** (new ratio) | REPOINTED + new measure |
| ROAS (Return on Ad Spend) | `roas` | marketing | revenue / marketing_cost | 1 | `game_key_metrics.rev / game_key_metrics.cost_vnd` | **fast** (derived from rollup) | REPOINTED; period ROAS (not D7 cohort) |
| ROAS 7-Day | `roas_07` | marketing | ROAS or cohort variant | 1 | `game_key_metrics.rev / game_key_metrics.cost_vnd` | **fast** (same as roas) | REPOINTED; semantics TBD (period vs D7-cumulative) |
| Marketing to Revenue Ratio | `mkt_rev_ratio` | marketing | marketing_cost / revenue (new) | 2 | `game_key_metrics.cost_vnd / game_key_metrics.rev` (new measure) | **fast** (new ratio) | REPOINTED + new measure |

### Per-Game Divergences
- **game_key_metrics** carries media_source + campaign dimensions; per-game acquisition pipelines vary
- **mf_users columns:** cfm lacks these entirely (no MMP integration); other games may have partial coverage
- **ROAS semantic:** period ROAS is available; D7-cohort ROAS (sum of D0..D7 revenue / install-day cost) unavailable without cohort join

---

## F. User Lifetime Value (Draft)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Lifetime Value | `ltv` | ltv | cumulative_revenue / new_users (per cohort) | 1 | `game_key_metrics.rev / game_key_metrics.nru` (draft) | **cold** (draft; semantics TBD) | REPOINTED from mf_users; cohort LTV not lifetime NPV |
| LTV 30-Day | `ltv_30` | ltv | revenue D0..D30 / new_users | 1 | `game_key_metrics.rev / game_key_metrics.nru` (draft) | **cold** (draft) | REPOINTED; D30 window unclear |

### Per-Game Divergences
- **mf_users** has `ltv_by_install_cohort_batch` pre-agg (keyed on install_date); not daily time-series
- **game_key_metrics** carries daily cohort revenue; not install-cohort NPV
- **Semantics:** true D0..D30 LTV requires cohort-window join; current formulas are daily-cohort revenue / daily NRU (different time grain)

---

## G. Avg Revenue Per User

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| ARPU | `arpu` | monetization | lifetime_revenue / lifetime_users | 1 | `mf_users.arpu_vnd` | **cold** (~4.4s, no daily rollup) | lifetime aggregate; no time-series rollup for daily ARPU |
| Paying Users 30-Day | `paying_users_30d` | monetization | distinct payers last 30 days | 2 | `mf_users.paying_users_30d` | **cold** | trailing window; no rollup |
| Paying Rate | `paying_rate` | monetization | paying_users / dau or mf_users ratio | 2 | `mf_users.paying_rate` | **cold** | blended metric; no daily rollup |
| Paying Rate 30-Day | `paying_rate_30d` | monetization | paying_users_30d / (approx mau) | 3 | `mf_users.paying_rate_30d` | **cold** | trailing window rate |

### Per-Game Divergences
- **mf_users** is lifetime/rolling aggregate (not daily), so all ARPU metrics are cold unless a new `mf_users_daily_snapshot` pre-agg is built
- **identity:** mf_users uses vopenid (global); game_key_metrics uses user_id (per-game) — cross-metric blends must account for identity mismatch

---

## H. Revenue Per Acquisition Cohort

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Revenue per NPU | `rev_npu` | revenue_per_acq | revenue / new_paying_users | 2 | `game_key_metrics.rev / (via npu)` | **fast** (rollup) | REPOINTED; daily cohort revenue / daily new-payer count |
| Revenue per NNPU | `rev_nnpu` | revenue_per_acq | revenue / nnpu | 3 | `game_key_metrics.rev / (via nnpu)` | **fast** (rollup) | REPOINTED |
| ARPNPU | `arpnpu` | revenue_per_acq | revenue / npu (alias) | 2 | `game_key_metrics.rev / game_key_metrics.npu` (new measure) | **fast** (new ratio) | REPOINTED + new derived |
| ARPNNPU | `arpnnpu` | revenue_per_acq | revenue / nnpu (alias) | 3 | `game_key_metrics.rev / game_key_metrics.nnpu` (new measure) | **fast** (new ratio) | REPOINTED + new derived |
| NRU Install Rate | `nru_install_rate` | acquisition | nru / installs | 2 | `game_key_metrics.nru / game_key_metrics.installs` (new measure) | **fast** (new ratio) | REPOINTED + new derived |

### Per-Game Divergences
- **cohort semantics:** daily cohort (report_date) vs install-cohort (install_date); game_key_metrics uses report_date only
- **revenue attribution:** no per-cohort-day revenue split in game_key_metrics; all daily revenue lumped into day-of-capture, not day-of-install

---

## I. Cross-Cube Ratios (Architecturally Complex)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| ARPDAU | `arpdau` | monetization | revenue / dau (cross-cube) | 1 | `user_recharge_daily.revenue_vnd_total / active_daily.dau` | **cold** (cross-cube join >15s, timeout) | Both measures use log_date; Cube can't join across cubes in rollup; blocked architecturally |

### Design Note
Both components exist in fast rollups (user_recharge_daily, active_daily) keyed on same log_date. Cross-cube join in query times out. Solution: either (a) add dedicated conforming rollup that pre-joins at build time (requires SQL override), or (b) new upstream mart (etl work). Deferred post-Phase 4.

---

## J. Engagement & Session Metrics

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Total Online Time (hours) | `total_online_time_hrs` | engagement | total_online_time_sec / 3600 | new | `active_daily.total_online_time_sec / 3600` | **fast** (rollup: `dau_by_ingame_dims_daily_batch`) | NEW metric; unit transform at display |
| Avg Online Time per DAU (minutes) | `avg_online_time_min_per_dau` | engagement | total_online_time_sec / dau / 60 | new | `active_daily.total_online_time_sec / active_daily.dau / 60` (new ratio measure) | **fast** (derived from rollup) | NEW metric; ratio of measures in same rollup |

### Per-Game Divergences
- **active_daily** is game-agnostic; all games use log_date + same rollup pattern

---

## K. Economy & Resource Metrics (CFM-Specific Event Tables)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Diamond Spend Events | `diamond_spend_events` | economy | count events; segment diamond_only + spends_only | new | `etl_money_flow.out_events` (segment `diamond_only`, `spends_only`) | **fast** (rollup: `money_flow_summary_batch`) | NEW; money_flow table is 1.35B rows; relies on pre-agg |
| Diamond Net Flow | `diamond_net_delta` | economy | net delta (in − out); segment diamond_only | new | `etl_money_flow.total_delta` (segment `diamond_only`) | **fast** (same rollup) | NEW; net balancing metric |
| Economy Spenders | `economy_spenders` | economy | distinct players; segment spends_only | new | `etl_money_flow.distinct_players` (segment `spends_only`) | **fast** (same rollup) | NEW; deduplicated spender count |

### Per-Game Divergences
- **etl_money_flow:** cfm-specific table (not game-agnostic); other games have different economy implementations
- **Applicability:** only cfm_vn and possibly other games with diamond economy model

---

## L. Gacha / Lottery Metrics (CFM-Specific)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Gacha Pulls | `gacha_pulls` | engagement | count pulls; by lottery_box | new | `etl_lottery_shoot.pulls` | **fast** (rollup: `lottery_pulls_batch`, log_date; 213M rows) | NEW; additive count |
| Gacha Diamond Cost | `gacha_diamond_cost` | monetization | sum diamond spent; by lottery_box | new | `etl_lottery_shoot.total_cost_diamond` | **fast** (same rollup) | NEW; resource drain metric |
| Gacha Players | `gacha_players` | engagement | distinct players pulling; by lottery_box | new | `etl_lottery_shoot.distinct_players` | **fast** (same rollup) | NEW; reach metric |

### Per-Game Divergences
- **etl_lottery_shoot:** cfm-specific gacha system (not universal)
- **Applicability:** cfm_vn + other games with gacha (if they model it via etl_lottery_shoot)

---

## M. Onboarding Funnel Metrics (CFM Tutorial Events)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| Tutorial Completions | `tutorial_completions` | onboarding | count completed; by tutorial_id | new | `etl_newbie_tutorial.completed_count` | **fast** (rollup: `tutorial_funnel_batch`, log_date) | NEW; additive count |
| Tutorial Completion Rate | `tutorial_completion_rate` | onboarding | completed / started; ratio | new | `etl_newbie_tutorial.completed_count / etl_newbie_tutorial.started_count` | **fast** (ratio from rollup) | NEW; derived; was `* 1.0` bug (fixed to CAST) |
| Tutorial Starters | `tutorial_starters` | onboarding | distinct players starting; by tutorial_id | new | `etl_newbie_tutorial.distinct_players` | **fast** (rollup) | NEW; reach metric |

### Per-Game Divergences
- **etl_newbie_tutorial:** cfm-specific tutorial event table (other games may use different names or schemas)
- **Applicability:** games with tracked tutorial funnel

---

## N. IAP Revenue (In-App Purchase)

| Concept | ID | Domain | Formula type | Tier | cfm_vn backing | cfm_vn status | Notes |
|---------|----|----|---|---|---|----|----|
| IAP Revenue | `iap_revenue` | monetization | iap-specific revenue VND | new | `game_key_metrics.iap_rev` | **fast** (rollup: `key_metrics_by_source_daily_batch` after iap_rev added) | NEW; broken out from blended revenue |

### Per-Game Divergences
- **game_key_metrics** includes iap_rev per game; column available but may need rollup update

---

## O. Blocked/Unavailable Metrics (No backing for cfm_vn)

| Concept | ID | Domain | Reason | Notes |
|---------|----|----|------|----|
| All Concurrent Users (ACU) | `acu` | engagement | no concurrency snapshot pipeline | cfm_vn has no upstream mf_users.acu column; would need new data-platform pipeline |
| Current Concurrent Users | `ccu` | engagement | no concurrency snapshot pipeline | same |
| Peak Concurrent Users | `pcu` | engagement | no concurrency snapshot pipeline | same |
| Last Concurrent Users | `lcu` | engagement | no concurrency snapshot pipeline | same |
| Active Role Count | `active_role` | gameplay | no time-series for role counts | user_roles cube has distinct_roles (lifetime) only, no day-grain |
| Paying Role Count | `paying_role` | gameplay | no time-series for paying roles | same |
| New Role Count | `new_role` | gameplay | no new-role event source | no daily new-role materialization |
| New Paying Role Count | `new_paying_role` | gameplay | no new-role event source | same |
| Funnel: CDN Download CVR | `cvr_cdn_download` | onboarding | no funnel cube | cfm has ordered_event_funnel (incompatible schema: step_count only) |
| Funnel: Install CVR | `cvr_install` | onboarding | no funnel cube | same |
| Funnel: Login Form CVR | `cvr_login_form` | onboarding | no funnel cube | same |
| Funnel: Register CVR | `cvr_register` | onboarding | no funnel cube | same |

**Disposition:** All 12 marked as `unavailable` in preset YAML; excluded from catalog and chat-agent queries for cfm_vn.

---

## Summary Scoreboard (cfm_vn)

| Category | Count | Assignment |
|----------|-------|------------|
| Fast (rollup <2s) | 36 | dau, wau, mau, trailing_wau, trailing_mau, revenue, gross_bookings, arppu, transactions, trailing_mpu, trailing_wpu, nru, npu, nnpu, installs, organic_installs, paid_installs, cost, clicks, impressions, cpi, ctr, cti, cpn, nru_install_rate, roas, roas_07, mkt_rev_ratio, rev_npu, arpnpu, rev_nnpu, arpnnpu, rp, diamond_*, gacha_*, tutorial_*, total_online_time_hrs, avg_online_time_min_per_dau, iap_revenue |
| Cold (Trino 5–15s) | 10 | transactions (recharge), paying_users (recharge), arpu, paying_users_30d, paying_rate, paying_rate_30d, ltv, ltv_30, rr01, rr07, rr30, rr, arpdau |
| Blocked (no source) | 12 | acu, ccu, pcu, lcu, active_role, paying_role, new_role, new_paying_role, cvr_cdn_download, cvr_install, cvr_login_form, cvr_register |
| **Total** | **58** | — |

---

## Implementation Notes for Per-Game Rollout

1. **Start with availability audit** (per template §2): probe each metric against game's /meta snapshot; classify working vs broken-ref vs stub-errors.
2. **Build/confirm rollups** per game before declaring a metric fast. cfm_vn rollups exist; other games may need new pre-agg definitions.
3. **Cube YAML edits** (per template §4): add missing ratio measures (cti, cpn, nru_install_rate, etc.) and extend rollups with new columns (nnpu, installs_paid/organic, iap_rev).
4. **Preset repoints** (per template §5): edit formula.ref to point at game's physical cube + measure names (e.g., mf_users → game_key_metrics where applicable).
5. **Identity reconciliation:** decide which time-dim + identity scope to use per metric family (active_daily.log_date vs game_key_metrics.report_date vs retention.cohort_date).
6. **Test routing:** verify compiled SQL uses rollup (not source table) for each fast metric before marking warm.
7. **Re-run resolution harness** (per template §1) after implementation to ensure no regressions vs baseline.

---

## Unresolved Questions

1. **ARPDAU architecture:** Both components (revenue, DAU) use same time-dim (log_date) in fast rollups. Cross-cube join times out. Is a conforming upstream mart (etl_arpdau_daily) in scope for post-Phase-4, or should ARPDAU stay blocked?

2. **roas / roas_07 semantic split:** After recovery, both will be `game_key_metrics.rev / cost_vnd` (period ROAS). If business requires D7-cohort ROAS (install-day revenue accumulated to D7 / install-day cost), that requires cohort-window join not available in game_key_metrics. Needs clarification per game.

3. **ltv semantics:** After repoint to game_key_metrics, both ltv and ltv_30 are daily-cohort revenue / daily NRU (not install-cohort NPV). Is this acceptable, or does true D0..D30 LTV require a cohort-join design?

4. **game_key_metrics availability:** Per-game coverage TBD. cfm_vn has cons_game_key_metrics_daily; other games may use different names or have gaps (e.g., missing nnpu column, organic/paid installs split). Audit per game.

5. **identity & blending:** mf_users uses vopenid (global); game_key_metrics uses user_id (per-game); active_daily uses implicit country+payer split. When blending metrics, which identity + scope to use?

6. **time-grain coherence:** active_daily (log_date), game_key_metrics (report_date), retention (cohort_date), new_user_retention (report_date) — all named differently. Standardize naming per game or document the per-metric time-dim explicitly in catalog?
