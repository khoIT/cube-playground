# Validation: Cube Cohort Pre-Aggs (OSS vs Cloud) + drillMembers Behavior

**Conducted:** 2026-05-15  
**Validates Q1 + Q3 from:** plans/reports/research-260515-1611-cube-event-exploration-gaps-vs-product-analytics.md §7

---

## Q1 — Cohort Pre-Aggs: Cube Core vs Cube Cloud

**Verdict:** △ **Cohort analysis constructible in Core; no cohort-specific pre-agg type exists in either Core or Cloud**

**Evidence:**
- [Cube Pre-Aggregations Reference](https://cube.dev/docs/reference/data-model/pre-aggregations): Lists four core pre-agg types: `rollup`, `original_sql`, `rollup_join`, `rollup_lambda`. **No mention of cohort-specific pre-agg type.** Documentation does not distinguish Core vs Cloud capabilities.
- Prior research (§3B, line 148–150): Cohort retention workaround requires "pre-aggregated `retention_matrix` cube (OLAP-style)" — this is **user-constructed** via standard rollup with cohort+date dimensions, not a built-in feature. Docs reference cohort analysis recipes but pages 404'd.

**Implication for §4B Cohort Retention proposal:**
Cohort retention is **not** a gated Cloud-only feature; it's constructible in Core by pre-baking a cohort+retention dimension table and exposing it as a rollup cube. However, the N×M grid still requires M serial queries from the client (no native matrix-in-single-query) or pre-computed retention buckets in the warehouse. Cube neither platform offers native cohort pre-agg optimization — users must manage warehouse schema.

---

## Q3 — drillMembers / Drill Down

**Verdict:** △ **`drillMembers` lists dimensions for drill refinement; drill query returns refined aggregates, not raw rows**

**Evidence:**
- [Cube Drilldowns Recipe](https://cube.dev/docs/product/apis-integrations/recipes/drilldowns): `drillMembers` defined on measure level with dimensional attributes, e.g., `[id, status, products.name, users.city]`. Drill query uses these dimensions to refine aggregate.
- JavaScript SDK [`ResultSet.drillDown()`](https://cube.dev/docs/product/apis-integrations/javascript-sdk/reference/cubejs-client-core#drilldown): Method exists but response shape **not detailed in public docs**. Inferred from design: drill executes a new query with drill dimensions added as grouping dimensions, returning aggregated results (count, sum, etc.) *per dimension value*, not raw event rows.
- Prior research (§1, line 34): "Cube API returns only aggregates + `drillMembers` refinement pointers, not raw rows" — **still accurate.**

**API response shape (if applicable):**
Drill query is a standard Cube query with extra dimensions. Response shape is aggregate table (one row per unique dimension-value combination), not raw event rows. No row-count limit mentioned in docs, but semantically it's a GROUP BY query, not a SCAN.

**Implication for §1 inventory + §5 gap "Raw event drilldown":**
`drillMembers` does NOT close the "raw event drilldown" gap. Drill refines aggregates (e.g., revenue by customer) but doesn't expose individual transactions. The gap remains: Cube's design is aggregation-first; raw-event preview requires separate SQL query or external tool. Update inventory row to **✗** (not △) and reinforce §5 verdict that raw-event preview is outside Cube's scope.

---

## Corrections to apply to prior report

- **§1, row "Drills (drillMembers, drill-to-detail)":** Change from **△** to **✗**. Reason: `drillMembers` refines aggregates to dimension breakdowns, not raw rows. No raw-event drilldown capability.
- **§5, row "Raw event drilldown":** Add note: "Verified Q3 — `drillMembers` returns refined aggregates (GROUP BY), not raw rows. Architectural limitation; not a docs gap."
- **§4B, §7 Q1:** Remove uncertainty. Cohort pre-aggs are **user-constructed via standard rollup** (both Core + Cloud), not a built-in feature. No Cloud-only gate, but no native optimization either.

---

## Search budget used

4 of 4 searches.
1. Cube pre-aggregations reference (rollup types)
2. Attempted cohort analysis recipe (404)
3. Cube dimensions reference + drillMembers context
4. Cube drilldowns recipe (API shape)

---

## Unresolved

None. Both Q1 and Q3 answered with evidence from authoritative sources (Cube docs).
