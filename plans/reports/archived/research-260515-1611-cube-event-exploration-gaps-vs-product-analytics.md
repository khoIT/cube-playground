# Research Report: Cube Event-Exploration UX — Gaps vs Product Analytics SOTA

**Conducted:** 2026-05-15  
**Scope:** Cube semantic-layer capabilities, QBv2 current UI surface, state-of-the-art event analytics patterns, and feasibility of funnel/cohort/distribution/breakdown add-ons.

---

## Executive Summary

Cube + QBv2 is a **solid ad-hoc exploration foundation** for event data but **incomplete for product analytics workflows**. Cube natively surfaces measures (count, sum, count_distinct), dimensions, time granularity, and rich filters — all wired in QBv2 UI. However, Cube lacks first-class **funnel, cohort retention, distribution binning, and raw-event-drilldown** semantics. The product-analytics gap is real: PostHog, Amplitude, and Lightdash all hardcode these as first-class objects with dedicated UIs, whereas Cube forces ad-hoc query composition for each.

**Verdict:** Ship analysis-type pickers (funnel, cohort, distribution, breakdown) as QBv2 extensions, *not* as UI revamp to existing pill bar. These are distinct enough to warrant their own tab or side-mode switcher. Funnel and distribution are constructible today via Cube aggregates + multi-query UI (workaround). Cohort retention requires M queries per cohort week (expensive at scale). Sankey / path analysis is Cube's hardest limitation — semantic layers are aggregation-first; raw-event scan isn't the product.

**Timeline:** Quick wins (funnel, distribution, breakdown) fit v1 if scoped to single-measure queries and standard Cube cubes. Cohort retention deferred to v2 (requires co-development with Cube Cloud for efficient cohort tables). Kill Sankey in v1; document the limitation.

---

## 1. What Cube + QBv2 Surfaces Today (Inventory)

### Query-Building Concepts (Cube API vs QBv2 UI)

| Concept | Cube API | QBv2 UI | Notes |
|---------|----------|---------|-------|
| **Measures** (count, sum, avg, count_distinct) | ✓ Full support, all types | ✓ `<MemberPillRow kind="measure"/>` + picker | Via pill bar, line 32–39 of phase-04 spec. Granularity fixed per measure in cube definition. |
| **Dimensions** (string, number, boolean, time) | ✓ Full support | ✓ `<MemberPillRow kind="dimension"/>` + picker | Via pill bar. Multi-value filtering via OR logic. |
| **Time Dimensions** (with granularity) | ✓ Per-timeDim granularity (year/quarter/month/week/day/hour/minute/second) | ✓ Granularity chip inline, via `PREDEFINED_GRANULARITIES` (values.ts line 94–103) | One time-dim per query; Cube API supports N but UI caps at 1 by design (2026-05-15 decision D5). |
| **Filters** (operators: eq, !=, >, <, contains, in date range, before/after, set/notSet) | ✓ All operators in `BINARY_OPERATORS + UNARY_OPERATORS` (values.ts line 24–41) | ✓ `<MemberPillRow kind="filter"/>` + `<FilterMember>` UI. Date/time filters use `<TimeDateRangeSelector>` (phase-04 date-range-strip). | QBv2 does NOT surface logical AND/OR grouping in pill bar; filters are AND'd implicitly. |
| **Segments** | ✓ Reusable filter groups (API-level, stored in cube) | △ `<SegmentFilter>` in sidebar (QueryBuilderFilters.tsx line 11) — *not* in pill bar; hidden from primary query flow. | Pre-baked at cube level. Dynamic segment creation absent from QBv2 UI. |
| **Joins** (cross-cube relationships) | ✓ Declared in cube model via `relationship: { ... }` | △ `joinableCubes` read from context (line 34, QBv2/context.tsx) — picker allows *selecting* related cube measures, but join *config* (left/right, type) buried in API call. | Multi-cube queries possible but join strategy not exposed in UI. |
| **Pre-aggregations** (cached roll-ups) | ✓ Declared in cube; API transparently uses if match | ✗ Zero visibility in QBv2. No UI to inspect or force pre-agg selection. | Silent optimization. Users have no control. |
| **Drills** (drillMembers, drill-to-detail) | △ `drillMembers` declares dimensions on a measure; `ResultSet.drillDown()` runs a standard Cube query with those dimensions added as GROUP BY — returns **refined aggregates, not raw rows** (verified Q3, see `research-260515-1641-cube-cohort-preaggs-and-drilldown-validation.md`). | ✗ Not surfaced in results table. Chart-click handler uses it for "drill-by" chart refinement only. | Refines aggregates (revenue → by-customer), does NOT expose raw events. |
| **Computed Dimensions** (case/when bucketing, derived fields) | △ **Via JavaScript/YAML model edit only.** No "add a computed dimension at query time" feature. | ✗ Absent. | **Critical gap.** Distribution binning requires defining buckets; Cube forces model change. |
| **Window Functions** (running_total, rolling_window, rank, lag) | △ `rolling_window` exposed (Cube docs reference). `running_total` absent or undocumented. rank/lag absent. | ✗ Zero visibility or control. | Used internally for time-series charts but not user-controllable. |
| **Raw Event Preview / Drill-to-Source** | ✗ Cube API returns only aggregates + `drillMembers` refinement pointers, not raw rows. Verified Q3 — `drillDown()` is GROUP BY, not SCAN. | ✗ Absent. | **Critical gap.** Architectural limitation, not a docs gap. No "click measure cell → see underlying events" flow. |

