# LiveOps Monitoring Center — Data Readiness Report

**Phase 00 deliverable.** Read-only investigation. Date: 2026-06-24 (GMT+7). All claims cite `file:line`.

## Verdict summary

| Surface | Phase | Verdict | Note |
|---------|-------|---------|------|
| Lifecycle flow (Sankey) | 04 | **DERIVE → GO** | `mf_users.lifecycle_stage` exists on all 8 games; transitions forward-only (no backfill). No new rollup *required* for weekly v1. |
| Monetization SKU card | 05 | **BUILD** | `recharge.product_id` on cfm+jus; jus adds `product_name` (in pre-agg). |
| Portfolio (All games) | 07 | **GO** | Clean common KPI subset via `game_key_metrics` + `active_daily` + `retention` + `mf_users`, all 8 games. |
| Nav revive | 01 | **RESTRUCTURE-ONLY** | `liveops` default-visible + default-on feature. No un-blocklist/role change. |
| Ops-overview reuse | 01 | **LIFT-AS-IS** | Game-scoped; "All games" needs Phase-07 fan-out variant. |

---

## 1. Lifecycle states (Phase 04) — DERIVE → GO

**`mf_users.lifecycle_stage` is a modeled bucketed dimension on ALL 8 games** (cfm `cube-dev/cube/model/cubes/cfm/mf_users.yml:239-255`; identical in jus + 6 others). Buckets: `active_today` → `active_7d` → `active_30d` → `dormant` → `churned`, derived from `days_since_last_active = DATE_DIFF('day', ingame_last_active_date, CURRENT_DATE)`.

Supporting fields present on all games: `install_date`, `first_active_date`, `last_active_date`, `days_since_last_active`, `is_paying_user`, `days_since_last_recharge`, `churn_risk`, `engagement_segment`.

### Chosen state rule (recency windows)
| State | Predicate | Meaning |
|-------|-----------|---------|
| **New** | `install_date >= CURRENT_DATE - 7d` | fresh install cohort |
| **Core** | `(active_today OR active_7d) AND is_paying_user` | engaged + monetizing |
| **Lapsing** | `active_7d..active_30d AND is_paying_user AND days_since_last_recharge <= 30` | at-risk payer (matches `churn_risk = at_risk`) |
| **Reactivated** | `churned AND days_since_last_active < 28 AND days_since_last_recharge <= 7` | recently returned |
| **Churned** | `(churned OR dormant) AND (NOT is_paying_user OR days_since_last_recharge > 30)` | inactive + not monetizing |

### Transition source (last-week → this-week)
`mf_users` holds **current state only** (recency recomputed daily, no history) — so transitions cannot be read retroactively from it. Two viable paths, decided in Phase 04:
- **(Primary) segment-membership snapshot delta** — nightly job writes full membership + entered/exited delta to Iceberg `stag_iceberg.khoitn.segment_membership_daily` / `segment_membership_delta` (`server/src/jobs/snapshot-segment-membership.ts:1-511`; `server/src/lakehouse/segment-delta-writer.ts:55-133`). Define the 5 states as predicate segments, snapshot daily, diff with the existing overlap machinery (`server/src/lakehouse/segment-overlap-counts.ts:46-95`). **Forward-only — no backfill of weeks before the segments exist.**
- **(Fallback) recompute from history** — `std_ingame_user_active_daily` (one row per user per active day, the source behind `lifecycle_stage`) can reconstruct state at any past date in a backend service; heavier Trino scan.

**No new serve-layer rollup is required for weekly v1.** Daily granularity *would* need a rollup → keep Phase 04 at **weekly**, forward-only, disclose "history starts <activation date>" in the UI.

Games: all 8 carry `lifecycle_stage` + supporting fields. cfm_vn / jus_vn ship first; others "available".

---

## 2. SKU / pack revenue (Phase 05) — BUILD

| Game | SKU dimension | Product text | Revenue measure | Currency |
|------|---------------|--------------|-----------------|----------|
| cfm_vn | `recharge.product_id` (`cfm/recharge.yml:137`); also `user_recharge_daily.product_id` (`:80-82`) | — | `revenue_vnd_real` (`cfm/recharge.yml:228-234`), `billing_detail.cash_charged_gross` (`cfm/billing_detail.yml:158-161`) | VND-only |
| jus_vn | `recharge.product_id` (`jus/recharge.yml:165-166`) + **`product_name`** (`:169-171`) | yes | `recharge.revenue_vnd` (filter `currency='VND'`), `billing_detail.cash_charged_gross` (`jus/billing_detail.yml:152-155`) | **mixed USD+VND** (`jus/billing_detail.yml:63 mixed_currency:true`); filter `currency='VND'` (`jus/recharge.yml` segment `vnd_only`) |

