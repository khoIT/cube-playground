# Measures, Dimensions, Segments — Mental Model for the New-Metric Wizard

**Date:** 2026-05-17
**Companion to:** [`research-260517-metric-creation-types-roadmap.md`](./research-260517-metric-creation-types-roadmap.md), [`research-260517-tier1-tier2-metric-types-detail.md`](./research-260517-tier1-tier2-metric-types-detail.md)
**Why this doc:** the wizard today creates one artifact (a measure). The 2026 liveops calendar needs three. This is the concise *why*, *what*, and *when* for each.

## TL;DR

Cube splits "what users can query" into three artifact types, each with a non-overlapping job:

| Artifact | Scope | One value per | Job |
|---|---|---|---|
| **Dimension** | Row | Row | Describe each row — used in `SELECT`, `WHERE`, `GROUP BY` |
| **Measure** | Query result / group | Group | Aggregate across rows — used in `SELECT agg(...)`, `HAVING` |
| **Segment** | Row predicate, named | — | A reusable, named `WHERE` clause |

These are **different SQL scopes**, not the same concept at different speeds.

---

## The two mental models

### Decision tree — pick by question shape

```
What's the question?
│
├── "How many / how much / what's the avg of X?"          (one number out)
│       → MEASURE      (sum / count / count_distinct / avg / ratio / …)
│
├── "Which X has property Y?" / "Group by Y" / "Filter to Y"   (per-row attribute)
│       → DIMENSION    (case-band / time-since / direct column)
│
└── "Users matching condition Z, by name, reusable"        (reusable named cohort)
        → SEGMENT      (just a named WHERE clause)
```

### Decision table — pick by user intent

| If the user wants… | Artifact | Game-analytics example |
|---|---|---|
| "Total revenue / count / avg of X" | Measure | `revenue_vnd`, `dau`, `arpu_vnd` |
| "X per user, in a list / table" | Dim (often passthrough) | `ltv_vnd`, `last_login_date` |
| "X grouped by country/day/tier" | Measure + GROUP BY existing dim | revenue by `country_code` |
| "Bucket users into tiers" | Dim (`case`) | `payer_tier`, `lifecycle_stage` |
| "Filter users where X < N" | Dim — must exist as dim to be filterable | `account_age_days <= 10` |
| "Days since last X" | Dim (`DATE_DIFF`) | `days_since_install` |
| "DAU / MAU / approx unique" | Measure (HLL, mergeable) | `dau`, `mau`, `paying_users` |
| "WoW / MoM / Δ%" | Measure (uses `time_shift` on another measure) | `revenue_vnd_prev_month` |
| "Whales" / "VN paying users" — named, reusable | Segment | `whales`, `vn_users`, `at_risk_paying` |

---

## Why we need three (not one)

You cannot reduce the three to one without losing capability:

### 1. Dimensions cannot aggregate
- DAU on 5B events/day cannot live at row level. Counting needs aggregation.
- `count_distinct_approx` (HLL sketch) has merge semantics — daily sketches roll up to MAU without rescanning rows. **Structural, not optimization.**

### 2. Measures cannot filter rows pre-aggregation
- `WHERE payer_tier = 'whale'` works (dim).
- `WHERE whales_count > 0` is meaningless — the measure exists only after `GROUP BY`.
- Cube routes measure filters to `HAVING`, which filters *groups*, not *users*. The liveops Journey engine evaluates **one user at a time** → it needs dim-shaped filters.

### 3. Segments encode reusability dimensions/measures don't
- A dim is a column. A measure is an aggregation. A segment is a **named row predicate**.
- The "whales" definition (`ltv_vnd >= 10M`) appears in many campaign entries, dashboards, and LLM queries. Without segments, every consumer hand-rolls the predicate (drift + bugs). With segments, change the definition in one place.

### 4. Same column can wear two hats
The cleanest demo: `charged_value` in `recharge.yml` appears as:
```yaml
# Dimension — value of THIS transaction
- name: value_vnd
  sql: charged_value
  type: number

# Measure — SUM across many transactions
- name: revenue_vnd
  sql: charged_value
  type: sum
```
Both legitimate. Different scopes, different queries.

### 5. Pre-aggregation gating
Cube Store rollups (the speed layer) are declared in terms of **measures + dims**:
```yaml
pre_aggregations:
  - name: dau_by_country_payer_daily
    measures: [dau]                              # ← measure required
    dimensions: [mf_users.country, mf_users.payer_tier]
    time_dimension: log_date
    granularity: day
```
Without measures declared, there's nothing to pre-aggregate. ~200ms warm vs ~4s cold gain is **gated by** the measure declaration, not "as well as".

---

## Game-analytics cases — where each artifact matters

### Dimensions (per-row attributes)

