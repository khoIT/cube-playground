# The Semantic Layer Case — Q&A Primer for the Data Ops Team

## Why this matters now — the reusability story

We already have two systems that serve metrics, and both have the same scaling problem: **every new metric is bespoke work.**

- Our **MCP tool** surfaces queries to agents, but each endpoint is hand-written. Adding a new metric means writing a new tool and shipping a new build.
- Our **CDP** serves metrics in real time per `MM-01-CRUD.openapi`, but it creates **one metric at a time** — each one is a manual CRUD entry with the SQL re-encoded by hand.

So every campaign metric — "whales who haven't logged in this week," "users on a 5-loss streak," "ARPPU change vs. last month" — gets implemented **three times**: once in dashboards, once as an MCP tool, once as a CDP record. They drift, they disagree in meetings, and the engineering bill scales linearly with the metric count.

A semantic layer like Cube YAML cuts this knot by making the **metric definition the single source artifact**, and every downstream system a **mechanical projection** of it:

- The **MCP tool** can introspect Cube's metadata endpoint (`/v1/meta`) and auto-expose every measure, dimension, and segment as a callable tool. The wizard publishing `users_on_5_loss_streak_7d` adds a new MCP tool *automatically* — no deploy, no hand-written endpoint.
- The **CDP** can fetch any metric by name from Cube's REST or SQL API instead of CRUD'ing one row at a time. CRUD reduces to "register this measure name" — the SQL isn't restated, the join logic isn't re-encoded, the filter isn't re-typed.
- Dashboards, agents, A/B tooling, marketing automation, and live-ops triggers all consume the same name, the same join logic, the same access policy.

In concrete liveops terms, this is what stops being a 2–5 day cross-team effort:

- *"How many whales in Vietnam churned this week?"* — Today: three SQL forks across dashboard, MCP, CDP. With YAML: `mf_users.whales` ∩ `mf_users.vn_users` ∩ a recency filter on `days_since_last_active` — already half-defined in `mf_users.yml` today.
- *"7-day rolling revenue per acquisition channel, vs. the same window last month."* — Today: a Looker explore one analyst owns. With YAML: a `rolling_window` measure plus a `time_shift` modifier — one definition, every consumer.
- *"Build me the eligible audience for Campaign X: paying users on a 5-loss streak whose last recharge was >7 days ago, by country."* — Today: a custom SQL script that ages out the moment the campaign rules change. With YAML: a composition of named segments and joined cubes, served live to CDP for real-time eligibility checks.
- *"What's D1 / D7 / D30 retention for the 2026-01 paid-install cohort?"* — Today: bespoke retention SQL per cohort. With YAML: one cohort segment (`paid_install` + `install_month`) and a retention measure pattern, reused for every future cohort question.
- *"Show me the lift in ARPPU from running the whales-only push notification last weekend."* — Today: ad-hoc query + screenshot in Slack. With YAML: `arppu_vnd` filtered by `whales` segment, sliced by `recharge_time` pre/post, served identically to BI, MCP, and CDP.

The reusability isn't theoretical — it removes the per-metric tax we pay today **three times over** across MCP, CDP, and the dashboard layer. Every YAML edit becomes a fan-out: one author-action, N consumer surfaces updated. And every metric the wizard publishes (this branch's work) immediately becomes callable by every agent and every campaign engine, without any of those teams writing code.

**TL;DR for the engineers:** A semantic layer is the API surface for data ops. It compresses every downstream consumer (dashboards, agents, APIs, CDP, MCP, BI tools) into one named contract over your warehouse. The wins are governance, join-correctness, pre-aggregation routing, and access control — *not* raw SQL speed. The honest limit: it publishes metrics, it doesn't always compute them. That separation is the point.

---

## Q1. We already write SQL. Why add another layer?

Because SQL doesn't carry a *name* or a *contract*. Three analysts asked "how many paying users do we have?" will write three slightly different `COUNT(DISTINCT ...)` queries, and three meetings later the CEO asks which number is real. A semantic layer makes `paying_users` a **named, versioned, diffable definition** in YAML, referenced by every dashboard, every agent, every API call. The first product of a semantic layer is consensus, not query speed.