jus pre-agg includes `product_name` (`jus/recharge.yml:271-303`, line 281) → SKU revenue partially materialized. billing_detail rollups do **not** carry SKU dims → SKU-by-`billing_detail` is a full Trino scan; prefer `recharge` for SKU breakdown.

**SKU card = BUILD** for cfm+jus. Tier / LTV / concentration cards use `mf_users.{payer_tier,ltv_total_vnd,user_count}` + `revenue_vnd_real` (no SKU needed). Other games: render "SKU data not available".

---

## 3. Cross-game KPI parity (Phase 07) — GO

8 local-workspace games: **ballistar, cfm, cros, jus, muaw, ptg, pubg, tf**.

### Common KPI subset (present on ALL 8 — portfolio grid queries these, no fallback)
| KPI | Cube.measure | Type |
|-----|--------------|------|
| DAU | `active_daily.dau` | distinct-approx |
| User count | `mf_users.user_count` | sum |
| Revenue (VND) | `game_key_metrics.rev` | sum — **portfolio revenue source** (source-agnostic, all 8) |
| New payers | `game_key_metrics.npu` | sum |
| Conversion | `game_key_metrics.payer_rate` | number |
| ARPPU | `game_key_metrics.arppu_vnd` | number |
| D7 retention rate | `game_key_metrics.retention_d7` | number |
| Retention cohort counts | `retention.{cohort_size,retained_d1,retained_d7,retained_d30}` | sum |

### Per-game gaps (do NOT use in the common grid)
- `billing_detail.*` — **cfm + jus only** (cross-catalog `iceberg.billing` onboarded for A49/A70 only; `cfm/billing_detail.yml:54`, jus same). Payment-gateway drill = cfm/jus secondary panel, not portfolio.
- `recharge.revenue_vnd_real` — **cfm only**.
- `recharge.paying_users` — **absent on tf** (`tf/recharge.yml:126-142` exposes `paying_roles`/`paying_accounts`, role-grain). Portfolio uses `game_key_metrics.npu` instead → no tf special-case needed for the grid.

**Revenue rule:** portfolio uses `game_key_metrics.rev`; for cfm/jus money drill-downs use `billing_detail.cash_charged_gross` (jus VND-filtered). Never `recharge.revenue_vnd` (banned, ~9× inflated).

---

## 4. Nav visibility (Phase 01) — RESTRUCTURE-ONLY

- `liveops` is in `NAV_ITEMS` (`src/pages/Settings/use-visible-nav-items.ts:38`); blocklist model → missing entry = **visible by default** (`:44-53,96`).
- `featureForRoute('/liveops') → 'liveops'` (`src/auth/feature-access.ts:62`); `liveops` is **not** in `DEFAULT_OFF_FEATURES` (only `advisor`,`admin`; `:16`) → **default-on**.
- Sidebar already renders the section with 2 children — cohort + anomalies (`src/shell/sidebar/sidebar.tsx:176-185`).

⇒ "Revive" = **restructure into 5 children + a self-check that the section shows**. No un-blocklist, no role/feature change. Sub-items stay section-level toggled (no new `NavItemId`s needed unless we want per-tab toggles — out of scope).

---

## 5. Ops-overview reuse (Phase 01) — LIFT-AS-IS

- `OverviewTrends({ d, loading })` is **presentational** (`src/pages/OpsConsole/overview-trends.tsx:53`) — consumes `OpsOverviewData` from `use-ops-overview`.
- Query builders are pure + game-scoped via `gameId`+`OpsRange` (`src/pages/OpsConsole/ops-overview-queries.ts` — `billingDailyTrendQuery`, `dauDailyQuery`, etc.).

⇒ Command Center **lifts the `use-ops-overview` hook + `<OverviewTrends>` as-is** for the active game. "All games" mode (Phase 07) needs a fan-out variant that aggregates per-game results — not a change to these builders.

---

## Unresolved questions
1. Lifecycle "Reactivated" — count only Churned→active, or also Active→Dormant→Active? (default: churned + returned <28d; refine with LiveOps PM.)
2. Lifecycle transitions are **forward-only** under the segment-snapshot path (no history before segments activate) — accepted? (recommend: accept, no backfill.)
3. jus pre-agg `revenue_daily_by_channel_batch` (`jus/recharge.yml:271-303`) — actively sealing or cold like other jus rollups? (affects SKU card latency.)
4. cfm/jus product catalog (name/category/tier for `product_id` display) — exists as a joinable model, or show raw ids? (Phase 05 detail.)
