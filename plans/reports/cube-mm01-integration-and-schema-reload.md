# Cube + MM-01-CRUD Integration — Schema Reload Concern

Date: 2026-05-16
Topic: How to use `MM-01-CRUD.openapi` (metrics_mgm v1.0.0) with Cube without
restarting Cube every time a metric is created/updated.
Inputs read:
- `plans/reports/cube-vs-cdp-metrics-architecture.md` (this repo)
- `C:/Users/CPU12830-local/Downloads/MM-01-CRUD.openapi.yaml`
- `C:/Users/CPU12830-local/code/cube-dev/docker-compose.yml`
- `C:/Users/CPU12830-local/code/cube-dev/cube/model/**`

---

## TL;DR

**No restart needed.** Cube has three independent reload mechanisms — dev-mode
file watcher, `schemaVersion()` callback, and `asyncModule()` schema fetcher.
Pick one, no `docker compose restart` ever required.

But the real question is which surface owns the metric definition. Three viable
shapes:

| Shape | Source of truth | Cube reload mechanism | Verdict |
|-------|-----------------|------------------------|---------|
| **A. Files** — MM-01 writes YAML into Cube's `model/` dir | YAML in git/volume | dev watcher OR `schemaVersion` polling a file hash | Simple, debuggable, **recommended for v1** |
| **B. Live fetch** — Cube JS entrypoint calls MM-01 at compile-time | MM-01 Postgres | `asyncModule` + `schemaVersion` from MM-01 | Most "dynamic", couples Cube → MM-01 uptime |
| **C. Catalog-only** — MM-01 mirrors Cube YAML for governance | Cube YAML | dev watcher; CDP is read-mostly | Already the hybrid from §3 of prior doc |

Shape A is what your concern actually points at. Answer: yes, you can hot-load.
Details below.

---

## 1. How Cube reloads schemas — three mechanisms, no restart

### 1.1 Dev-mode file watcher (`CUBEJS_DEV_MODE=true`)