---

## Q2. So what is a "measure"? What does "emits a number" mean?

A **measure** is a named SQL aggregate. At compile time, `paying_users: { sql: account_id, type: count_distinct }` resolves to `COUNT(DISTINCT account_id)`. After the GROUP BY, it produces one scalar per group.

The trio:

| Field type | Compiles to | Role |
|---|---|---|
| **dimension** | column or expression | the GROUP BY axis |
| **measure** | aggregate wrapping a column | the number per group |
| **segment** | predicate | a named, reusable WHERE |

They are **siblings rooted at the cube's underlying table**, not stacked. A measure does not require a dimension of the same column to exist.

---

## Q3. Honest question — for a single ad-hoc query, does a named measure make the SQL any faster?

**No.** `users_count` and inline `COUNT(DISTINCT user_id)` produce identical SQL for one query. If your team is two SQL-fluent analysts on one table, a semantic layer is overhead. The value compounds with **scale of consumers** and **complexity of joins** — which is exactly our situation across MCP, CDP, and BI.

---

## Q4. Then where does it actually earn its keep?

Six places, in rough order of impact:

1. **Join fan-out protection.** The moment a query crosses a 1-to-many join (`mf_users` → `recharge`), naked `SUM(amount)` double-counts. Cube knows the cube-of-origin for each measure and rewrites with subqueries or symmetric aggregates. You cannot hand-roll this correctly across N joins.
2. **Filtered measures.** `paying_users_30d` carries `filters: [{ sql: "ltv_30d > 0" }]` baked in — nobody has to remember the WHERE in every chart.
3. **Composition.** `arpu = ltv_total / user_count` — Cube preserves aggregate-then-divide order. The codebase already does this at `mf_users.yml:227-241`.
4. **Calculated dimensions** with `case:` — banding like `payer_tier` (whale / dolphin / minnow) lives in YAML, not 12 duplicated CASE expressions across dashboards. See `mf_users.yml:149-160`.
5. **Pre-aggregation routing by name** (Q5).
6. **Agent / LLM consumability.** Naked SQL is unbounded; a list of named measures and dimensions is a compact, typed surface an LLM can reason over. This is the unlock for auto-populating the MCP tool surface.

---

## Q5. Walk me through pre-aggregation. How does it actually speed things up?

You declare a rollup **inside the cube YAML**, referencing measures and dimensions **by name**:

```yaml
pre_aggregations:
  - name: by_country_os_daily
    measures:   [user_count_approx, ltv_30d_total_vnd]
    dimensions: [country, os_platform]
    time_dimension: last_login_date
    granularity: day
    refresh_key: { every: 1 hour }
```

Cube materializes a small table whose columns *are* the measure names. At query time, if your request's measures + dimensions + granularity are covered, the planner rewrites the query against the rollup (thousands of rows) instead of raw events (billions). The user-facing API call is identical either way.

Routing keys off the **symbolic name**, not a SQL string. That's why naming the measure matters — inline SQL gets no rollup.

**Adjacent features that live here:**
- `rollup_join` — pre-materializes the join itself, so cross-cube queries hit a single table.
- `rollup_lambda` — merge a slow historical rollup with a fast streaming one for fresh dashboards.
- `partition_granularity: day` + `incremental: true` + `update_window: 7 day` — rebuild only the last 7 daily partitions on each refresh. Big-data necessity.
- `refresh_key:` — the cache-invalidation contract; either `every: 1h` or a `SELECT MAX(updated_at)` probe.
- **Cube Store** — Cube ships with its own columnar engine that stores rollup tables outside your warehouse. Warehouse pays the aggregation cost once; dashboards hit Cube Store sub-second. Cuts warehouse scan $ measurably.

**Gotcha:** `count_distinct` is non-additive — yesterday's distinct users + today's distinct users ≠ a 2-day distinct count. Use `count_distinct_approx` (HLL-backed) when you want rollups that merge across grains. The repo already uses this for `user_count_approx` at `mf_users.yml:192-195`.

