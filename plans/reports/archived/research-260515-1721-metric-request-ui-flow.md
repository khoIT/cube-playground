# Research Report: Metric Request UI Flow for Cube Cubes & Views

**Date:** 2026-05-15
**Author:** researcher
**Scope:** Design a guided UI flow that lets non-tech users (PM, marketer, analyst) request a new measure to be added to existing Cube cubes/views (`/Users/lap16299/Documents/code/cube-dev/cube/model`), with rules-based suggestion of WHERE the measure should land. Reference UI: `Downloads/Cube Playground _standalone_.html`.

---

## Executive Summary

The existing model has 4 cubes (`mf_users`, `active_daily`, `user_recharge_daily`, `recharge`) and 7 views split into 4 entity-first 360 views and 3 metric-first aggregate views (`user_audience`, `revenue_metrics`, `activity_metrics`). **Measures must live in cubes, not views** — views only re-export cube members through `includes`. So a metric request flow has two outputs: (a) `+ measure` in one cube YAML, (b) `+ name` in one or more `view.cubes[*].includes` lists.

Recommended UX is a **5-step wizard** modeled on Cube Cloud's Visual Modeler + Lightdash custom-metrics builder, but specialized for "request" (PR-generating) rather than direct edit. The wizard collects: (1) plain-English intent, (2) grain pick → suggested cube, (3) aggregation type, (4) optional filter, (5) name + preview. Output is a structured request that compiles into a YAML diff and a GitHub PR for engineer review. The wizard's "where does this go?" suggestion is driven by a **deterministic decision matrix** keyed on grain + source column availability — not by LLM guessing.

Top three risks: (a) users requesting metrics that need new source columns (must block, route to ETL request); (b) non-additive ratios silently breaking pre-aggregations; (c) measure name pollution across the joined view surface.

---

## Methodology

- Sources consulted: Cube docs (measures, views, pre-aggregations, designing-metrics, visual-modeler), Cube blog (views & visual modeler intros), Lightdash docs, Snowflake semantic views, Coalesce/Holistics 2025 semantic-layer comparisons.
- Date range of materials: 2023–2026 (Cube YAML/views ≥ 2023, Visual Modeler ≥ 2024, OSI 2025).
- Existing model directly read: 4 `cubes/*.yml` + `views/user_360.yml`.
- Reference HTML (1.7MB) is a self-contained bundled React app of the current playground — UI shell already exists in `src/` (App.tsx, QueryBuilder, QueryBuilderV2). The new wizard plugs into the same shell.

---

## 1. Existing Model (Ground Truth)

### 1.1 Cubes

| Cube | Grain | Source table | Joins | Primary purpose |
|---|---|---|---|---|
| `mf_users` | 1 row / user | `mf_users` | hub | wide lifetime + 30d-rolling profile |
| `active_daily` | 1 row / user / active day | `std_ingame_user_active_daily` | many→one `mf_users` | DAU/MAU, activity timeline |
| `user_recharge_daily` | 1 row / user / recharge day | `std_ingame_user_recharge_daily` | many→one `mf_users` | per-user-per-day revenue |
| `recharge` | 1 row / transaction | `etl_ingame_recharge` | many→one `mf_users` | raw txn detail |

Existing measures span: counts (`user_count`, `paying_users`, `dau`, `transactions`), sums (`ltv_total_vnd`, `revenue_vnd`, `total_online_time_sec`), ratios (`arpu_vnd`, `arppu_vnd`, `paying_rate`), filtered counts (`whales_count`, `paying_users_30d`, `mau_prev_month`).

### 1.2 Views

| View | Source cube(s) | Style | Purpose |
|---|---|---|---|
| `user_profile` | `mf_users` | entity-first | one user snapshot (360) |
| `user_activity_timeline` | `active_daily` | entity-first | per-day activity for one user |
| `user_recharge_timeline` | `user_recharge_daily` | entity-first | per-day revenue for one user |
| `user_transactions` | `recharge` | entity-first | per-txn for one user |
| `user_audience` | `mf_users` | metric-first | cohort/segmentation |
| `revenue_metrics` | `recharge` | metric-first | daily/monthly revenue analytics |
| `activity_metrics` | `active_daily` | metric-first | DAU/MAU analytics |

Rule observed: views are 1-to-1 with their backing cube. Joins are declared on the cube side; views just `includes`.

---

## 2. Cube Rules That Constrain the Flow

Verified from Cube docs:

1. **Measures live in cubes**, never in views. Views re-export via `cubes[*].includes`. Adding a measure to a cube does NOT auto-expose it; explicit list required ([view ref](https://cube.dev/docs/product/data-modeling/reference/view)).
2. **Additive measure types**: `count`, `sum`, `min`, `max`, `count_distinct_approx`. **Non-additive**: `avg`, `count_distinct` (exact), all ratio measures ([non-additivity recipe](https://cube.dev/docs/product/caching/recipes/non-additivity)).
3. **Pre-aggregation matching** prefers additive measures. Non-additive ratios must be decomposed into additive components (e.g. `avg = sum / count`) so rollups stay reusable. Existing pre-aggs in `mf_users` are currently commented-out — risk is lower now but the rule still drives correctness ([matching docs](https://cube.dev/docs/product/caching/matching-pre-aggregations)).
4. **Derived/ratio measures**: `type: number` with SQL like `{measure_a} * 1.0 / NULLIF({measure_b}, 0)`. NULLIF is required to avoid div-by-zero — the codebase already follows this in `arpu_vnd`/`paying_rate`.
5. **`format`**: `percent`, `currency`, plus standard `number` formatting. Surfaces to Playground display. `meta`: free-form key/value passed to clients.
6. **Filtered measures**: `filters: [{sql: "..."}]` for "X but only when Y" without needing a segment.
7. **Naming**: snake_case, must be unique within the cube. Across joined cubes in a view, collisions are resolved with `prefix: true` or `alias`.
8. **YAML schema validation**: `name`, `type` required on every measure; `sql` required for everything except `type: count`; root must be `cubes:` (or `views:`) list.

---

## 3. Decision Matrix — Which Cube Hosts the New Measure?

The wizard runs this **deterministic** logic. No LLM guessing.

```
Q1. What is the grain of the metric?
    ├── "per user, summarizing their lifetime / current state"        → mf_users
    ├── "per user per day they were active (DAU/MAU/session-like)"    → active_daily
    ├── "per user per day they recharged (revenue rolled up to day)"  → user_recharge_daily
    └── "per individual transaction / event"                          → recharge

Q2. Is the underlying column already present in the chosen cube's source table?
    ├── YES → continue
    └── NO  → BLOCK: surface "needs an ETL/source change first"
              and route to the source-data team. Do not generate YAML.

Q3. Is this a filtered version of an existing measure?
    (e.g. "paying users in VN", "DAU on iOS")
    ├── YES → suggest `filters:` on the new measure, OR reuse an existing
              segment from the cube (cheaper) — recommend the existing
              segment first, fall back to inline filter only when no segment fits.
    └── NO  → continue.

Q4. Is this a ratio of two existing measures?
    ├── YES → type=number, sql={a}*1.0/NULLIF({b}, 0). Auto-flag as non-additive.
              Recommend documenting in `description`.
    └── NO  → continue.

Q5. Pick aggregation:
    ├── distinct count of users/ids   → count_distinct_approx (default) | count_distinct (exact, slower)
    ├── row count                     → count
    ├── total of a numeric column     → sum
    ├── average                       → avg            (warn: non-additive)
    ├── min / max                     → min / max
    └── min(observed) / max(observed) on a time column → min / max on time dim

Q6. Which views should expose it?
    Default: every view whose `join_path` points to the cube
    where the measure was added. Show as checklist (pre-checked).
    Power users can uncheck (e.g. PII-style metrics stay cube-only).
```

The matrix encodes ~95% of legitimate metric requests against this model. Anything Q2 blocks should never reach engineers as YAML — it's an upstream data request.

---

## 4. UI Flow — 5-Step Wizard

### Information architecture

The wizard is a new top-level surface alongside the existing **Query Builder** / **Rollup Designer** in the playground shell. Entry points: (a) "Request a new metric" button in the empty-state of the measure picker; (b) a "+ Request metric" item inside each view's measure list (pre-fills the target view).

### Step 1 — Describe what you want (plain English)

```
┌────────────────────────────────────────────────────────────┐
│  Step 1 of 5   Describe the metric                         │
│  ──────────────────────────────────────────────             │
│                                                            │
│  In one sentence, what do you want to measure?             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Average revenue per paying whale in the last 30d   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
│  💡 Examples:                                              │
│   • "Daily active users on iOS in Vietnam"                 │
│   • "Number of first-time payers per day"                  │
│   • "Total revenue from IAP this month"                    │
│                                                            │
│              [Cancel]              [Next →]                │
└────────────────────────────────────────────────────────────┘
```

Purpose: capture intent in user's words. Used later for `description`, name-suggestion, and PR title. No NLP parsing required — text is preserved verbatim.

### Step 2 — Where does this metric belong?

Wizard runs the decision matrix, suggests a cube + grain, shows reasoning. User can override.

```
┌────────────────────────────────────────────────────────────┐
│  Step 2 of 5   What's the grain?                           │
│  ──────────────────────────────────────────────             │
│                                                            │
│  ◉  One number per user (lifetime / current)               │
│         → goes into  mf_users                              │
│                                                            │
│  ○  One number per user per day they were active           │
│         → goes into  active_daily                          │
│                                                            │
│  ●  One number per user per day they recharged             │ ← suggested
│         → goes into  user_recharge_daily                   │
│                                                            │
│  ○  One number per transaction                             │
│         → goes into  recharge                              │
│                                                            │
│  ℹ  We picked "per user per day they recharged" because    │
│     your description mentions "revenue" and "30d".          │
│                                                            │
│              [← Back]              [Next →]                │
└────────────────────────────────────────────────────────────┘
```

### Step 3 — How is it computed?

```
┌────────────────────────────────────────────────────────────┐
│  Step 3 of 5   How is it computed?                         │
│  ──────────────────────────────────────────────             │
│                                                            │
│  Pick the kind of math:                                    │
│                                                            │
│   [Σ Sum]  [# Count]  [⍙ Avg]  [% Ratio]  [▼ Min/Max]      │
│                                                            │
│  Source column (from user_recharge_daily):                 │
│  ┌────────────────────────────────────────────────────┐    │
│  │ revenue_vnd  (Sum of recharge value VND)        ▼ │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
│  Auto-detected type:  sum                                  │
│                                                            │
│  Optional filter:                                          │
│   ┌─────────────────────────────────────────────────┐      │
│   │ payer_tier  =  whale          [+ add condition] │      │
│   └─────────────────────────────────────────────────┘      │
│                                                            │
│   Or pick a reusable segment:                              │
│     ☐ last_7d   ☑ last_30d   ☐ yesterday                   │
│                                                            │
│  ⚠ Note: avg/ratio measures cannot be cached in rollups    │
│    as efficiently as sum/count. Consider Sum + Count       │
│    and let the dashboard compute the average.              │
│                                                            │
│              [← Back]              [Next →]                │
└────────────────────────────────────────────────────────────┘
```

Source-column dropdown reads the chosen cube's dimensions and surface columns from the YAML (the wizard already has this). If column missing, an inline link "Don't see your column? Request it from data team →" routes out (Q2 BLOCK).

### Step 4 — Name & preview

```
┌────────────────────────────────────────────────────────────┐
│  Step 4 of 5   Name it & preview                           │
│  ──────────────────────────────────────────────             │
│                                                            │
│  Suggested name:  revenue_vnd_whales_30d                   │
│                   ┌──────────────────────────────────┐     │
│                   │ revenue_vnd_whales_30d           │     │
│                   └──────────────────────────────────┘     │
│  ✓ No collision in user_recharge_daily                     │
│                                                            │
│  Description:                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Sum of recharge VND from whale-tier users in the   │    │
│  │ last 30 days. Non-additive across users.           │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
│  Format:  [  None  ▼  ]    e.g. currency / percent / —     │
│                                                            │
│  ─── Preview (live query) ────────────────────────────     │
│  revenue_vnd_whales_30d                                    │
│  ──────────────────────                                    │
│         2,148,329,500                                      │
│                                                            │
│  [Run preview again]   [Show SQL]                          │
│                                                            │
│              [← Back]              [Next →]                │
└────────────────────────────────────────────────────────────┘
```

Preview hits the running Cube backend with a one-row query. SQL toggle reveals the compiled query for any analyst who wants to verify.

### Step 5 — Choose where it should show up & submit

```
┌────────────────────────────────────────────────────────────┐
│  Step 5 of 5   Where should it appear?                     │
│  ──────────────────────────────────────────────             │
│                                                            │
│  Views that read from user_recharge_daily:                 │
│   ☑ user_recharge_timeline   (entity-first, 360 panel)     │
│   ☑ revenue_metrics          (metric-first, cohort)        │
│                                                            │
│  Send for engineer review:                                 │
│                                                            │
│  ┌─ Generated changes ─────────────────────────────────┐   │
│  │  cube/model/cubes/user_recharge_daily.yml           │   │
│  │   + measures:                                       │   │
│  │   +   - name: revenue_vnd_whales_30d   ...          │   │
│  │                                                     │   │
│  │  cube/model/views/user_360.yml                      │   │
│  │   + revenue_vnd_whales_30d  (×2 includes blocks)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  Requested by:  khoitn@vng.com.vn                          │
│  PR title:      Add measure revenue_vnd_whales_30d          │
│                                                            │
│              [← Back]    [Submit request →]                │
└────────────────────────────────────────────────────────────┘
```

Submit creates a GitHub PR via `gh` (server-side) against `cube-dev` with the YAML diff + a description carrying the Step-1 intent + Step-3 aggregation reasoning. Engineer reviews, merges, and CI redeploys Cube.

### Wizard guardrails

- **Cancel & resume**: state persisted to localStorage; closing the wizard mid-flow doesn't lose work.
- **Validation gates**: Next button disabled until the current step's required fields are valid (snake_case name, column picked, etc.).
- **Diff preview before submit**: always shown — gives the user a sense of what's leaving the building.
- **Read-only branch for non-tech users**: PR target = a `metric-requests/*` branch, not `main`. Engineer rebases on merge.

---

## 5. Data Contracts

### 5.1 Request payload (UI → backend)

```json
{
  "intent": "Average revenue per paying whale in the last 30d",
  "grain": "user_recharge_daily",
  "aggregation": {
    "kind": "sum",
    "source_column": "revenue_vnd"
  },
  "filters": {
    "segments": ["last_30d"],
    "inline": [{ "column": "payer_tier", "op": "=", "value": "whale" }]
  },
  "name": "revenue_vnd_whales_30d",
  "description": "Sum of recharge VND from whale-tier users in the last 30 days.",
  "format": null,
  "expose_in_views": ["user_recharge_timeline", "revenue_metrics"],
  "requested_by": "khoitn@vng.com.vn"
}
```

### 5.2 YAML emitter (backend → PR)

Backend renders into the existing YAML using a deterministic templater. Output for the example above:

```yaml
# cube/model/cubes/user_recharge_daily.yml — additive diff
measures:
  - name: revenue_vnd_whales_30d
    type: sum
    sql: ingame_total_recharge_value_vnd
    filters:
      - sql: "{mf_users}.payer_tier = 'whale' AND {CUBE}.log_date >= CURRENT_DATE - INTERVAL '30' DAY"
    description: Sum of recharge VND from whale-tier users in the last 30 days.
```

```yaml
# cube/model/views/user_360.yml — additive diff (2 places)
- name: user_recharge_timeline
  cubes:
    - join_path: user_recharge_daily
      includes:
        - ... existing ...
        - revenue_vnd_whales_30d

- name: revenue_metrics
  cubes:
    - join_path: recharge
      includes:
        - ... existing ...
# ↑ NOTE: revenue_metrics is on `recharge` cube, not user_recharge_daily.
# Wizard's "where should it appear" list must reflect cube ownership.
```

The note above is a real gotcha — `revenue_metrics` reads from `recharge`, not `user_recharge_daily`. The wizard must filter the "expose in views" checklist by `view.cubes[*].join_path === target_cube`.

---

## 6. Component Mapping into the Existing Playground

The playground is React/TypeScript (`src/QueryBuilder`, `src/QueryBuilderV2`, `src/pages`, `src/atoms`, `src/components`). Suggested file additions (kebab-case, under 200 LoC each):

```
src/MetricRequest/
├── metric-request-wizard.tsx          # top-level stepper shell
├── step-1-describe-intent.tsx
├── step-2-pick-grain.tsx
├── step-3-aggregation-builder.tsx
├── step-4-name-and-preview.tsx
├── step-5-expose-and-submit.tsx
├── decision-matrix.ts                 # pure functions, deterministic
├── yaml-emitter.ts                    # templater (no schema rewriting; append-only)
├── request-payload.types.ts
└── use-metric-request-state.ts        # localStorage-backed reducer
```

Hook into `src/App.tsx` as a new route `/request-metric`, surfaced from the existing measure picker (likely in `QueryBuilderV2/QueryBuilderInternals.tsx` based on git status showing it's modified).

Backend bridge: a thin Node endpoint (existing playground server, `server.js` if present, or a new `src/cloud/metric-request.ts` proxy) that accepts the JSON payload and shells out to `gh pr create`.

---

## 7. Quick Start (Implementation Sketch)

1. **Read model on load**: parse `cube/model/cubes/*.yml` + `views/*.yml` into a structured `ModelGraph` (cubes, dimensions, measures, segments, view→cube edges).
2. **Build the decision matrix as pure TS**: input = `{intent, chosenGrain, chosenColumn}`, output = `{cube, conflicts, exposeViews}`.
3. **Implement the 5 step components** as controlled forms.
4. **Implement YAML emitter** with `js-yaml` (or hand-written templater for full control of comments/order).
5. **Implement PR submitter** server-side: `gh pr create --base main --head metric-requests/<slug> --title ... --body ...`.
6. **Add a "review queue" page** for engineers — lists open PRs from this flow, deep-link to GitHub.

---

## 8. Common Pitfalls

| Pitfall | Mitigation |
|---|---|
| User picks `avg` → silently breaks pre-agg matching when rollups re-enabled | Step 3 warning + suggest sum+count split |
| Name collision in joined view surface | Step 4 collision check against all members reachable via target view's join graph |
| Source column doesn't exist | Step 3 dropdown only shows existing columns; ETL request link |
| Filter SQL injection | Filter builder is structured (column + op + value), never free-text |
| Stale model after PR merged | Refetch model on wizard open; cache for ≤ 5 min |
| Two requests for same metric | Search existing measures by description-similarity before Step 1 closes |
| PII leak by exposing in view | Default `public: false` for any column already marked `public: false` in source cube (`appsflyer_id`, `composite_pk`) |

---

## 9. Comparative Approaches Considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Cube Visual Modeler embed** | Maintained by Cube team | Cube Cloud only; not OSS; can't customize for our 4-cube rules | ✗ |
| **Lightdash "custom metrics" model** (user-defined at query time, not committed) | Zero engineer overhead | Stays user-local; doesn't update shared cubes/views; non-tech can break things | ✗ for shared-model goal |
| **Free-form NL → LLM → YAML** | Lowest UI friction | Non-deterministic; can invent columns; bad fit for "non-tech user" goal | ✗ |
| **5-step wizard + PR** (this report) | Deterministic, auditable, engineer-in-loop, fits existing playground | More clicks than free-text | ✓ |

---

## 10. Resources & References

### Official Cube docs
- [Measures reference](https://cube.dev/docs/product/data-modeling/reference/measures)
- [Views reference](https://cube.dev/docs/product/data-modeling/reference/view)
- [Designing metrics recipe](https://cube.dev/docs/product/data-modeling/recipes/designing-metrics)
- [Calculated measures & dimensions](https://cube.dev/docs/product/data-modeling/concepts/calculated-members)
- [Accelerating non-additive measures](https://cube.dev/docs/product/caching/recipes/non-additivity)
- [Matching queries with pre-aggregations](https://cube.dev/docs/product/caching/matching-pre-aggregations)
- [Visual Modeler](https://cube.dev/docs/product/data-modeling/visual-modeler)
- [Cube style guide](https://cube.dev/docs/product/data-modeling/recipes/style-guide)

### Cube blog
- [Introducing Views for metrics management](https://cube.dev/blog/introducing-views)
- [Introducing Visual Modeler](https://cube.dev/blog/introducing-cube-visual-modeler-empowering-everyone-to-build-with-data)
- [Cube Core v0.31 — YAML, Views, and Lambda](https://cube.dev/blog/cube-core-v0-31-yaml-views-and-lambda)

### Comparable tools
- [Lightdash metrics reference](https://docs.lightdash.com/references/metrics)
- [Snowflake semantic views best practices](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-dev)
- [Holistics semantic-layer comparison 2026](https://www.holistics.io/bi-tools/semantic-layer/)

### Repo touchpoints
- Existing playground shell: `/Users/lap16299/Documents/code/cube-playground/src/`
- Cube model: `/Users/lap16299/Documents/code/cube-dev/cube/model/{cubes,views}/`
- Reference UI bundle: `/Users/lap16299/Downloads/Cube Playground _standalone_.html` (bundled React app; UI inspiration only)

---

## Open Questions

1. **PR target repo & branch protection** — confirm `cube-dev` repo accepts PRs from the playground service account; what's the default reviewer team?
2. **Auth in the playground** — wizard records `requested_by`. Is there an existing session/SSO we can pull email from, or do we add a sign-in?
3. **Preview backend** — does the running Cube instance allow ad-hoc YAML overrides for the preview query, or must we run the preview against the existing measures only (estimating the value)?
4. **Segment vs filter precedence** — for "users in VN", the model has both `vn_users` segment in `mf_users` and a `country` dimension in `active_daily`. Decision matrix needs an explicit rule on which side filters get attached when joins are involved.
5. **Pre-aggregations re-enablement** — `mf_users.pre_aggregations` is commented out. If/when re-enabled, the wizard must surface "this measure won't be cached by the existing rollup; engineer must extend it" — needs a separate UI line. Out of scope for v1?
6. **Multi-cube measures** — what if the requested metric naturally crosses cubes (e.g. "revenue per active day")? Current matrix forces single-cube. Acceptable for v1; revisit if requests start failing this constraint.
7. **Tagging & glossary** — should each requested measure be tagged with a business domain (revenue, engagement, acquisition) to help searchability later? Probably yes, but not in v1.
