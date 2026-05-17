# Research Report — Metric-Creation Types for cube-playground's New-Metric Flow

**Date:** 2026-05-17
**Inputs:**
- `metrics-catalogue/cube/model/cubes/*.yml` (mf_users, active_daily, recharge, user_recharge_daily) + `views/user_360.yml`
- `hermes/design-reference/Hermes/uploads/liveops_2026_campaign_requirements.md` (47 campaigns, 6 categories)
- Current new-metric wizard: `src/QueryBuilderV2/NewMetric/full-page/**` (6-step) with `operations.ts` defining the 11 supported ops

## Executive Summary

Today's wizard ships **a single artifact** — a Cube `measure` built from one of 11 aggregation ops (sum / count / count_distinct / avg / min / max / median / percentile / ratio / weightedAvg / formula) + a filter tree + identity meta. That covers ~30% of what the liveops 2026 calendar reads from User Stage. The remaining ~70% are higher-order patterns that Cube and MetricFlow already model natively but the wizard cannot author: **rolling windows, time-shifts, cumulative/lifetime aggregations, derived `case` dimensions, named segments, conversion/funnel metrics, retention curves, time-since-event dimensions, and cohort snapshots.**

The recommendation is **not** to bolt on streaming/state-machine primitives (streaks, consecutive-loss counters, set-typed attributes) — those belong to the Journey engine per the liveops architecture, not to the Cube semantic layer. Limit scope to **what Cube's data model supports natively** and ship in 4 tiers ordered by `(Cube native support) × (wizard UX delta) × (campaign coverage)`.

## What the wizard authors today

- **Artifact:** `measures:` block written to a single cube's YAML.
- **Ops (11):** sum, count, count_distinct (incl. approx), avg, min, max, median, percentile, ratio (A/B), weightedAvg (v·w / w), formula (a+b−c).
- **Step 4 filter tree:** boolean tree → flattens to a SQL predicate on `filters:` of the measure.
- **Identity:** name, description, tags, `meta.grain`, `meta.visibility`.
- **What's missing from the artifact set:** dimensions, segments, pre-aggregations, joins, time-windowed measures, multi-stage / time-shifted measures, conversion metrics, retention measures, cohort snapshots.

## Gap matrix — campaign metrics → current wizard

Sampled load-bearing metrics from the calendar; "Wizard?" = can the existing 6-step build it as-is.