---

## Q6. What else lives in the YAML beyond measure / dimension / pre-aggregation?

The pieces most likely to matter for our campaign metrics:

- **`segments:`** — named predicates like `whales`, `at_risk_paying`, `lapsed_this_month`. Already 9 of them in `mf_users.yml:252-276`. The "entry condition" of every campaign maps here.
- **`joins:`** with `one_to_one | one_to_many | many_to_one` — declared once, then every cross-cube query just works.
- **`views:`** — a curated, BI-facing surface on top of cubes. Cubes are the physical model; views are the public API. Lets us refactor cubes without breaking 40 dashboards.
- **Sub-query dimensions** (`sub_query: true`) — per-row dimensions computed from a measure of a joined cube. The trick that turns "per-user lifetime revenue" into a *groupable* column without a snapshot table.
- **Multi-stage measures** (`multi_stage: true`) — CTE-shaped layered aggregates. Required for things like "of users with ≥3 sessions, count those who paid."
- **`time_shift:`** — period-over-period comparisons (`revenue this month vs last month`) without writing the math.
- **`rolling_window: { trailing: 28 day }`** — trailing-N-day aggregates as a measure-level setting.
- **`hierarchies:`**, **`meta:`**, **`drill_members:`**, **`format:`** — UX metadata for BI tools and the wizard. This repo's wizard reads `meta.grain` and `meta.visibility` to decide what to show.
- **`extends:`** — cube inheritance; useful for per-tenant or per-event-type variants.

---

## Q7. Can access control (row-level + column-level security) live in YAML too?

Yes — `access_policy:` is a first-class block:

```yaml
access_policy:
  - role: tenant_user
    conditions:
      - if: "{ securityContext.role } = 'tenant_user'"
    row_level:
      filters:
        - member: tenant_id
          operator: equals
          values: ["{ securityContext.tenant_id }"]
    member_level:
      excludes: [cost_total, pii_email]
```

`securityContext` is populated from validated JWT claims on every request. Two axes per policy: **row-level** (injected WHERE) and **member-level** (measure/dimension visibility). Once declared, the cube is **deny-by-default** — caller must match a policy.

Lighter-weight: `public: false` on a measure, dimension, or whole cube hides it from the API entirely. The repo uses this for `appsflyer_id` at `mf_users.yml:44-47`.

Escape hatch when YAML is not expressive enough: **`queryRewrite`** in JS — runs after policies, can mutate the query AST conditionally. ~95% of "tenant isolation + hide sensitive columns" needs no JS at all.

**Operational consequence:** RLS rules become **diffable code reviews**, not Confluence pages. Onboarding a new tenant or hiding a new PII column is a PR, not a ticket — and the same policy protects MCP, CDP, and BI consumers uniformly.

---

## Q8. How do consumers actually query this?

Three APIs over one model:

- **REST** `/v1/load` — JSON in/out. The natural fit for our CDP to call.
- **GraphQL** — for frontend devs.
- **SQL API** — Postgres wire protocol. Tableau, Metabase, Hex, dbt connect to Cube **as if it were a Postgres database**. We wrap our warehouse in a semantic layer without rewriting any BI tool.

Plus: **WebSocket subscriptions** for real-time dashboards, and **multi-source** (`data_source:`) so different cubes can sit on different databases — Postgres + ClickHouse + BigQuery in one model.

The MCP tool reads `/v1/meta` to discover every measure/dimension/segment automatically; the CDP reads `/v1/load` to serve any of them in real time. Both stop being bespoke.

---

## Q9. Concrete test — how do I add `revenue_in_last_7d` to `mf_users.yml`?

Three legitimate paths, increasing in runtime cost:

**Path A — extend the upstream `mf_users` ETL with a `ingame_total_recharge_value_vnd_7d` column, then 2 lines of YAML.** This is the pattern the file is *already designed for* (see `mf_users.yml:114-120` for the 30d version, plus the description at line 6 "wide feature store with one row per user"). Reads one column per row, fastest.

