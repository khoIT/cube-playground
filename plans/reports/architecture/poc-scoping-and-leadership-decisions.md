# Metrics Exploration POC — Scope, Effort, and Decisions for Leadership

Date: 2026-05-16
Audience: Non-technical leadership
Companion docs:
- `plans/reports/cube-vs-cdp-metrics-architecture.md` (architecture options)
- `plans/reports/cube-mm01-integration-and-schema-reload.md` (technical integration)

---

## 1. The 30-second version

We have **raw lakehouse tables** (`ballistar_vn.mf_users`,
`ballistar_vn.std_ingame_user_active_daily`, `…_user_recharge_daily`,
`etl_ingame_recharge`). Today, every analyst writes their own SQL against
these. Definitions drift, mistakes compound, and non-technical users cannot
self-serve.

The POC goal: **turn these raw tables into a curated, discoverable set of
business metrics that any PM, producer, or marketer can click on to validate a
hypothesis — and a clean process for requesting new metrics when the catalog
doesn't have one yet.**

Cube (open-source semantic layer, in this repo under `cube-dev/`) is the
candidate engine. Cube **gives us 70% of the work for free** (query
compilation, joins, caching, three query APIs, time intelligence, calculated
metrics, segments). We still have to build the **front-of-house**: the catalog
UI, the request workflow, the exploration UI for non-SQL users, and the
integration with our existing CDP metric registry (MM-01).

The decisions leadership must make are **not** about which engine to write —
they are about **how much front-of-house surface we own** and **who is the
canonical owner of a metric definition**.

---

## 2. The user journey we are enabling

```
   Raw lakehouse tables                Today                    POC target
   ──────────────────────              ─────                    ──────────
   mf_users                            Analyst writes SQL.      PM picks "Country" + "DAU"
   std_ingame_user_active_daily        Joins by hand.           from a dropdown. Chart.
   std_ingame_user_recharge_daily      Definitions drift.       One definition org-wide.
   etl_ingame_recharge                 Mistakes compound.       Request new metric via form.

        │                                 │                          │
        │                                 │                          │
        ▼                                 ▼                          ▼
   Iceberg + Trino                  Spreadsheets, ad-hoc        Self-serve exploration +
                                    notebooks, "ask Khoi"       governed metric catalog
```

### 2.1 The five things a user needs to do

| # | User action | Example |
|---|-------------|---------|
| 1 | **Discover** what data exists | "Do we have a metric for paying-user retention?" |
| 2 | **Understand** what a metric means | "What does `arpu_vnd` count exactly?" |
| 3 | **Explore** a metric over time / by dimension | "Show me DAU by country for the last 30 days" |
| 4 | **Combine** metrics into a hypothesis test | "Do whales recharge less in July?" |
| 5 | **Request** a missing metric | "I need 'sessions per paying user', who do I ask?" |

Today, **all five require an analyst as a human middleware**. The POC
collapses #1–#4 into self-serve UI and turns #5 into a structured workflow.

---

## 3. Anatomy of a "good" metrics platform

A real metrics platform has **six layers**. Some Cube provides; some we build.

```
   ┌─────────────────────────────────────────────────────────────┐
   │ 6. End-user surface (chart UI, dashboards, ask-AI)          │ ← we build
   ├─────────────────────────────────────────────────────────────┤
   │ 5. Discovery & catalog (search, lineage, ownership, docs)   │ ← partial
   ├─────────────────────────────────────────────────────────────┤
   │ 4. Workflow (request → review → publish → deprecate)        │ ← we build
   ├─────────────────────────────────────────────────────────────┤
   │ 3. Query engine (compile dim+measure picks → SQL)           │ ← CUBE
   ├─────────────────────────────────────────────────────────────┤
   │ 2. Semantic model (cubes, measures, segments, joins)        │ ← CUBE schema
   ├─────────────────────────────────────────────────────────────┤
   │ 1. Raw data (Trino + Iceberg lakehouse)                     │ ← exists
   └─────────────────────────────────────────────────────────────┘
```