| Scenario | Dim | From the calendar |
|---|---|---|
| NRU entry gate | `account_age_days` | COS-3, CFM-12, TF-1, ~15 campaigns filter on `<= N` |
| Recency check | `days_since_last_active`, `days_since_last_recharge` | `at_risk_paying`, churn campaigns |
| Tier-driven drop tables | `payer_tier`, `gem_balance_tier`, `vip_tier` | PT-6 / PT-10 / CFM-9 multi-segment branching |
| Lifecycle bucketing | `lifecycle_stage` | every monitoring rollup "by lifecycle" |
| Anniversary check | `account_first_login_mmdd` | PT-1 |
| Storytelling payload | `lifetime_kill_count`, `lifetime_headshot_count`, `lifetime_match_count` | CFM-3 / CFM-6 / CFM-10 personalized copy |
| Time grouping | `log_date`, `log_month`, `recharge_time` | every time-series chart |
| Custom-dim taxonomy | promoted weapon list, voting candidates, playstyle taxonomy | CFM-2 / CFM-17 / NTH-10 |

**Failure mode if you skip dim authoring:** the Journey engine can't write a per-user filter, the BI tool can't `GROUP BY`, the segment-builder DSL can't reference the property. Measures cannot rescue any of these — they live at the wrong scope.

### Measures (aggregations across rows)

| Scenario | Measure | From the catalogue / calendar |
|---|---|---|
| Daily KPI | `dau`, `mau` (`count_distinct_approx`) | every dashboard, MAU rollup via HLL merge |
| Revenue | `revenue_vnd` (`sum`) | every monetization campaign |
| Cohort counts | `paying_users`, `whales_count`, `lapsed_this_month_count` (filtered count_distinct) | weekly board reports |
| Average + ratio | `arpu_vnd`, `arppu_vnd`, `paying_rate` | every monetization NSM |
| Trailing window | `match_count_last_7d`, `housing_interaction_count_30d` | COS-1 Power Player gate, NTH-3 eligibility |
| Period-over-period | `revenue_mom_pct`, `dau_wow_pct` | CFM-1/4/8 monitoring panels |
| Calendar-window | `login_days_2026`, `gem_spend_2026` | CFM-11 / NTH-10 / PT-11 contribution tiering |
| Conversion rate | IAM-fired → 24h purchase | CFM-12 / 16 / 17 / 18 (Tier 3 — later) |

**Failure mode if you skip measure authoring:** "show me revenue by channel" returns 12M raw rows the client can't render; DAU computed in JS from 4.8M user_ids freezes the browser; Cube Store has nothing to pre-aggregate, so every query goes to Trino cold.

### Segments (named row predicates)

| Scenario | Segment | From the catalogue / calendar |
|---|---|---|
| Country cohort | `vn_users` | most VN campaigns |
| Spend cohort | `whales`, `paying_lifetime`, `paying_recently_30d` | every monetization read |
| Risk cohort | `at_risk_paying` | CFM-4 recall targeting, churn-prevention |
| Acquisition cohort | `new_install_7d`, `paid_install` | CFM-12 NRU pack, TF-1 onboarding |
| Engagement cohort | `last_7d`, `last_30d`, `yesterday` | every recall / retention campaign |
| Wave-1 carryover | "users who participated in CFM-5 wave 1" | CFM-5 wave 2 targeting (snapshot — Tier 3.4 later) |
| Channel split | `iap`, `web` | revenue dashboards |

**Failure mode if you skip segment authoring:** every campaign hand-rolls "VN whales who are at risk" (`country = 'VN' AND ltv >= 10M AND last_active BETWEEN 7d-30d ago`). Three definitions drift apart over six months. The LLM-driven segment-builder can't compose ("VN" + "whales" + "at risk") if there's nothing named to compose with.

---

## The grain question — first thing the wizard should answer

Before picking an artifact, the wizard needs to know what **one row of the chosen cube represents**:

| Cube | One row = | Examples of natural dims | Examples of natural measures |
|---|---|---|---|
| `mf_users` | 1 user (lifetime, pre-aggregated upstream) | `country`, `ltv_vnd`, `payer_tier`, `last_login_date` | `user_count`, `ltv_total_vnd`, `paying_rate` |
| `active_daily` | 1 user-day of activity | `user_id`, `log_date`, `country_code`, `online_time_sec` | `dau`, `mau`, `total_online_time_sec` |
| `user_recharge_daily` | 1 user-day of recharge | `user_id`, `log_date`, `vip_level`, `revenue_vnd` | `revenue_vnd_total`, `txn_count_total`, `paying_users` |
| `recharge` | 1 transaction | `transaction_id`, `payment_channel`, `value_vnd`, `is_first_recharge` | `revenue_vnd`, `count`, `arppu_vnd` |