**Path B — filtered measure on the joined `recharge` cube** (no ETL change). Add to `recharge.yml`:

```yaml
- name: revenue_vnd_7d
  sql: charged_value
  type: sum
  filters:
    - sql: "{CUBE}.recharge_time >= CURRENT_TIMESTAMP - INTERVAL '7' DAY"
```

Cube applies the join + filter when queried from `mf_users`. Scans `etl_ingame_recharge` for last 7 days each call.

**Path C — sub_query dimension on `mf_users`** if you need `revenue_7d_vnd` as a *per-user groupable column* (for banding into `payer_7d_tier`, etc.). Cube generates a correlated aggregate per row at query time. Pre-aggregate it if hot.

The lesson: **the same metric has three legitimate implementations**, and which one to pick is an engineering trade-off (ETL ownership vs. compute cost vs. query latency) made *in the model*, not in 40 dashboards.

---

## Q10. Now the hard one — "users who lost 5 consecutive games in the last 7 days." Can Cube YAML express this?

**Partially. And the answer is the whole point of the talk.**

What Cube YAML **cannot** do natively:

- Compute run-length / streaks. Cube's measure types map 1:1 to SQL aggregates (`SUM`, `COUNT`, `MIN`, `MAX`, `AVG`, `COUNT(DISTINCT)`). Streak detection needs **window functions over ordered partitions** (`ROW_NUMBER`, gap-and-island patterns), which are not aggregate functions. Cube generates window SQL only for `rolling_window` and `time_shift`, both on the time axis.
- State-machine semantics (events that mutate user state). That belongs to a Journey engine, per the research at `plans/reports/research-260517-metric-creation-types-roadmap.md:13`.

What Cube YAML **can** do once the streak is computed upstream:

1. Compute the streak in a **warehouse view** with the standard `(rn_all - rn_outcome)` trick:

   ```sql
   CREATE VIEW vw_user_loss_streaks AS
   WITH ordered AS (
     SELECT user_id, game_ts, outcome,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY game_ts)         AS rn_all,
            ROW_NUMBER() OVER (PARTITION BY user_id, outcome ORDER BY game_ts) AS rn_outcome
     FROM etl_gameplay_table
     WHERE game_ts >= CURRENT_TIMESTAMP - INTERVAL '7' DAY
   ),
   runs AS (
     SELECT user_id, outcome, (rn_all - rn_outcome) AS run_id, COUNT(*) AS run_length
     FROM ordered GROUP BY user_id, outcome, (rn_all - rn_outcome)
   )
   SELECT user_id,
          MAX(CASE WHEN outcome='loss' THEN run_length ELSE 0 END) AS max_loss_streak_7d
   FROM runs GROUP BY user_id;
   ```

2. Expose as a **joined cube** (or merge into `mf_users` ETL) and add to `mf_users.yml`:

   ```yaml
   joins:
     - name: user_loss_streaks
       relationship: one_to_one
       sql: "{CUBE}.user_id = {user_loss_streaks}.user_id"

   segments:
     - name: on_5_loss_streak_7d
       sql: "{user_loss_streaks}.max_loss_streak_7d >= 5"

   measures:
     - name: users_on_5_loss_streak_7d
       type: count_distinct_approx
       sql: user_id
       filters:
         - sql: "{user_loss_streaks}.max_loss_streak_7d >= 5"
   ```

Once published, the streak metric **composes with every other Cube primitive**: filter by country + os, slice by acquisition channel, intersect with `whales`, pre-aggregate by `(country, day)`, govern via RLS, expose to BI via SQL API, surface to the MCP agent, serve to CDP for real-time campaign eligibility. The hard part (the windowed SQL) lives in *one* view; the consumer surface lives in *one* YAML block.

### Caveats — the honest list

