# POC user-centric metrics — GDS spec mapped to metrics-catalogue cubes

Date: 2026-05-19
Author: khoitn

## Purpose

Authoritative reference of which **[GDS] 1.8 Metrics Definition** (53 metrics) are reliably calculable from the 4 cubes published in `metrics-catalogue/cube/model/cubes/` today, and which require future work. POC = Ballistar VN only.

## Sources

- GDS spec: `plans/reports/_GDS__-_1_8_Metrics_Definition.md` (53 metrics)
- Cube YAMLs:
  - `metrics-catalogue/cube/model/cubes/mf_users.yml` — 1 row / user (hub)
  - `metrics-catalogue/cube/model/cubes/active_daily.yml` — 1 row / user / active day
  - `metrics-catalogue/cube/model/cubes/user_recharge_daily.yml` — 1 row / user / recharge day
  - `metrics-catalogue/cube/model/cubes/recharge.yml` — 1 row / transaction
- Join topology: hub-and-spoke on `mf_users.user_id` (see `plans/reports/architecture/cube-vs-cdp-metrics-architecture.md` §1.2)

## Scope decisions for POC (confirmed)

1. **Revenue source** — `recharge.log_date` and `recharge.recharge_time` are assumed to be both charge date AND delivery date. GDS "Revenue = item delivery date" caveat parked for POC.
2. **Tenant key** — `mf_users.gds_bundle_code` = tenant; POC fixed to Ballistar VN single-tenant.
3. **Distinct-count default** — `count_distinct_approx` (HLL, ~1.6% error) for speed. Exact `count_distinct` reserved for finance/audit reports.
4. **Role-grain (metrics 41–44)** — out of scope for POC; defer until a roles cube exists.
5. **No new YAML required for Tier 1–3.** Calculated-measure additions noted inline are optional ergonomics; client-side division also works.

---

## POC SCOPE — Tier 1 + 2 + 3 = 21 metrics, ship out of the box

### Tier 1 — Existing measure, single cube (8 metrics)

| GDS # | Metric | Cube binding | Notes |
|---|---|---|---|
| 13 | DAU (A1) | `active_daily.dau` | HLL approx_distinct(user_id) |
| 15 | MAU | `active_daily.mau` (granularity=month) or `mau_prev_month` | Same column, granularity-driven |
| 20 | Transactions | `recharge.transactions` | COUNT(*) over txn rows |
| 22 | Revenue (period) | `recharge.revenue_vnd` OR `user_recharge_daily.revenue_vnd_total` | Prefer `user_recharge_daily` for day/week/month cards (already rolled up per user/day) |
| 23 | ARPU (lifetime) | `mf_users.arpu_vnd` | Lifetime only; period-scoped goes in Tier 2 |
| 24 | ARPPU | `recharge.arppu_vnd` (period) / `mf_users.arppu_vnd` (lifetime) | |
| 19a | Paying Rate (lifetime) | `mf_users.paying_rate` | paying_users / user_count |
| 19b | Paying Rate (rolling 30d) | `mf_users.paying_rate_30d` | mf_users pre-aggregates 30d cols |

### Tier 2 — Existing measure + time_dimension/granularity or simple segment (8 metrics)

| GDS # | Metric | Recipe |
|---|---|---|
| 13 | A(n), n≥1 | `active_daily.dau_exact` + filter `log_date BETWEEN report_date-(n-1) AND report_date` |
| 14 | WAU | `active_daily.dau` + timeDimension `log_date` + granularity `week` |
| 16 | PU(n) | `user_recharge_daily.paying_users` + filter `log_date` BETWEEN report_date-(n-1) AND report_date |
| 17 | WPU | `user_recharge_daily.paying_users` + granularity `week` |
| 18 | MPU | `user_recharge_daily.paying_users` + granularity `month` |
| 45 | Trailing WAU | `active_daily.dau` + filter `log_date >= DATE_TRUNC('week', CURRENT_DATE)` |
| 46 | Trailing WPU | `user_recharge_daily.paying_users` + week-start filter |
| 47 | Trailing MAU | `active_daily.dau` + filter `log_date >= DATE_TRUNC('month', CURRENT_DATE)` |
| 48 | Trailing MPU | `user_recharge_daily.paying_users` + month-start filter |

Note: 8 GDS slots; row 13/A(n) and row 45–48 sum to 8 because A1=DAU already counted in Tier 1.

#### Period ARPU/ARPPU caveat

GDS #23 ARPU and #19 daily/weekly/monthly Paying Rate need cross-cube ratios:

- ARPU(period) = `user_recharge_daily.revenue_vnd_total / active_daily.dau` over the same window
- Paying Rate(daily) = `user_recharge_daily.paying_users / active_daily.dau`
- Paying Rate(weekly) = same, granularity=week
- Paying Rate(monthly) = same, granularity=month

Three implementation options:
- (a) Client-side division (two queries, divide in UI). **Recommended for POC** — zero YAML change.
- (b) Add calculated measures in a new view `views/user_360.yml` that joins both cubes. Cleaner long-term.
- (c) Add calculated measures via cube-to-cube `{}` references — Cube supports this through views.

### Tier 3 — Cohort filter on `mf_users` anchors, no new YAML (5 metrics)

`mf_users` already exposes `first_active_date` and `first_recharge_date` as `type: time` dimensions. Period-bounded "new" metrics compose via hub-and-spoke joins.

| GDS # | Metric | Recipe |
|---|---|---|
| 11 | NRU | `mf_users.user_count_approx` + filter `first_active_date BETWEEN start AND end` |
| 25 | NPU | `mf_users.user_count_approx` + filter `first_recharge_date BETWEEN start AND end` |
| 26 | RevNPU | `recharge.revenue_vnd` + join filter `mf_users.first_recharge_date IN period` + `recharge.recharge_date IN period` |
| 27 | ARPNPU | RevNPU / NPU — client-side division OR add calculated measure (optional) |
| 28 | NNPU | `mf_users.user_count_approx` + both `first_active_date IN period` AND `first_recharge_date IN period` |

#### Optional YAML ergonomics (NOT required for POC v0)

If the dashboard layer wants single-query semantics, the following calculated measures are pure compositions of existing fields and add no new SQL primitives:

```yaml
# mf_users.yml
measures:
  - name: nru
    type: count_distinct_approx
    sql: user_id
    filters:
      - sql: "{CUBE}.ingame_first_active_date BETWEEN <date_range>"
  # ...similarly npu, nnpu via different filters

# In a view spanning recharge + mf_users
  - name: arpnpu_vnd
    sql: '{recharge.revenue_vnd} * 1.0 / NULLIF({mf_users.npu}, 0)'
    type: number
```

Decision: ship POC v0 with client-side composition; add the calculated measures only if the wizard/dashboard layer benefits.

---

## POC TOTAL — 21 of 53 GDS metrics (40%)

All 21 ship today against the 4 published cubes with no schema, ETL, or new YAML required (calculated measures listed above are optional).

---

## BEYOND POC — work required

### Tier 4 — Cohort + time-offset (needs query templates, not new data) — 8 metrics

Source data **exists** in the 4 cubes. The blocker is query shape: each requires a self-join or LEFT JOIN of a cohort anchor against a day-N offset event, which the current YAML doesn't template. Implementable as a Cube `multi_stage` measure or a SQL view.

| GDS # | Metric | Cohort anchor | Day-N event |
|---|---|---|---|
| 31 | Ruser(n) | `mf_users.first_active_date` = report_date | `active_daily` row at `log_date = report_date + n` |
| 32 | RR(n) | same | Ruser(n) / NRU |
| 33 | Rpuser(n) | `mf_users.first_recharge_date` = report_date | `recharge` event at `recharge_date = report_date + n` |
| 34 | RP(n) | same | Rpuser(n) / NPU |
| 35 | APR(n) | `mf_users.first_recharge_date` = report_date | `active_daily` row at day n |
| 38 | RevNRU(n) | `mf_users.first_active_date` = report_date | sum `recharge.revenue_vnd` over `log_date BETWEEN day 0..n` |
| 39 | LTV(n) | same | RevNRU(n) / NRU |
| 29 | RevNNPU | NNPU cohort + revenue in period | Same shape as RevNPU but with NNPU filter |
| 30 | ARPNNPU | RevNNPU / NNPU | Trivial once #29 lands |

**Recommendation v0.5:** Deliver one worked retention example (`RR07`) and one cumulative LTV example (`LTV07`) as a query template. Once the template proves out, the n-grid (01/03/07/14/21/30/60/90...) is a parameterization, not new design.

### Tier 5 — Needs new YAML or new cubes (source data exists, schema gap) — 5 metrics

| GDS # | Metric | Gap |
|---|---|---|
| 36 | RevRPI(n) | Needs install-cohort. `mf_users.install_date` exists but is NULL for organic/pre-attribution users — coverage gap to resolve. If acceptable, this is Tier 4-shaped (cohort + cumulative offset). |
| 41 | New Role | Needs a roles cube with `role_first_active_date` anchor. `recharge.role_id` and `active_daily.role_id` exist but no per-role first-active table. |
| 42 | Active Role | Same — needs a roles cube (`role_active_daily` shape). |
| 43 | New Paying Role | Same — needs a roles cube with `role_first_recharge_date`. |
| 44 | Paying Role | Same. |