| Campaign metric | Pattern | Cube primitive | Wizard today? |
|---|---|---|---|
| `lifetime_match_count`, `lifetime_login_days` | Lifetime aggregation (sum / count on event table) | measure type=sum/count | ✅ |
| `paying_users`, `whales_count` | Filtered count_distinct | measure + filters | ✅ partial (UX buries it) |
| `last_login_at`, `last_recharge_at` | First/last timestamp | measure type=max(time) | ✅ partial (no UX framing) |
| `match_played_count_last_7d`, `housing_interaction_count_30d` | Rolling N-day window | `rolling_window` | ❌ |
| `current_streak_days` | Streak / consecutive | window function + reset | ❌ (Journey-internal anyway) |
| `consecutive_loss_count >= 5` | Stateful streaming predicate | — | ❌ (Journey-internal) |
| `login_days_2026`, `gem_spend_2026` | Annual / season window | filtered sum + year filter | ❌ (no calendar-window UI) |
| `days_since_install`, `days_since_last_recharge` | Time-since-event | `DATE_DIFF` dimension | ❌ (wizard doesn't make dims) |
| `payer_tier`, `recharge_tier`, `txn_value_band_vnd`, `lifecycle_stage` | Tier-banding / derived classification | `case` dimension | ❌ |
| `vn_users`, `whales`, `at_risk_paying`, `paid_install` | Named cohort | `segments:` | ❌ |
| `recall sent → returned` (CFM-4), `IAM fired → 24h pack purchase` (CFM-12), `tier-1 → tier-4 visible` (COS-3) | Conversion within window | MetricFlow `conversion` | ❌ |
| D1/D7/D14/D30 by chapter depth (TF-1), holdout uplift on retention | Retention curve | event-analytics primitive | ❌ |
| "Wave-1 participants Past Segment" (CFM-5) | Cohort snapshot / past-segment | snapshot users at T | ❌ |
| `lifetime_owned_items` set, `purchased_pack_ids` set | Array / set attribute | ARRAY_AGG | ❌ (out of scope) |
| `mong_hoa_luc_popularity_score`, `anti_fraud_trust_score` | External signal | External Signal Adapter | ❌ (out of scope) |

## State-of-the-art reference (what to copy)

- **MetricFlow (dbt Semantic Layer)** — 5 metric kinds: **simple, ratio, cumulative, derived, conversion**. Conversion = base + conversion event within a time window with attribution; cumulative = window function over a grain; derived = arithmetic on other metrics. This is the cleanest taxonomy for a metric-builder.
- **Cube** — natively supports the same patterns plus **`rolling_window`** (window over time dim) and **`time_shift`** (prior/next interval; powers period-over-period). Filtered measures and `case` dimensions are first-class. Multi-stage calculations & dynamic measures are available.
- **Amplitude / Mixpanel** — event-analytics UX wisdom: a *Custom Event* is a saved combination of events + property filters reused across funnel / retention / cohort surfaces. Funnel, retention curve, frequency (stickiness), lifecycle stage are all UI-first metric types, not SQL. Mixpanel's "Custom Events" is the closest cousin to a named segment + filtered measure rolled into one.
- **Lightdash** — "custom metric" / "custom dimension" UI-on-the-fly (aggregate ops, binning, filters) layered on dbt models. Reinforces the pattern: **metric and dimension creation must coexist in the same builder**; today's wizard only makes measures.
- **LookML / Looker** — `measure: type: count` with `filters:`, `dimension: case:` for tier banding, `derived_table`, parameterized fields. All of this maps 1:1 to Cube YAML.

## Proposed roadmap — ranked by complexity (ascending)

Each tier groups items by Cube-native support + wizard UX delta. Coverage = approximate # of campaigns/metrics unblocked.

### TIER 1 — Trivial. Same Cube primitives, light UX (1–2 days each)

**1.1 Conditional measure (filtered count / sum) as a top-level op**
*Status: Cube ✅ today (Step 4 filter tree already exists). UX: promote it from "advanced filter" to a first-class op picker entry.*
- Adds a UI pre-step: "Count X **where** Y" / "Sum X **where** Y" templates.
- Maps to: `paying_users`, `whales_count`, `lapsed_this_month_count`, `paying_users_30d`, every `count_distinct` with a predicate.
- Coverage: ~15 measures.

**1.2 First/last-of-X timestamp measure**
*Status: Cube ✅ (min/max on time dim). UX: rename pattern + offer "first event date" / "latest event date" templates.*
- Maps to: `last_login_at`, `last_recharge_at`, `first_active_date`, `account_first_login_at`.
- Coverage: ~10 calendar metrics.

**1.3 Time-since-event dimension** *(introduces dimension-output mode)*
*Status: Cube ✅ (`DATE_DIFF` SQL dimension type=number). UX: dimension authoring entry on Step 2 selector.*
- Builder slots: "Time since {time dim}" → emits `dimensions:` entry.
- Maps to: `days_since_install`, `days_since_last_active`, `days_since_last_recharge`, `account_age_days`.
- Coverage: ~8 calendar metrics + foundation for tier-banding.

**1.4 Tier-banding / derived `case` dimension**
*Status: Cube ✅ (`case: when/else`). UX: visual band builder (N rows of `condition → label`).*
- Maps to: `payer_tier`, `recharge_tier`, `txn_value_band_vnd`, `lifecycle_stage`, `gem_tier_banding` (CFM-9), `mong_hoa_luc_tier`.
- Coverage: ~6 derived dimensions, blocking pattern for multi-segment branching (PT-6/10, CFM-11).

### TIER 2 — Moderate. Cube primitive exists, new dedicated step

**2.1 Rolling window measure**
*Status: Cube ✅ (`rolling_window: { trailing: 7 day }`). UX: new "Window" step between op + filters.*
- Form: "Aggregate {column} over **trailing {N} {unit}**".
- Maps to: `match_played_count_last_7d`, `housing_interaction_count_30d`, `friend_session_overlap_count_today`, all "last_Nd" counters.
- Coverage: ~12 calendar metrics. NSM for ~6 retention campaigns.

**2.2 Time-shift / period-over-period derived measure**
*Status: Cube ✅ (`time_shift`). UX: "Compare to" toggle on any existing measure → emits a sibling measure or a Δ% measure.*
- Maps to: every WoW / MoM / YoY monitoring panel; "Daily completion rate target band WoW" (TF-2), retention uplift vs holdout.
- Coverage: monitoring rollup B6, not a calendar primary read.

**2.3 Cumulative / running-total measure**
*Status: Cube ✅ via unbounded rolling window OR a lifetime aggregation pre-aggregated upstream in `mf_users`. UX: "All-time total" / "Running sum" template.*
- Maps to: lifetime aggregations the calendar reuses heavily — `lifetime_match_count`, `lifetime_kill_count`, `lifetime_headshot_count`, `lifetime_revive_count`, `lifetime_login_days`, `lifetime_recharge_total`, `lifetime_owned_items_count`.
- Coverage: ~14 calendar metrics (CFM-3/6/10, NTH-10, PT-1/11). Pattern 1 of Part C in the spec.

**2.4 Calendar-window aggregation (annual / monthly / season)**
*Status: Cube partial — requires a year-bound filter + grain-locked measure. UX: "Window = current year / season / month" picker.*
- Maps to: `login_days_2026`, `match_count_2026`, `gem_spend_2026`, `hours_played_2026`, `total_concert_score` (final-window).
- Coverage: ~6 metrics, the entire CFM-11/NTH-10/PT-11 contribution-tiering pattern. Spec flags this as a real platform gap ("annual `time_grain` with year-rollover").

### TIER 3 — Significant. New artifact type beyond `measures:`

**3.1 Named segment builder** *(outputs `segments:` not `measures:`)*
*Status: Cube ✅ (`segments:` is a first-class field). UX: new "What to create" Step 1 toggle — Measure / Dimension / Segment.*
- Reuses Step 4 filter tree exactly. No aggregation step.
- Maps to: every campaign's entry-condition predicate (~40 campaigns). Spec hard requirement in B5 ("Segment Builder v2"). Lays the groundwork for "multi-segment, mutually-exclusive payload branching" (Pattern 2).
- Coverage: ~all 47 campaigns.

**3.2 Conversion / funnel measure** *(MetricFlow `conversion`)*
*Status: Cube needs derived SQL (cross-cube join with time-bound). UX: "Base event → Conversion event within {window}" 2-event picker.*
- Slots: base measure, conversion measure, attribution window, optional per-entity filter.
- Maps to: recall conversion (CFM-4), IAM → 24h purchase (CFM-12/16/17/18), step-up tier conversion (COS-3), tier funnel (CFM-9), vote→buy (CFM-2), invite→accept (PT-2).
- Coverage: ~10 monetization + recall campaigns. **High strategic value — direct ROI measurement of every IAM journey.**

**3.3 Retention curve measure**
*Status: not natively in Cube — express via self-join on `active_daily` with day-N offset. UX: "Cohort entry event + Return event + D1/D3/D7/D14/D30 grid".*
- Maps to: D1/3/7/14 by chapter depth (TF-1), next-session retention vs holdout (CFM-13), D7 of recall-attributed vs organic (CFM-4), D14 retention of Power Player vs S1 baseline (COS-1), monitoring B6 "Uplift vs holdout".
- Coverage: ~all 47 campaigns at monitoring layer. Pairs with 3.2.

**3.4 Cohort snapshot / past-segment carryover**
*Status: Cube does not natively support — requires a snapshot table written by an upstream job, then Cube reads it as a regular dimension/segment. UX: "Snapshot this segment **at {date}** for later reuse" + a Past-Segment Registry surface.*
- Maps to: CFM-5 wave-1 participants targeting wave-2, every "Past Segment" mentioned in the spec, all post-event retro cohorts.
- Coverage: ~5 campaigns now, every retro analysis perpetually. Spec flags this in B5 ("cross-wave cohort carryover").

### TIER 4 — Hard / out of scope. Defer or push to Journey

| Item | Why it shouldn't live in this wizard |
|---|---|
| Streak / consecutive-count-with-reset (`current_streak_days`, `consecutive_loss_count`) | Stateful streaming primitive. Spec puts these in Journey-internal state (B4) or User Stage event-time (~10% of metrics). Not a Cube semantic-layer concern. |
| Set / array attribute (`lifetime_owned_items`, `purchased_pack_ids`) | Cube measures don't model sets cleanly; either materialize as upstream array column or model as a many-to-many filter pattern. Defer until Tier 1–3 ship. |
| Custom-dimension / taxonomy registry (weapon lists, promoted items, playstyle taxonomy) | Belongs to the Custom Dimensions service in B5, not the metric wizard. The wizard *consumes* taxonomies (as filter dropdown values), it doesn't *manage* them. |
| External Signal Adapter outputs (`mong_hoa_luc_popularity_score`, `anti_fraud_trust_score`) | Ingestion concern, not authoring. Once written to User Stage, they appear as ordinary dimensions and Tier 1–3 builders work on them. |
| Real-time / event-time measures (`current_gem_balance`, `cf_coin_balance`, `current_oven_crown`) | Authoring concept (just `meta.grain: event-time`) is trivial; the hard part is the **stream-materialization pipeline** behind it, which is platform infrastructure, not a wizard feature. Surface a grain-picker in identity Step 5 and let the pipeline fail loud if grain ≠ supported. |

## Coverage scorecard

| Tier | Items | Calendar metrics unblocked (est.) | Cube primitive | Eng effort |
|---|---|---|---|---|
| 1 | 4 | ~39 | all native | S |
| 2 | 4 | ~32 | all native | M |
| 3 | 4 | ~all 47 at monitoring + journey-entry layer | mixed (3.4 needs upstream) | L |
| 4 | 4 | (deferred) | not Cube | XL / wrong layer |

Tier 1+2 alone covers ~70 of the calendar metric instances and **all of Pattern 1 (lifetime-stat interpolation)** and **Pattern 6's consumption side (external signals as dims)**. Tier 3 unlocks **Patterns 2 (multi-segment branching), 4 (per-user activation clocks — requires Past Segment), and the universal monitoring rollup (B6)**.

## Concrete proposal for the next wizard iteration

Add a **"What are you creating?"** entry choice on Step 1 (currently fixed to *measure*):

```
○ Measure         (today's flow + Tier 1.1, 1.2, 2.x cumulative/rolling/timeshift)
○ Dimension       (Tier 1.3 time-since, 1.4 tier banding)
○ Segment         (Tier 3.1 named cohort)
○ Conversion      (Tier 3.2 — picks two existing measures)
○ Retention       (Tier 3.3 — picks entry + return events)
```

Per-mode, Steps 2–4 reshape:
- Measure: keep current 6-step exactly + optional **Window** sub-step (rolling, cumulative, calendar-bound, time-shift).
- Dimension: Step 2 picks dim kind (case-banding / time-since / formula), Step 3 fills bands or DATE_DIFF args.
- Segment: skip op + window; keep filter tree only; emits `segments:`.
- Conversion / Retention: Step 2 = base & target event pickers (existing measures), Step 3 = attribution window + cohort definition.

Identity Step 5 (`meta.grain`) is the spec's `time_grain` field — keep it, expand enum to `event-time / 5min / hourly / daily / weekly / monthly / annual / custom`.

## Sequencing recommendation

1. **Sprint 1** — Tier 1 (1.1 / 1.2 / 1.3 / 1.4). Adds dimension-output mode and 4 low-risk patterns. Unblocks tier-banding for multi-segment campaigns and time-since for activation clocks.
2. **Sprint 2** — Tier 2.1 + 2.3 (rolling window + cumulative). Highest single-sprint coverage gain; unblocks lifetime-stat interpolation across 14 campaigns.
3. **Sprint 3** — Tier 3.1 (named segment) + Tier 2.4 (calendar window). Segment authoring is the long-pole for Pattern 2 and Q4 contribution-tiering. Pair with 2.2 (time-shift) for monitoring panels.
4. **Sprint 4** — Tier 3.2 (conversion) + Tier 3.3 (retention). Direct ROI measurement of every IAM and journey. Lights up B6 monitoring rollup.
5. **Backlog** — Tier 3.4 (cohort snapshot) once a snapshot writer exists upstream; Tier 4 items only after the Journey engine + External Signal Adapter ship.

## Risks

- **Tier 3.4 (cohort snapshot)** depends on an upstream snapshot writer that does not exist in cube-playground today. Ship the *consumer* surface (drop-down list of snapshotted cohorts) and provision the writer separately, or it's a dead button.
- **Tier 2.4 annual window** semantics need a `valid_from` story (the spec calls out year-rollover as an explicit gap). Ship as "filter on year column" first; add proper rolling-annual once `mf_users` exposes a year-bound aggregate column.
- **Tier 3.2 conversion** quality depends on event-time freshness of the conversion event. If conversion event is daily-grain but base event is hourly, attribution windows < 1d return zero. Surface this in the wizard with a "freshness mismatch" warning at draft time.
- **Naming collision** between the 11 existing ops and the new metric-type taxonomy: today's `ratio` and `formula` ops are "derived metrics" by MetricFlow's taxonomy. Decide whether to fold them under a new top-level **Derived** type or keep them as ops within **Measure**. Recommend keeping them as ops to avoid breaking deep-linked wizard URLs.

## Unresolved questions

- Should **`event-time` grain** authoring be gated behind a separate approval workflow (since it requires stream-materialization pipeline support) or visible to all wizard users with a "pipeline must support" warning?
- Are **segments authored via the wizard** writeable to the live `cubes:` YAML, or do they need a separate `segments-overlay` file to keep author boundaries clean (similar to how cube aliases are localStorage today)?
- Is **conversion / retention** output a *Cube measure* (cross-cube derived) or a *separate Funnel/Retention surface*? MetricFlow encodes them as metrics; Amplitude/Mixpanel ship dedicated builders. Decision affects whether YAML preview in Step 5 stays unified.
- Does **Tier 3.4 cohort snapshot** belong to this wizard at all, or to a parallel "Past Segment" surface in Campaign Hub (B5)? Pragmatically, the snapshot is a campaign-tool concern, not a semantic-layer concern.

---

## Sources

- [Creating metrics — dbt Developer Hub](https://docs.getdbt.com/docs/build/metrics-overview)
- [About MetricFlow — dbt Developer Hub](https://docs.getdbt.com/docs/build/about-metricflow)
- [Metric properties — dbt Developer Hub](https://docs.getdbt.com/reference/metric-properties)
- [Metrics as Code — Towards Data Engineering](https://medium.com/towards-data-engineering/metrics-as-code-building-a-semantic-layer-with-dbt-and-metricflow-93d7e29e6ab3)
- [Measures — Cube documentation](https://cube.dev/docs/product/data-modeling/reference/measures)
- [Calculating period-over-period changes — Cube documentation](https://cube.dev/docs/product/data-modeling/recipes/period-over-period)
- [Multi-stage calculations — Cube documentation](https://cube.dev/docs/product/data-modeling/concepts/multi-stage-calculations)
- [Custom Events — Mixpanel Docs](https://docs.mixpanel.com/docs/features/custom-events)
- [Using custom fields — Lightdash](https://docs.lightdash.com/references/custom-fields)
- [An intro to metrics and dimensions — Lightdash](https://docs.lightdash.com/get-started/setup-lightdash/intro-metrics-dimensions/)
- [5. Create Metrics — GoodData Cloud](https://www.gooddata.com/docs/cloud/getting-started/create-metrics/)