1. **ETL ownership.** Adding a new streak metric (e.g., variable window) requires a data engineer to ship a new warehouse view. The wizard user can't author this from the UI today. This shifts the bottleneck from analytics to data engineering — plan accordingly.
2. **Refresh latency.** A daily-refreshed `vw_user_loss_streaks` view means dashboards lag 24h on streak metrics. For real-time campaign triggers ("ping users mid-streak"), this is a *journey engine* job, not a Cube job.
3. **Variable windows.** "5 in any 7 days" vs "5 since last login" vs "5 in current weekly cohort" are *different upstream views*. Each window grain we support is an ETL artifact. Pick a small fixed set or accept the maintenance cost.
4. **Naming drift.** If `vw_user_loss_streaks.max_loss_streak_7d` is renamed, the Cube YAML must update in lockstep. Add this to the warehouse-view PR checklist or it bites later.
5. **Pre-aggregation interaction.** A `sub_query` dimension does not participate in rollup routing the same way a plain dimension does. If we put the streak behind a sub_query and a dashboard queries it heavily, build a dedicated rollup keyed by `(country, max_loss_streak_7d, day)`.
6. **`count_distinct` non-additivity.** A rollup of "users on 5-loss-streak" by `(country, day)` cannot be summed to get "users on 5-loss-streak this week" — those are overlapping user sets. Either use `count_distinct_approx` or carry the rollup at the grain we query.

---

## The closing reasoning — why this still wins

The streak example is the most important slide. Notice what happens *despite* Cube not computing the metric:

- **Every consumer in the company** — dashboards, the MCP tool, the CDP, A/B tooling, marketing automation, the wizard — references `mf_users.on_5_loss_streak_7d` by **one name**. Without the semantic layer, that streak is a buried CTE copy-pasted into 7 different surfaces, each one quietly diverging from the others.
- **Access control** is uniform — the same `access_policy` that protects PII protects the streak column. No second governance system to maintain.
- **Pre-aggregation routing** still applies to *consumption* of the streak (count users on streak, by country, by day) even though Cube didn't compute the streak itself.
- **Refactoring is local** — change `INTERVAL '7' DAY` to `INTERVAL '14' DAY` in the upstream view + bump the YAML name, and every consumer follows. No grep across the org.
- **The contract is diffable.** The streak definition is a YAML PR with a description, an owner, and a test. Not a Slack thread.

**The semantic layer is honest about what it owns.** It owns naming, joining, filtering, materializing, governing, and serving. It doesn't always own *computing*. For data ops products — where the goal is operational reliability and reproducibility, not raw SQL athletics — owning the surface is worth more than owning the math.

For us specifically: the new-metric / dim / segment wizard work in this branch (`feat/new-metric-dim-segment-authoring`) extends the *authoring* of these surfaces to non-SQL users. The roadmap (`plans/reports/research-260517-metric-creation-types-roadmap.md`) tiers it by campaign coverage — Tier 1 (dims + segments) ships first, Tier 2 (filtered, time-shift, rolling-window measures) next. Each tier expands what the wizard can publish into the YAML — and the YAML is the data ops API surface that MCP and CDP both consume.

---

## Open questions to raise with the team

1. Who owns the **warehouse-view layer** for unresolvable-in-YAML metrics (streaks, journeys, conversion funnels)? Data engineering, or analytics engineering?
2. Do we standardize on **Path A (ETL-pre-materialized columns in `mf_users`)** or **Path B (filtered measures on event cubes)** as our default? Trade-off is wider-mf_users vs. fresher-event-cube.
3. What's our **refresh SLA tier** map? `mf_users` refresh_key is `1 hour` today; do streaks need 1 hour, 24 hours, or 5 minutes?
4. Are we ready to enforce **`access_policy` on `mf_users`** (deny-by-default with tenant/role gating) before exposing the SQL API broadly?
5. How will the wizard handle **metrics that Cube can only partially express** — does it refuse, or does it surface a "requires upstream view" affordance with a templated SQL handoff to data eng?
6. **Concrete integration question:** what's the migration path for the MCP tool — does it switch to auto-generating from `/v1/meta`, or do we keep some hand-written endpoints for performance-critical paths?
7. **CDP integration:** does `MM-01-CRUD.openapi` become "register-by-Cube-name" instead of "encode-SQL-per-row," or do we keep CDP-specific overrides for sub-second latency cases?