### Tier 6 — Needs new data sources (no source in the 4 cubes) — 19 metrics

| GDS # | Metric | Missing source |
|---|---|---|
| 1 | Cost | Marketing platform (Google/FB/TikTok/ASA + AppsFlyer aggregator) |
| 2 | Impressions | Marketing |
| 3 | Clicks | Marketing |
| 4 | CTR | Marketing (Clicks / Impressions) |
| 5 | Installs | AppsFlyer (MMP) |
| 6 | Paid Install | AppsFlyer |
| 7 | Organic Install | AppsFlyer |
| 8 | CTI | AppsFlyer + Marketing |
| 9 | CPI | Marketing + AppsFlyer |
| 10 | CPN | Marketing + In-game (have NRU; need Cost) |
| 12 | NRU/Install Rate | Need Installs from AppsFlyer |
| 21 | Gross Bookings | Billing system |
| 37 | ROAS(n) | Marketing Cost + Install-cohort revenue |
| 40 | MKT/Rev | Marketing Cost |
| 49 | CCU | CCU API (real-time sampling, separate ingestion) |
| 50 | ACU | CCU API |
| 51 | PCU | CCU API |
| 52 | LCU | CCU API |
| 53 | CVR {Funnel Steps} | SDK funnel events table |

Required upstream work before any of these can be modeled:
- **MMP/Marketing cube** — daily-grain spend, impressions, clicks, installs by media_source / campaign_id, joined to `mf_users.appsflyer_id`.
- **Billing cube** — gross booking transactions, distinct from `recharge` (which is in-game delivery).
- **CCU cube** — minute/hour-grain online samples; or a derived `ccu_hourly` rollup.
- **Funnel/SDK events cube** — pre-install funnel steps keyed by `appsflyer_id`.

---

## Coverage summary

| Tier | # Metrics | Status |
|---|---|---|
| 1 — Existing measure | 8 | ✅ Ship v0 |
| 2 — Measure + time/segment | 8 | ✅ Ship v0 |
| 3 — Cohort filter on mf_users | 5 | ✅ Ship v0 |
| **POC v0 total** | **21** | **40% of GDS** |
| 4 — Cohort + time-offset templates | 8 | ⏳ v0.5 (template work, no new data) |
| 5 — Needs new YAML (roles cube, install-cohort) | 5 | ⏳ schema gap |
| 6 — Needs new data sources (Marketing/MMP/Billing/CCU/Funnel) | 19 | ⏳ ingestion gap |
| **GDS total** | **53** | |

---

## Implementation checklist for POC v0

1. Build a query catalog (JSON or YAML side-file) listing the 21 Tier 1–3 metrics, each with its Cube query payload (`measures`, `dimensions`, `timeDimensions`, `filters`, `segments`).
2. For period-scoped ARPU and daily/weekly/monthly Paying Rate (Tier 2 caveat) — pick (a) client-side division or (b) one calculated measure in a new `views/user_360.yml`. Default to (a) for v0.
3. Smoke-test each metric against the live cube at three granularities (day/week/month) and three segments (`vn_users`, `whales`, `paid_install`).
4. Document tenant scoping: every query carries `mf_users.gds_bundle_code = 'ballistar_vn'` until multi-tenant lands.
5. Surface HLL `~1.6%` error on all distinct-count metrics in the UI tooltip.

---

## Unresolved questions

1. **Revenue delivery-date semantics** — parked per scope decision #1. Flag for finance/audit conversation when GDS Revenue is used in revenue-recognition contexts; for product dashboards charge≈delivery is fine.
2. **`mf_users.install_date` NULL coverage** — confirms NRU per GDS uses `first_active_date` (handled). But this blocks any install-cohort metric (#36 RevRPI, #37 ROAS) for organic users. Need a separate decision on whether organic users are excluded from install-cohort metrics, or whether `first_active_date` is the accepted proxy anchor.
3. **Exact-vs-approx escalation path** — when does the dashboard need exact (`dau_exact`, `paying_users_exact`)? Finance close? Audit? Need a UI affordance to switch.
4. **Period-scoped ARPU/Paying Rate routing** — client-side vs. cube view. Decide before v0 ships so analysts learn one shape, not two.
5. **Tier 4 promotion criterion** — what triggers retention/LTV from "v0.5" to "v1"? One worked example landing, all dashboards needing it, or a specific stakeholder ask?