| Layer | Cube gives us | We must build |
|-------|---------------|----------------|
| **1. Raw data** | n/a | n/a — already done |
| **2. Semantic model** | YAML format + parser + validator | Author the YAML (4 cubes, 27 measures, 17 segments already exist) |
| **3. Query engine** | Compile, join-plan, optimize, cache, three APIs (REST/GraphQL/SQL) | Nothing |
| **4. Workflow** | Nothing | Request form, review queue, approval, publish, deprecate |
| **5. Discovery** | Cube `/meta` API + Playground (dev-grade) | Production-grade catalog UI, lineage, ownership, search, doc strings |
| **6. End-user surface** | Cube Playground (dev-grade, single-user) | Production exploration UI for non-SQL users (or BI integration) |

---

## 4. What Cube abstracts away — the "70%"

If we did not have Cube, every item below would be a project on its own.

### 4.1 Query compilation (would be a 2-engineer-quarter project)

A non-technical user picks: *"DAU by country, last 7 days, paying users only."*

Cube turns that into:
```sql
SELECT DATE_TRUNC('day', log_date) AS day,
       country_code,
       approx_distinct(user_id) AS dau
FROM ballistar_vn.std_ingame_user_active_daily ad
JOIN ballistar_vn.mf_users u ON ad.user_id = u.user_id
WHERE log_date >= CURRENT_DATE - INTERVAL '7' DAY
  AND u.is_paying_user
GROUP BY 1, 2
ORDER BY 1
```

We never write that SQL. Cube handles:
- joining `active_daily` → `mf_users` because the YAML declared the
  relationship
- picking `approx_distinct` (Trino) because the measure type is
  `count_distinct_approx`
- rewriting `last_7d` (a *segment*) into the WHERE predicate
- bucketing dates by day because the user picked "day" granularity

### 4.2 Calculated metrics (free for us, would otherwise be a parser)

`arpu_vnd = ltv_total_vnd / user_count` — Cube resolves the `{a}/{b}`
references between measures. Without it, we either ban calculated metrics
(painful) or write our own expression parser.

### 4.3 Caching + pre-aggregations (entire team-quarter saved)

Cube already has a result cache (currently 5 min–1 h TTLs per cube) and a
pre-aggregation engine (rollup materializations into Cube Store). The
pre-aggregation block is **commented out** in `mf_users.yml` today — it's
ready to enable when query latency becomes a problem.

### 4.4 Three query APIs (each is its own project to clone)

- **REST** for our exploration UI
- **GraphQL** for richer typed clients
- **SQL-over-Postgres-wire** (port 15432) so existing BI tools (Metabase,
  Superset, Tableau) can connect as if it were a Postgres database, but get
  governed metric definitions

### 4.5 Time intelligence

`DATE_TRUNC(week, …)`, period-over-period, rolling windows, BETWEEN filters
on `type: time` dimensions — all rewritten automatically.

### 4.6 Multi-tenancy hooks

When we add a second game (PTG, etc.), Cube supports per-tenant data models
via `repositoryFactory` + `securityContext`. Today's POC is single-game
(`ballistar_vn`), but the door is open.

---

## 5. What we still build — the "30% that decides the timeline"

### 5.1 End-user exploration UI (Layer 6) — the biggest unknown

Cube **does** ship the **Playground**, but it is a developer tool:
- single-user
- no auth, no row-level security on the UI side
- no saved views, no sharing, no dashboard
- no comments, no annotations

For a non-SQL user, we need either:

| Option | Effort | Pros | Cons |
|--------|--------|------|------|
| **(a)** Build a custom React app on Cube REST | 2–3 eng-months | Branded, exactly our UX | We own forever |
| **(b)** Integrate Cube SQL API with Metabase or Superset | 2–4 weeks | OSS, mature, dashboards free | Less tailored, two product surfaces to learn |
| **(c)** Cube Cloud + use their hosted UI | $$$ + 1 week | Fastest | Vendor lock, licensing |
| **(d)** Use Playground for POC, defer real UI | 0 | Validates demand first | Not demo-able to leadership |

**Recommendation:** (d) for the technical POC; (b) for the next milestone if
the POC validates demand. Defer (a) unless we discover Metabase/Superset
can't express something we need.

### 5.2 Metric request workflow (Layer 4)

Today: someone Slacks an analyst. Tomorrow:

```
   User clicks "Request metric"
        │
        ▼
   Form: name, business definition, raw table, sample logic
        │
        ▼
   Ticket lands in queue (Jira / GitHub Issue / internal tool)
        │
        ▼
   Analyst writes YAML (or extends MM-01)
        │
        ▼
   PR review → merged → Cube auto-reloads
        │
        ▼
   Notification: "Your metric is live"
```

This is **process** more than code. The code surface is small: a form
component, a webhook into our ticketing system, a notification on merge.
Maybe 2–3 eng-weeks total.

### 5.3 Catalog / discovery (Layer 5)

Cube has `/cubejs-system/v1/meta` — a JSON dump of every cube, measure,
segment, dimension. From that we generate:

- a searchable web UI ("show me all metrics tagged 'revenue'")
- per-metric pages with description, lineage, examples, last-refreshed
- ownership and "ask the owner" link

Effort: 3–4 eng-weeks of frontend on a static Cube `/meta` poll. Doable as
part of (5.1) if we build (a).

### 5.4 CDP integration — MM-01 extension scope

**This is the biggest scope dial.** Three positions:

| Position | What MM-01 stores | What MM-01 *can't* do | Eng effort |
|----------|--------------------|------------------------|------------|
| **Thin catalog** (mirror Cube) | name, source, description, owner, link to YAML | Author metrics from a UI | 1–2 eng-weeks (sync worker) |
| **Subset authoring** | Above + `measure_type`, `column_arg`, `filter`, single source | Joins, calc metrics, segments | 6–8 eng-weeks |
| **Full Cube parity** | Above + `joins[]`, `derived_from`, `segments[]`, time dims, typed dims | (matches Cube) | 2+ eng-quarters |

MM-01 today supports a **subset of "subset authoring"** — it has
`expression`, `source`, `dimensions[]`, `filter`, `materialize`, `schedule`,
but no `measure_type`, no joins, no calculated metrics, no segments.

**Decision driver:** Is MM-01 the front door analysts use to *author* metrics,
or is YAML-in-git the front door and MM-01 is just the *catalog* others read?

- If MM-01 is the front door → we are committing to **2+ quarters** of API
  extension work to reach Cube parity, otherwise the front door is a
  permanently restricted view of what's possible.
- If MM-01 is the catalog → **1–2 weeks** of sync worker, and MM-01 mirrors
  Cube definitions one-way.

The companion doc `cube-mm01-integration-and-schema-reload.md` lays out
exactly which MM-01 fields need to grow to match each option.

### 5.5 Auth, access control, audit (cross-cutting)

Cube has hooks (`checkAuth`, `securityContext`, row-level security via
`queryRewrite`), but **we** must:
- decide who can see which game's data
- decide who can author metrics (analysts only? PMs? game leads?)
- log every metric edit
- log every query for billing / debugging

Effort: 2–3 eng-weeks, mostly straightforward Cube config + wiring to our
existing IAM.

---

## 6. Phased roadmap with rough effort

T-shirt sizes — **not** commitments. Calibrate after Phase 1.