**Same column can be a dim in one cube and a measure in another** (or both in the same cube). The grain determines which makes sense by default.

---

## Boundary rules — what each can/cannot do

| Operation | Dim | Measure | Segment |
|---|---|---|---|
| `WHERE` filter (pre-aggregation) | ✅ | ❌ | ✅ (a named WHERE) |
| `GROUP BY` | ✅ | ❌ | ❌ |
| Referenced by `segments:` SQL | ✅ | ❌ | ❌ (segments compose at query time, not in YAML) |
| Referenced by another measure's `sql:` | via column | ✅ (`{name}`) | ❌ |
| Referenced by another measure's `filters:` | via column | ❌ | ❌ |
| Drives chart axis vs value | Axis | Value | Filter chip |
| Pre-aggregation `dimensions:` slot | ✅ | ❌ | ❌ |
| Pre-aggregation `measures:` slot | ❌ | ✅ | ❌ |
| LLM / segment-builder predicate | ✅ | ❌ | ✅ |
| Returns per-user values | ✅ | ❌ (returns one number) | — (selects users) |

The line `WHERE ltv_vnd >= 10M` evaluates per-row (dim or segment). The line `HAVING SUM(ltv_vnd) >= 10M` evaluates per-group (measure). Different result sets. Not interchangeable.

---

## Implications for the wizard

The current wizard authors **only measures**. The 2026 calendar needs all three. Concrete recommendations:

1. **Step 1 mode toggle** — "What are you creating? Measure / Dimension / Segment". Reshape downstream steps per mode.

2. **Don't try to derive measures from dims on the fly.** Tempting for `mf_users` (where dims are already pre-aggregated upstream), structurally wrong for `recharge` / `active_daily` (where measures *are* the aggregation, not an optimization of it).

3. **Authoring path priority** (per Tier 1 + 2 roadmap):
   - Measure-mode: 1.1 conditional, 1.2 first/last timestamp, 2.1 rolling, 2.2 PoP, 2.3 lifetime, 2.4 calendar window
   - Dimension-mode: 1.3 time-since, 1.4 tier-banding
   - Segment-mode: ship as Tier 3.1 — but the *YAML write path* should be ready when 1.x ships, since segments are just a filter tree + name.

4. **`mf_users`-specific shortcut:** when the user picks `mf_users` as source AND the chosen column is already pre-aggregated upstream (`ltv_vnd`, `lifetime_match_count`, etc.), suggest "Sum across users" measure with a "Pre-aggregated — fast" badge. This is where the user's "just derive from dim" intuition is actually right, and the UX should acknowledge it.

5. **Surface the grain.** Step 1 should display "One row of `recharge` = 1 transaction. One row of `mf_users` = 1 user." so authors stop guessing whether a measure aggregates txns or users.

---

## Why this matters for liveops 2026

The Journey engine evaluates one user at a time. Per-user evaluation = `WHERE` on a dim or segment. Of the ~71 metrics the calendar reads from User Stage:

- **~40 are dim-shaped reads** (per-user attributes: `account_age_days`, `payer_tier`, `lifetime_X`, `days_since_Y`, `vip_level`).
- **~25 are segment-shaped reads** (named cohort membership: "is whale", "is NRU", "is at risk").
- **~6 are measure-shaped reads** at the *monitoring* layer (DAU, retention curves, WoW deltas).

A wizard that only authors measures covers the **smallest** of the three slices, and the one least frequently invoked at decision time. Adding dim-mode (Tier 1.3/1.4) and segment-mode (Tier 3.1) is what unblocks the Journey-led model the spec assumes.

---

## Cheat sheet

> **Dim** = the value at row scope.
> **Measure** = the value at query-result scope (after `GROUP BY`).
> **Segment** = a row-scope predicate, named and reusable.
>
> Question: *one number out?* → measure. *property of each row?* → dim. *reusable cohort?* → segment.
>
> When in doubt, check the cube's grain: a single row = a user? a user-day? a transaction? The default for a row-level field is **dim**; the default for an aggregation across rows is **measure**.

## Unresolved questions

- For `mf_users` (pre-aggregated upstream), should the wizard offer a "shortcut" measure that wraps an existing dim in `sum` / `max` / `avg` with one click? It's the case where the dim/measure boundary is genuinely thin.
- Should segment authoring be exposed in Tier 1 (since it's just the existing filter tree + a name, no new primitive) or stay in Tier 3 to keep first-shipment scope tight? Argument for moving up: it would replace ~25 hand-rolled predicates today and is the simplest authoring path of the three.
- Naming consistency: today `mf_users` has `whales_count` (measure) and `whales` (segment). The wizard should make the difference visible — e.g., a "Reusable cohort" badge on the segment, "Count metric" on the measure — so users don't ship duplicates by accident.