When `CUBEJS_DEV_MODE=true`, Cube watches `/cube/conf/model/**` and hot-reloads
on any file change. The development API hot-reloads your data model changes
([Cube Docs — Configuration overview](https://cube.dev/docs/product/configuration)).

- **Pros:** zero config; write a YAML file → Cube picks it up within a second.
- **Cons:** **dev mode disables auth and member-level access control** and
  forces single-instance Cube Store. **Not safe for production.**

If MM-01 just writes YAML into a bind-mounted dir (Shape A) and Cube runs in
dev mode, you're done — but you've also broken multi-tenant auth.

### 1.2 `schemaVersion()` — the production-safe equivalent

Cube exposes a `schema_version(context)` config hook. Cube calls this **on
every query**. If the returned string differs from the cached one, Cube
recompiles the model on that request and serves out of the new compilation
([Cube Docs — Configuration options](https://cube.dev/docs/product/configuration/reference/config),
[Dynamic data models](https://cube.dev/docs/product/data-modeling/advanced/dynamic-schema-creation)).

An LRU cache keyed by `(appId, schemaVersion)` keeps multiple compilations
warm; expired entries are pruned ([cube-js/cube.js PR #287](https://github.com/cube-js/cube.js/pull/287)).

Typical implementations:

```js
// cube.js (CommonJS config file mounted at /cube/conf/cube.js)
module.exports = {
  schemaVersion: async ({ securityContext }) => {
    // hit MM-01 for an aggregate version token
    const res = await fetch(`${MM01_URL}/cdp/v1/metrics/${gameId}/version`, {
      headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const { data } = await res.json();          // e.g. {"data":{"version":"sha256:..."}}
    return data.version;
  },
};
```

The version token can be:
- `MAX(updated_at)` across the metrics table
- a git SHA of the YAML repo
- a row count + last-update hash

**Caveat:** `schema_version` runs on **every request**. Keep it < 50 ms or you
add that to p50 latency. Put a 1–5 s in-process TTL cache around it.

### 1.3 `asyncModule()` — fetch schema directly at compile time

Instead of YAML files, write one JS file that calls `cube()` per metric fetched
from MM-01. Combined with `repositoryFactory` and `schemaVersion`, Cube
recompiles when MM-01 changes ([Cube Docs — Dynamic data models with
JavaScript](https://cube.dev/docs/product/data-modeling/dynamic/javascript)).

```js
// model/all_metrics.js
asyncModule(async () => {
  const res = await fetch(`${MM01_URL}/cdp/v1/metrics/${gameId}`);
  const { data: metrics } = await res.json();

  // group metrics by `source` table → one cube per source
  const bySource = groupBy(metrics, (m) => m.source);

  for (const [source, group] of Object.entries(bySource)) {
    cube(toCubeName(source), {
      sql_table: source,
      measures: Object.fromEntries(
        group.map((m) => [m.metric_codename, {
          type: 'number',
          sql: m.expression,            // raw SQL expression from MM-01
          ...(m.filter && { filters: [{ sql: m.filter }] }),
        }])
      ),
      dimensions: Object.fromEntries(
        unique(group.flatMap((m) => m.dimensions)).map((d) => [d, {
          sql: d, type: 'string',
        }])
      ),
    });
  }
});
```

This is the path that **eliminates YAML entirely**. Cube becomes a thin
compiler over MM-01.

---

## 2. Reality check — MM-01 is too thin to replace the YAML

MM-01's `Metric` schema is:

```
metric_name, metric_codename, source, expression, dimensions[],
materialize, schedule, filter
```

What it **does not** have:
- **joins** — there's no relation between metrics on different sources
- **measure types** — `expression` is opaque SQL, not `type: count_distinct_approx` etc.
- **measure references** — no `{ltv_total_vnd} / {user_count}` style
  calculated metrics; you'd have to inline them as raw SQL strings
- **named segments** — `filter` is per-metric only; no shareable
  `whales`, `last_7d`, `at_risk_paying`
- **time-dimension granularity** — no `DATE_TRUNC(month, ...)` rewriting; no
  `type: time` dimensions
- **dimension types or `case:` blocks** — `dimensions: [string]` is just column
  names, no compiled `CASE WHEN`

This matches the gap analysis in §2.3 of `cube-vs-cdp-metrics-architecture.md`.

**Implication for Shape B (asyncModule fetches MM-01):** every Cube measure
becomes `type: number, sql: <opaque>`, every dimension becomes
`type: string, sql: <colname>`. You **lose**:

- `count_distinct_approx` (Trino `approx_distinct`) optimization — Cube can't
  see it's a distinct count, so no measure-level optimization
- the 6 calculated measures (`arpu_vnd`, `arppu_vnd`, `paying_rate`,
  `arpt_vnd`, etc.) — no `{a}/{b}` reference resolution from raw SQL
- segments (`last_7d`, `whales`, `at_risk_paying`) — none in MM-01
- `case:` block dimensions — must be flattened to raw SQL
- typed time dimensions and `DATE_TRUNC` granularity rewriting

You'd be using Cube as a SQL pass-through with caching. That's a degraded Cube.

**The architectural decision is therefore not just "how do we hot-reload" — it
is "do we extend MM-01 to match what Cube already expresses, or do we accept
a degraded subset?"**

---

## 3. Recommended architecture for v1

Keep Cube's YAML as the runtime model. Use MM-01 as the **catalog / API
front-door** for the *raw, simple* metrics. Don't try to round-trip the
calculated measures, segments, or typed dimensions through MM-01.

```
   ┌────────────────────────────┐
   │  Web UI / Analyst          │
   └──────┬─────────────────────┘
          │ POST/PUT /cdp/v1/metrics  (MM-01)
          ▼
   ┌────────────────────────────┐
   │ metrics_mgm  (Postgres)    │   ← source of truth for the SIMPLE subset
   │ PK = (game_id, metric_name)│      (one expression, one source, one filter)
   └──────┬─────────────────────┘
          │
          │ (a) sync worker on UPSERT
          ▼
   ┌──────────────────────────────────────┐
   │ cube/model/cubes/<source>.yml        │ ← generated, .gitignored or in a
   │  measures:                           │   git branch the worker pushes to
   │    <codename>:                       │
   │      type: number                    │
   │      sql: <expression>               │
   │      filters: [{ sql: <filter> }]    │
   │  dimensions:                         │
   │    <dim>:                            │
   │      type: string                    │
   │      sql: <dim>                      │
   └──────┬───────────────────────────────┘
          │ file change
          ▼
   ┌────────────────────────────┐
   │ Cube server                │
   │  schemaVersion = SHA of    │   ← prod-safe reload, no dev mode required
   │   generated YAML files     │
   └────────────────────────────┘

   ┌────────────────────────────────────────┐
   │ Hand-authored YAML still lives next to │
   │ generated YAML — joins, calc measures, │
   │ segments, time dims — these never round│
   │ trip through MM-01.                     │
   └────────────────────────────────────────┘
```

**Why this shape:**

1. **No restart** — `schemaVersion()` returns a hash over the model dir; when
   the sync worker writes new YAML, the next request recompiles.
2. **Hand-authored complex measures keep working.** MM-01 only owns the
   raw-expression subset. Calculated measures, segments, and join topology
   stay in hand-authored YAML files.
3. **Cube features stay untouched.** No degraded Cube.
4. **Catalog requirement satisfied.** MM-01 has every queryable metric a
   non-Cube tool can discover by `(game_id, metric_name)`.
5. **Provenance is bidirectional.** The sync worker can also tag every
   *generated* YAML measure with `meta: { source: mm01, mm01_id: ... }` so
   reverse reconciliation works.

### 3.1 Sync-worker contract

```
On MM-01 create/update/delete:
  1. fetch the affected metric(s)
  2. resolve target file: cube/model/cubes/mm01__<source>.yml
  3. read+merge: keep other measures in same source intact
  4. write+commit (atomic rename)
  5. (optional) git push to model repo
  6. POST hash-bump to /cube/conf/schema_version.txt (read by schemaVersion())
```

The `schemaVersion()` callback returns the hash of the model dir (or just
reads `schema_version.txt`). Cheap, deterministic, prod-safe.

### 3.2 Alternative: skip the file step

If you don't want generated YAML on disk, replace step 2–5 with the
`asyncModule()` pattern (§1.3). The MM-01 metric set then loads directly into
Cube at compile time. Same `schemaVersion()` mechanic. Trade-off: MM-01 must
be available for **every** Cube schema compilation; if MM-01 is down, Cube
can't recompile (existing compiled schema still serves).

---

## 4. Direct answer to the stated concern

> "with this design whenever a new metric get created that requires updating
> yaml, the server would need to restart to read the new yaml right ?"

**No.** Three independent ways to avoid restart:

| Mechanism | Restart? | Auth-safe? | Best for |
|-----------|----------|------------|----------|
| `CUBEJS_DEV_MODE=true` file watcher | No | **No** (disables auth) | local dev only |
| `schemaVersion()` polling a file hash | No | Yes | **Production Shape A** |
| `asyncModule()` + `schemaVersion()` over MM-01 | No | Yes | Shape B (full dynamic) |

The deployment in `cube-dev/docker-compose.yml` already bind-mounts
`./cube/model:/cube/conf/model:ro`. Add a `cube.js` config file with a
`schemaVersion` hook, drop `:ro` so the sync worker can write, and the
restart concern is gone.

What you cannot avoid:

- **Compilation latency** on the *first* request after a change — Cube
  recompiles, the query waits. Tens to hundreds of ms depending on model size.
  Subsequent queries hit the LRU cache.
- **Bad SQL surfaces at compile time.** If MM-01 lets an analyst submit
  `expression: "MAX(login_datetime"` (missing paren), Cube fails to compile
  and that tenant's queries fail until the bad metric is removed/fixed. MM-01
  needs a syntax-validation step before persisting.

---

## 5. Risks specific to driving Cube from MM-01

1. **MM-01 doesn't model joins.** Any metric that references a column not on
   `source` will fail at SQL execution. MM-01 has no way to express "this
   metric joins `etl_ingame_recharge` to `mf_users` via `account_id`". You
   need either (a) accept single-source metrics only via MM-01, or (b) extend
   MM-01 with a `joins[]` field.
2. **Validation must run *before* persist.** Today MM-01 has no schema-check
   step. A bad `expression` or `filter` becomes a server-wide compile error.
   Either run Cube's compile in a dry-run on POST/PUT (slow but correct), or
   parse-only against a Trino EXPLAIN with `SELECT <expression> FROM <source>
   WHERE false`.
3. **`measure_codename` collision.** MM-01's PK is `(game_id, metric_name)`,
   but Cube measure names live inside a cube and must be unique per cube.
   If two MM-01 metrics share the same `source` and `metric_codename`, the
   generated YAML breaks. Either enforce uniqueness on `(game_id, source,
   metric_codename)` in MM-01 or namespace inside Cube.
4. **Dialect coupling.** MM-01's `expression` is opaque SQL, so the SQL
   dialect is fixed to whatever Cube's `dataSource` points at (Trino here).
   A metric created against the Trino dialect won't port to Postgres or
   ClickHouse without rewriting.
5. **No measure-type semantics.** `MAX(login_datetime)`, `COUNT(DISTINCT ...)`,
   and `approx_distinct(...)` are all `type: number` to Cube. You lose
   measure-level optimizations and pre-aggregation eligibility hints. If
   pre-aggregations matter (they're commented out in `mf_users.yml` today, so
   not v1), extend MM-01 with `measure_type` and `column_arg`.

---

## 6. Concrete next steps if you go this route

1. Decide: **single source per metric only (v1)** vs. **extend MM-01 with
   joins/segments/calc-references**. Recommend v1 = single source. Hand-authored
   YAML keeps the rest.
2. Add a `cube.js` config file to the Cube container with:
   ```js
   const fs = require('fs');
   const crypto = require('crypto');
   module.exports = {
     schemaVersion: () => {
       try { return fs.readFileSync('/cube/conf/schema_version.txt', 'utf8'); }
       catch { return 'init'; }
     },
   };
   ```
3. Add a small sync worker (Node or Go service) that:
   - subscribes to MM-01 write events (webhook or `LISTEN/NOTIFY` on the
     Postgres table)
   - regenerates `cube/model/cubes/mm01__<source>.yml` for affected source
   - writes a fresh hash to `schema_version.txt`
4. Add MM-01-side validation: on POST/PUT, compile-check the metric. Reject
   if Cube can't parse it.
5. Document the boundary: "MM-01 owns raw single-source measures. Joins,
   calculated measures, segments, time dimensions, and `case:` dimensions stay
   in hand-authored YAML."

---

## 7. Sources

- Cube — [Configuration options (`schema_version`, `repositoryFactory`)](https://cube.dev/docs/product/configuration/reference/config)
- Cube — [Dynamic data models with JavaScript](https://cube.dev/docs/product/data-modeling/dynamic/javascript)
- Cube — [Dynamic data models — advanced (`asyncModule`)](https://cube.dev/docs/product/data-modeling/advanced/dynamic-schema-creation)
- Cube — [Providing a custom data model for each tenant](https://cube.dev/docs/guides/recipes/access-control/using-different-schemas-for-tenants)
- Cube — [Configuration overview (`CUBEJS_DEV_MODE`, hot reload)](https://cube.dev/docs/product/configuration)
- Cube — [Introducing YAML Data Modeling](https://cube.dev/blog/introducing-cube-support-for-yaml-data-modeling)
- GitHub — [cube-js/cube.js PR #287 — hooks for dynamic schemas (LRU compiler cache)](https://github.com/cube-js/cube.js/pull/287)
- GitHub — [cube-js/cube issue #3926 — refresh schema](https://github.com/cube-js/cube/issues/3926)
- GitHub — [cube-js/cube issue #187 — dynamic schema](https://github.com/cube-js/cube/issues/187)

---

## Unresolved questions

1. **Where does `game_id` come from in Cube YAML?** MM-01 has it; Cube has no
   first-class concept. Folder convention (`cube/model/cubes/<game_id>/...`)
   plus per-tenant `repositoryFactory` solves it, but you commit to a tenant
   model right now. Defer if you only have one game in flight.
2. **Should generated YAML live in git or only on the Cube container's volume?**
   Git gives audit + replay; volume is faster. If git, who owns merge conflicts
   when two analysts edit metrics on the same source concurrently?
3. **Will MM-01 grow `joins[]`, `derived_from`, and `segments[]`?** If yes, the
   "MM-01 is too thin" problem (§2) goes away over time. If no, the hand-
   authored YAML carries those forever and MM-01 is permanently a partial view
   of the metric universe.
4. **How is `metric_codename` uniqueness enforced?** Spec says PK is
   `(game_id, metric_name)`. Cube needs uniqueness per `(game_id, source,
   metric_codename)`. Add a DB constraint or assume the API client handles it?
5. **Pre-aggregations.** Commented out today. If they come back, MM-01 needs
   a `pre_aggregation_hint` field, otherwise generated cubes can never be
   rolled up.