| Phase | Outcome | Duration | Key risk |
|-------|---------|----------|----------|
| **0. Decisions** | Leadership signs off on Section 7 questions | 1–2 weeks | Wrong call → wasted Phase 1+ |
| **1. Inventory & validate semantic model** | Analyst confirms the 4 existing cubes + 27 measures match how the business actually thinks. Decide whether more raw tables need cubes. | 2–3 weeks | Hidden definitions ("our DAU is actually...") |
| **2. Catalog + hot-reload** | MM-01 mirrors Cube `/meta`; Cube reloads on YAML change without restart; basic search UI | 3–4 weeks | MM-01 schema migration |
| **3. Exploration UI** | Non-SQL users can pick view + dims + measures + segments, see chart+table. Per Section 5.1, recommend Metabase/Superset on Cube SQL API. | 4–6 weeks | Tool gaps (e.g. Superset can't express calculated metrics) |
| **4. Metric request workflow** | Form → ticket → YAML PR → auto-deploy on merge | 2–3 weeks | Process adoption, not tech |
| **5. Auth, audit, pre-aggregations** | Multi-game ready, RLS, query log, hot-path latency under 1s | 3–4 weeks | Pre-aggregation tuning is iterative |
| **6. Pilot with 3–5 users** | Real PMs / producers use it for a week; we measure: metrics requested vs. satisfied, time-to-insight, errors | 2 weeks | The whole thing might be solving the wrong problem |

**Total: 4–6 months end-to-end** for a single-game POC promoted to pilot.
Subtract Phase 5 + 6 if leadership wants demo-only (≈ 3 months).

---

## 7. Decisions only leadership can make

These do not have technical answers. They have **business** answers.

### 7.1 Build vs. buy on the semantic layer
- **Cube Core (OSS, self-host)** — what we have now. Zero license. Ops on us.
- **Cube Cloud (SaaS)** — managed; pricing scales with usage; UI included.
- **Other (dbt-metrics, Lightdash, AtScale)** — different trade-offs; would
  reset Phase 1.

### 7.2 Who owns the metric definition canonically?
- **YAML-in-git** — analysts write, code-review, merge. Engineering culture.
- **MM-01 + UI** — non-engineers can author. CDP-side governance.
- **Hybrid** — YAML for complex (joins, calc, segments), MM-01 for simple
  single-source metrics. Each "speaks their language".

This is the **single highest-leverage decision** in the POC. It determines
whether MM-01 needs 1 quarter or 4 quarters of extension work.

### 7.3 End-user UI strategy
- Adopt an OSS BI tool (Metabase / Superset) on Cube's SQL API — fastest.
- Build our own — most control, most cost.
- Defer — Playground for the POC, decide later.

### 7.4 First-game scope
- Stay on `ballistar_vn` for the whole POC — simplest, fastest demo.
- Add `ptg` early — forces multi-tenancy now, slower start, more durable shape.

### 7.5 Success criteria for the POC
What does "the POC worked" look like to leadership?
- "5 PMs used it weekly for 4 weeks"?
- "Time-to-answer dropped from 2 days to 5 minutes"?
- "Analyst capacity freed up for higher-value work"?
- "Marketing team validated 3 hypotheses without filing a ticket"?

Without this, we can't tell when we're done.

---

## 8. What "doing nothing" costs (the null option)

Every quarter we don't have a metrics platform:
- Analyst headcount is the bottleneck on every business question.
- Definitions drift between teams. Marketing's "DAU" ≠ Product's "DAU".
- Hypothesis tests get prioritized by "who has analyst time" not "what
  matters".
- New games (PTG, future) re-do the entire ad-hoc SQL effort from scratch.

This isn't a sales pitch; it's a baseline. The POC's job is to prove the
delta is worth the build cost.

---

## 9. Recommended next step

**Two-week Phase 0** with the following deliverables:

1. Leadership picks one option from each of Section 7's five questions.
2. Engineering re-scopes Phases 1–6 against those answers (the T-shirt sizes
   in Section 6 can shrink or grow by 2–3× depending on the answers).
3. We name a **pilot user group** (3–5 specific people, by name) so Phase 6
   isn't theoretical.

Phase 0 has no engineering cost — it's a series of working sessions.

---

## Unresolved questions

1. **Who is the pilot user group?** Without names, we can't scope the UI
   correctly — a marketer's needs differ from a producer's.
2. **What is the operating budget envelope?** Cube Core OSS is free;
   Cube Cloud is not. Metabase OSS is free; Metabase Cloud is not.
   The build-vs-buy question hinges on this.
3. **Is `ballistar_vn` the only game in scope for the POC, or is multi-game
   required from day 1?** This swings Phase 5 effort by ~3 weeks.
4. **Does MM-01 already have stakeholders depending on its current shape?**
   Extending it is easier if nobody is reading the existing fields in
   production. Breaking it is harder.
5. **What does "metric request → live" SLA need to be?**
   - Hours (analyst on call) — drives YAML-in-git workflow
   - Minutes (self-serve UI authoring) — drives MM-01 full extension
   - Days (PR review cycle) — drives YAML-in-git with relaxed process
6. **Do we have an existing BI tool footprint we should integrate with**
   (e.g. is Metabase already deployed somewhere)? Reusing existing is faster
   than picking new.