### Current QBv2 UI Tab Structure (QueryBuilderInternals.tsx line 32)

```
Tabs = ['results' | 'generated-sql' | 'json' | 'graphql' | 'sql']
```

- `results`: table + chart (chart is separate collapsible panel, phase-04)
- `generated-sql`: Cube's compiled SQL for transparency
- `json`: Cube query JSON (for debugging/API docs)
- `graphql`: GraphQL query equivalent
- `sql`: Custom SQL editor (not query-builder sourced)

**No dedicated analysis-type picker.** Current UI assumes: user builds a query, views aggregate table + chart. No funnel step-by-step, no cohort heatmap, no distribution histogram.

---

## 2. State-of-the-Art Exploration Patterns

### **Funnel Analysis**

**Exemplars:** PostHog (open-source, closest to Cube's spirit), Amplitude, Mixpanel.

**UI Pattern:** User selects N ordered events (e.g., `page_view` → `add_to_cart` → `purchase`). System computes drop-off at each step. Results show conversion % per step, optional time-to-convert, optional breakdown by property.

**Data shape needed from backend:**
- Event sequence validation (did user A complete step 1? then step 2?) — requires **ordered event scan** or **pre-computed funnel cubes**.
- Per-step counts: `COUNT(DISTINCT user_id) WHERE event_type = 'step_1'`, `COUNT(DISTINCT user_id) WHERE event_type = 'step_1' AND event_type = 'step_2' AND step_1.ts < step_2.ts`, etc.
- Result: N-column table (step 1 count, step 2 count, ..., drop-off % per step).

**PostHog specifics** ([docs.posthog.com/product-analytics/funnels](https://posthog.com/docs/product-analytics/funnels)):
- Accepts per-step filters + global filters.
- Three ordering modes: Sequential, Strict, Any.
- Breakdown by property/cohort with attribution mode (first-touch, last-touch, etc.).
- Results: conversion steps graph (Sankey-style or bar-chart-like), time-to-convert histogram, trend over time.

### **Cohort Retention Analysis**

**Exemplars:** Amplitude, Mixpanel (both are retention-centric), PostHog (has retention table).

**UI Pattern:** User defines cohort (e.g., "users who signed up in May 2026") and a return event (e.g., `active_day`). System computes: "of those users, how many were active on day 1, day 2, ..., day N?" Result is an N×M grid (weeks on rows, days-since-cohort on columns; values = % retention or absolute count).

**Data shape needed from backend:**
- Cohort definition: `COUNT(DISTINCT user_id) WHERE first_event.ts in [May 1, May 31]`.
- Per-cell query: `COUNT(DISTINCT user_id) WHERE user_id in (cohort) AND return_event.ts = cohort_start + N days`.
- Result: N×M grid (expensive: M queries, one per retention bucket).

**Standard UX:** Week-on-week or day-on-day retention heatmap (color intensity = %, red for low, green for high). Often includes cohort size, current status (complete / in-progress).

### **Distribution / Histogram Analysis**

**Exemplars:** Amplitude, PostHog (property distributions), Hex, Lightdash (via binning in semantic layer).

**UI Pattern:** User picks a numeric measure (e.g., `revenue`) and optionally a grouping dimension (e.g., `country`). System bins the measure (auto-bins by 10–20 buckets) and renders a histogram or grouped bar chart.

**Data shape needed from backend:**
- Binned measure: `COUNT(*) GROUP BY CASE WHEN measure < 100 THEN '0-100' WHEN measure < 1000 THEN '100-1k' ... END`.
- Or: `COUNT(*) GROUP BY floor(measure / 100)` (numeric bucketing).
- Result: Key-value pairs (bin label, count) or (numeric bucket, count).

**Standard UX:** Bar chart (x=bucket, y=count) or stacked bar if grouped by secondary dimension. Overlay of median/mean lines. Configurable bin count.

### **Breakdown / Sticky Table Analysis**

**Exemplars:** Amplitude's "by property" feature, PostHog's event breakdown, Mixpanel's Segmentation.

**UI Pattern:** User picks one measure (e.g., `count`) and multiple dimensions (e.g., `country`, `device_type`, `user_cohort`). System returns pivoted table: rows = unique value combinations, columns = measure. Sortable, filterable.

**Data shape needed from backend:**
- Multi-dimensional grouping: `SELECT country, device_type, user_cohort, COUNT(*) AS count GROUP BY country, device_type, user_cohort ORDER BY count DESC`.
- Result: Flattened table (N rows × M+1 columns).

**Standard UX:** Table with sort/filter, often called "Insights" or "Explorer" in product-analytics tools. No chart; pure data. Optional drill-down to underlying events.

### **Sankey / User Flow Analysis**

**Exemplars:** Amplitude, Mixpanel (limited), PostHog (absent but frequently requested).

**UI Pattern:** User picks a start event and an end event. System renders a Sankey diagram showing all paths between start and end, with flow thickness proportional to user count. Optionally shows time-between-steps.

**Data shape needed from backend:**
- **Raw event sequences** per user: `SELECT user_id, event_type, ts FROM events WHERE ts BETWEEN ? AND ? ORDER BY user_id, ts`.
- Path extraction (group by user, extract event sequences) — computational work.
- Result: Deduplicated paths + flow counts (user-ABC took path A→B→C→E, user-DEF took A→B→D, etc.).

**Critical constraint:** **Requires raw-event scan.** Cube is aggregation-first and doesn't expose raw rows. This is outside Cube's design scope.

---

## 3. What Cube Can / Can't Express (Per Analysis Type)

### **Funnel Analysis**

**Verdict:** △ **Workaround feasible, not native.**

**Reasoning:**
- Cube can express `COUNT(DISTINCT user_id) WHERE event_type = 'X'` as a measure per step.
- But Cube cannot natively express "count users who did X *then* Y" (ordered event sequence) *without* pre-computed funnel cubes or stored procedures.
- **Workaround #1:** Create pre-aggregated cubes for each funnel in the data warehouse (e.g., `fact_funnel_signup_to_purchase`). Cube exposes them; UI picks measures `step_1_users`, `step_2_users`, etc. Compute drop-off % client-side.
- **Workaround #2:** Use SQL mode + manual window-function query (outside QBv2 UI scope).
- **Limitation:** Cube's semantic layer doesn't express "event sequence" as a first-class concept. No built-in funnel measure-type.

**Can Cube do today?** Yes, if you pre-bake funnel cubes. No if you want ad-hoc funnel creation from raw events.

---

### **Cohort Retention Analysis**

**Verdict:** ✗ **Needs raw event access or special cohort-table pre-aggs.**

**Reasoning:**
- Cube cannot return an N×M grid in a single query. Each cell requires a separate query: `COUNT(DISTINCT user_id WHERE user_id IN (cohort_week_1) AND return_event.ts = week_1 + N days)`.
- At scale (52 weeks of data, 7-day retention buckets = 52×8 = 416 queries), this is prohibitively expensive.
- **Workaround:** Build a pre-aggregated `retention_matrix` cube (OLAP-style) that pre-computes retention for all cohort/bucket pairs. Then UI becomes single query. But this requires:
  1. Data warehouse has cohort + retention pre-computed (high cardinality, expensive to maintain).
  2. Standard `rollup` pre-agg in cube model exposes it. **Available in both Cube Core and Cube Cloud** — no Cloud gate (verified Q1).

**Can Cube do today?** Not efficiently at scale without major data warehouse refactoring. Neither Core nor Cloud offers native cohort-specific pre-agg optimization; warehouse schema burden stays with the user.

---

### **Distribution / Histogram Analysis**

**Verdict:** ✓ **Natively feasible, with caveats.**

**Reasoning:**
- Cube measures are aggregates: `COUNT`, `SUM`, `AVG`, etc. All are already grouped by dimensions in query.
- **Trivial case:** `SELECT COUNT(*) GROUP BY user_country` is already a distribution (count per country).
- **Bucketing case:** Cube doesn't expose computed dimensions for binning at query-time. User must add a `CASE WHEN` dimension to the cube YAML model (edit required).
- **Lighter workaround:** API-level bucketing. UI fetches raw measure + dimension, client-side buckets using JavaScript `Math.floor(measure / bucket_size)`, re-groups. Inefficient for large datasets but feasible for UI prototyping.

**Cite:** [Cube docs: Calculated measures and dimensions](https://cube.dev/docs/product/data-modeling/concepts/calculated-members) — computed dimensions require model edit.

**Can Cube do today?** Yes, if binning is pre-defined in the cube. No, if you want ad-hoc binning (would need QBv2 to support dynamic computed dimensions, which it doesn't).

---

### **Breakdown / Sticky Table Analysis**

**Verdict:** ✓ **Native, fully supported.**

**Reasoning:**
- `SELECT measure GROUP BY dim1, dim2, dim3 ORDER BY measure DESC` is bread-and-butter Cube.
- QBv2 already supports N dimensions in pill bar; chart + results table render grouped data.
- UI change needed: allow N dimensions (pill bar currently sorts measures/dims/time separately; no explicit "compare all these dimensions" grouping UI). Today it's implicit (all dims are grouped in results).

**Can Cube do today?** Yes, 100%. UI already works, just needs to surface it more explicitly.

---

### **Sankey / User Flow Analysis**

**Verdict:** ✗ **Requires raw-event access, outside Cube's scope.**

**Reasoning:**
- Cube exposes `drillMembers` (refine an aggregate) but NOT raw event rows.
- Path analysis requires: `SELECT user_id, event_seq GROUP BY user_id HAVING event_seq = [A, B, C]` — a raw-scan operation.
- Cube's entire design is "semantic layer on top of aggregates"; raw rows are de-emphasized.
- **Architectural mismatch:** Sankey is exploratory (open-ended paths); Cube is metric-driven (known aggregates).

**Can Cube do today?** No. **Recommendation:** Drop Sankey from v1 scope. It's a direct SQL/data-warehouse query tool feature, not a semantic-layer feature.

---

## 4. Concrete Proposal — Analysis-Type Picker in QBv2

### **Location & Activation**

**Recommend: New "Analysis" tab** in `QueryBuilderInternals.tsx` tab bar (line 32), alongside `results | generated-sql | ...`. Alternatively, a mode-switcher radio in the pill-bar card header (`<QueryStatePillBar />`).

**Rationale:**
- Tab is cleaner: separates "standard query exploration" (results/chart) from "analysis mode" (funnel/cohort/distribution).
- Pill-bar mode-switcher risks diluting the pill bar's primary use (query building). Easier to keep pill bar as-is and add Analysis as a sibling feature.

**Activation flow:**
```
User selects "Analysis" tab
  → Radio group: [Standard] [Funnel] [Cohort Retention] [Distribution] [Breakdown]
  → User picks one → UI rewires pill bar to show analysis-specific inputs
```

Or, if using tab approach:
```
[Results][Chart][Generated SQL][Analysis][JSON]
         ↓ click Analysis
         → Displays analysis-type picker + mode-specific UI below
```

### **Per-Analysis-Type UI Spec**

#### **A. Funnel Analysis**

**Inputs (via pill bar + analysis-specific UI):**
1. **Primary measure:** Pick one from pill bar (auto-populated if user selected one; else pick now). E.g., `count`, `count_distinct(user_id)`.
2. **Step events:** New UI: ordered list of dimension values representing steps. E.g., step 1 = `event_type = 'signup'`, step 2 = `event_type = 'complete_profile'`, etc.
   - Implement: Reusable `<StepPicker>` component. Each step = dimension + operator + value(s). Drag-to-reorder.
3. **Ordering mode:** Radio (Sequential | Strict Order | Any) — maps to Cube filter + time logic.
4. **Breakdown dimension (optional):** Pick a second dimension to segment funnel by.
5. **Global filters:** Inherit from pill bar's filter row.

**Cube Query Generated:**
```javascript
// Pseudo-code
step_1_measure = { dimensions: [], measures: [primary_measure], filters: [step_1_filter] }
step_2_measure = { dimensions: [], measures: [primary_measure], filters: [step_1_filter, step_2_filter, time_ordering] }
...
// Issues 3 separate queries (one per step) to Cube, computes drop-off client-side
```

**Results Rendering:**
- **Primary chart:** Stacked bar (x=step, y=count) or line showing drop-off.
- **Table below:** Step | Count | Conversion % | Drop-off %.
- Optional: Segmented view (if breakdown dimension set).

**Implementation Effort:** Medium. Requires new `<StepPicker>` and `<FunnelResults>` components, multi-query orchestration in context.

---

#### **B. Cohort Retention Analysis**

**Inputs:**
1. **Cohort definition:** Dimension + date range. E.g., `user_signup_date = [May 1–31, 2026]`.
2. **Return event:** Measure (count-distinct users who did X) + optional property filter.
3. **Retention granularity:** Radio (Day-N | Week-N | Month-N).
4. **Observation window:** How many retention periods to compute (default 12).

**Cube Query Generated:**
```javascript
// Issues M queries (one per cohort week × retention bucket)
cohort_size_query = { filters: [cohort_filter], measures: [count_distinct_users] }
retention_bucket_query(week, day_offset) = {
  filters: [cohort_filter, return_event_filter, ts >= week_start + day_offset],
  measures: [count_distinct_users]
}
```

**Results Rendering:**
- **Heatmap:** Rows = cohort week, Columns = day-N, Cells = retention %. Color: red (0%) → green (100%).
- **Row metadata:** Cohort size, status (complete / in-progress).

**Implementation Effort:** High. Requires N parallel queries + heatmap component. **Recommend deferring to v2** (requires Cube Cloud co-development for efficient pre-aggs).

---

#### **C. Distribution / Histogram Analysis**

**Inputs:**
1. **Measure:** Already in pill bar.
2. **Bin count:** Number input (default 10). Auto-calculates bin edges.
3. **Grouping dimension (optional):** Pick second dimension; results will be stacked histogram.
4. **Filters:** Inherit from pill bar.

**Cube Query Generated:**
```javascript
// Single query with computed dimension (workaround: client-side bucketing)
query = {
  dimensions: [bucketed_measure_dimension],
  measures: [count],
  filters: pill_bar_filters
}
// Client-side: 
// 1. Fetch query results
// 2. Re-bucket measure by bin_count
// 3. Render histogram
```

**Results Rendering:**
- **Primary chart:** Bar chart (x=bucket, y=count) or stacked bar if grouped.
- **Overlays:** Median, mean, mode lines.
- **Table:** Bucket | Count | Cumulative %.

**Implementation Effort:** Low–Medium. Reuse existing chart code (recharts bar chart). Bucketing logic is ~50 LOC JavaScript.

---

#### **D. Breakdown / Sticky Table**

**Inputs:**
1. **Primary measure:** Already in pill bar.
2. **Breakdown dimensions:** Already in pill bar (select N dimensions).
3. **Sort order:** Auto-sort by measure DESC (configurable).
4. **Filters:** Inherit from pill bar.

**Cube Query Generated:**
```javascript
query = {
  dimensions: pill_bar_dimensions,
  measures: [primary_measure],
  filters: pill_bar_filters,
  order: { measure: 'desc' }
}
// Single query
```

**Results Rendering:**
- **Table:** Columns = dimensions + measure. Rows = unique dimension combinations, sorted by measure.
- **Interactive:** Sort by any column, filter by value, drill-down to events (if raw-event integration exists — v2 feature).

**Implementation Effort:** Very Low. This is **already in QBv2 results table**. Just relabel and surface explicitly as "Breakdown mode" in Analysis tab.

---

### **Tab/Mode Implementation Details**

**Option A: New Analysis Tab (Recommended)**

```tsx
// QueryBuilderInternals.tsx, line 32
type Tab = 'results' | 'analysis' | 'generated-sql' | 'json' | 'graphql' | 'sql';

// In render:
{tab === 'analysis' && <AnalysisPanel />}
```

**Option B: Mode-Switcher in Pill Bar Header**

```tsx
// QueryStatePillBar.tsx header
<Radio.Group value={analysisMode} onChange={setAnalysisMode}>
  <Radio value="standard">Standard</Radio>
  <Radio value="funnel">Funnel</Radio>
  <Radio value="cohort">Cohort</Radio>
  <Radio value="distribution">Distribution</Radio>
  <Radio value="breakdown">Breakdown</Radio>
</Radio.Group>

// Below pill bar, render analysis-specific UI
{analysisMode === 'funnel' && <FunnelInputs />}
{analysisMode === 'cohort' && <CohortInputs />}
...
```

**Pick Option A (tab)** — cleaner separation, doesn't bloat pill bar, aligns with existing tab structure.

---

## 5. What's Missing from Cube Itself

| Gap | Severity | Workaround | Cube Docs Reference |
|-----|----------|-----------|-------------------|
| **Computed dimensions (binning) in query UI** | High | Define dimension in YAML, edit model. Or client-side bucketing (slow at scale). | [Calculated members](https://cube.dev/docs/product/data-modeling/concepts/calculated-members) — requires YAML edit, not query-time. |
| **Raw event drilldown** (click measure → see underlying rows) | High | Use SQL mode or pivot to raw SQL query. Cube API doesn't expose raw rows. | Verified Q3 — `drillMembers` + `ResultSet.drillDown()` runs GROUP BY with extra dimensions, returns refined aggregates not raw rows. Architectural limitation, not a docs gap. |
| **Funnel measure type** | Medium | Pre-bake funnel cubes in warehouse. | Absent from docs. No mention of funnel as a built-in measure pattern. |
| **Cohort pre-aggs** (N×M retention grid in single query) | Medium | Manual pre-agg in warehouse; Cube Cloud users could build retention cube. | Absent from docs. No mention of cohort or retention as pre-agg targets. |
| **Window functions in Playground UI** | Medium | Use SQL mode. `rolling_window` is used internally but not exposed for user control. | [Docs mention rolling_window](https://cube.dev/docs/reference/data-model/measures) but no Playground UI to pick/configure it. |
| **Logical AND/OR filters in results** | Low | Use SQL mode. API supports `or:` but Playground implicitly ANDs all filters. | Absent from UI; API supports it. See `@cubejs-client/core` filter grammar. |
| **Multi-measure funnel** (measure1, measure2 in same funnel) | Low | Workaround: compute funnel ratio client-side post-query. | No docs. Cube doesn't bundle multi-measure funnel logic. |
| **Ad-hoc segments** (user-defined, transient) | Low | Use filters. Pre-defined segments in cube work. | [Segments in docs](https://cube.dev/docs/reference/data-model/segments) — requires cube definition, not ad-hoc. |

**Key insight:** Cube's design is metric-centric (dimensions + measures + time). Event analytics is event-centric (what sequence did user X follow?). These are orthogonal mental models. Cube can be bent to support funnel/cohort/distribution via workarounds and pre-aggs, but the core mismatch remains.

---

## 6. Verdict

### **Ship Analysis Add-Ons, Not Pill Bar Revamp**

**Recommendation:**

1. **Keep pill bar as-is** (phase 04). It's a clean query builder for standard Cube operations.
2. **Add Analysis tab v1** with Funnel, Distribution, and Breakdown mode switchers.
   - **Funnel:** Multi-query orchestration. Gate behind "requires pre-aggregated funnel cubes" or "for ad-hoc, use SQL mode". Medium lift, good UX win.
   - **Distribution:** Client-side bucketing. Easy, immediate win.
   - **Breakdown:** Already works; just relabel. Zero lift.
   - **Defer Cohort Retention to v2** (needs Cube Cloud cohort tables or major warehouse refactoring).
   - **Kill Sankey** (structural mismatch; raw-event scan outside Cube scope).

3. **Do NOT** try to make Cube a full event-analytics engine. It's a semantic layer; event analytics is a different paradigm. Cube excels at pre-aggregated metrics. Let other tools (PostHog, raw SQL on warehouse) own the event-scan use case.

### **Architectural Fit**

Cube is a **good substrate for metric dashboards and ad-hoc OLAP exploration**. It's a **weak substrate for exploratory event analytics** (funnels, cohorts, paths) because:
- Event analytics is "what sequence did user X follow?" Cube is "what's the aggregate metric?"
- Semantic layers excel at caching + consistency. Event discovery is bespoke.
- Cube's data model is dimension-measure. Event analysis is event-type-timestamp-user.

**Honest take:** If your product is "event exploration + ad-hoc analysis", build on raw-event query tools (Presto, DuckDB, Stitch, PostHog's plugin API). Bolt Cube on top for metric dashboards. Don't try to make Cube do both.

### **Where the Fight IS Worth Picking**

1. **Breakdown / multi-dimensional exploration** — Cube is excellent. Invest here.
2. **Distribution bucketing** — Cube can do it. UI improvement (computed dimension picker) small but high-ROI.
3. **Funnel with pre-aggs** — Reasonable middle ground. Pre-bake funnel cubes, let Cube expose them. UI is clean if data model is prepared.

### **Where the Fight Is NOT Worth Picking**

1. **Cohort retention at scale** — Cube's M-query model breaks. Needs special pre-aggs or raw-event access.
2. **Sankey / path analysis** — Cube is wrong tool.
3. **Raw-event preview in drill-down** — Architectural mismatch. Build separately if needed.

---

## 7. Unresolved Questions

1. ~~**Does Cube Core (open-source) support cohort pre-aggs, or only Cube Cloud?**~~ **RESOLVED (2026-05-15):** Not a Cloud gate. Cube exposes 4 pre-agg types (`rollup`, `original_sql`, `rollup_join`, `rollup_lambda`) in both editions. Cohort retention is constructible via a user-built `rollup` over a cohort+date table — neither edition offers native cohort optimization. See `research-260515-1641-cube-cohort-preaggs-and-drilldown-validation.md` §Q1.
   
2. **Can `rolling_window` be exposed in a query without SQL mode?** Docs mention it internally but don't show how to use it as a user-facing feature. Check Cube Cloud Playground behavior.

3. ~~**Does `drillMembers` ever return raw rows, or only aggregate refinement pointers?**~~ **RESOLVED (2026-05-15):** Returns refined aggregates only. `drillMembers` is a dimension allow-list on a measure; `ResultSet.drillDown()` runs a normal Cube query with those dimensions added as GROUP BY. Architectural limitation — Cube is aggregation-first by design. See `research-260515-1641-cube-cohort-preaggs-and-drilldown-validation.md` §Q3.

4. **If we use client-side bucketing for distribution histograms, what's the performance floor?** Cube returns raw measure + dimension; browser bucketing is O(N). For >10K rows, UI lag expected. Is this acceptable for v1, or defer?

5. **PostHog and Amplitude both support "attribution mode" (first-touch, last-touch) for funnel breakdowns. Does Cube's semantic layer have any such concept, or is it purely a UI concern?** Docs don't address; likely UI-only logic.

---

## Sources

- [PostHog Funnel Documentation](https://posthog.com/docs/product-analytics/funnels)
- [Cube Calculated Members and Dimensions](https://cube.dev/docs/product/data-modeling/concepts/calculated-members)
- [Cube Data Modeling — Dimensions](https://cube.dev/docs/reference/data-model/dimensions)
- [Cube Measures Reference](https://cube.dev/docs/reference/data-model/measures)
- [Lightdash Semantic Layer Documentation](https://docs.lightdash.com/guides/lightdash-semantic-layer)
- [Lightdash GitHub — Open Source BI](https://github.com/lightdash/lightdash)
- [Cube Introducing YAML Data Modeling](https://cube.dev/blog/introducing-cube-support-for-yaml-data-modeling)
