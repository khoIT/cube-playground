# Research Report: QueryBuilder CENTER Chart Dual-Axis Threading

**Date:** 2026-06-19 · **Environment:** macOS darwin, Asia/Saigon (GMT+7)  
**Status:** COMPLETE · **Confidence:** 95%

---

## 1. CENTER CHART DATA FLOW

**Entry point:** `QueryBuilderChartResults.tsx:55` receives `resultSet` (Cube SDK) + `query` + `chartType`

**Path to render:**
- `QueryBuilderChart.tsx:54-63` passes these to `QueryBuilderChartResults`
- `QueryBuilderChartResults.tsx:68-74` forwards to `PlaygroundChartRenderer` (recharts wrapper)
- `ChartRenderer.tsx:207-261` switches on `chartType` → renders Recharts `<LineChart>`, `<BarChart>`, or `<AreaChart>`

**Data shape for center chart today:**
- `resultSet`: Cube SDK `ResultSet<any>` object
- The renderer calls `resultSet.chartPivot(pivotConfig)` (line 141) → returns array of series with `{x: formatted_dates, series1: val, series2: val, ...}`
- `query`: the single active Cube query object
- **Current assumption:** one query → one result set → one axis (Y axis shared across all measures)

**Chart rendering:**
- `PlaygroundChartRenderer` (line 68) is called for the center-pane chart
- Props: `{query, chartType, resultSet, pivotConfig, chartHeight}`
- **Type signature for center chart renderer props:** (see `QueryBuilderChartResults.tsx:8-17`)
  ```typescript
  interface QueryBuilderChartResultsProps {
    resultSet: ResultSet<any> | null;
    isLoading: boolean;
    query: Query;
    pivotConfig: PivotConfig;
    chartType: ChartType;
    isExpanded: boolean;
    overflow?: string;
    containerRef?: RefObject<HTMLDivElement>;
  }
  ```

---

## 2. DUAL-AXIS SUPPORT IN CENTER CHART

**Current state:** Center chart does NOT support dual-axis today.

**Evidence:**
- `ChartRenderer.tsx:207-367` defines `TypeToChartComponent` for 'line', 'bar', 'area', 'pie', 'table'
- Each type creates a **single Y-axis** via `CartesianChart` (line 168-176)
- No `yAxisId="left" | yAxisId="right"` pattern anywhere in center chart

**Chat-side dual-axis EXISTS:**
- `assistant-chart-section.tsx:478-517` implements 'dual-axis' case
- Uses Recharts `<ComposedChart>` with:
  - `<YAxis yAxisId="left">` (line 497)
  - `<YAxis yAxisId="right" orientation="right">` (line 504)
  - `<Bar yAxisId="left" dataKey={leftCol}>` (line 513)
  - `<Line yAxisId="right" dataKey={rightCol}>` (line 514)

**Type union for chart types in Cube SDK:**
```typescript
// From @cubejs-client/core
type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'table'  // no 'dual-axis'
```

**Verdict:** Center dual-axis is **net-new work**. The chat renderer is a separate component with its own type system (`ChartSpec`). Center chart uses Cube SDK's limited `ChartType` enum.

---

## 3. DEEPLINK CONSUMPTION & OVERLAY QUERY INJECTION

**Deeplink entry:**  
`QueryBuilderContainer.tsx:313` reads `gds-cube:pending-chat-deeplink:<id>` from `sessionStorage`

**Exact flow (lines 308-339):**
```typescript
// Line 313: Read the deeplink payload
const storageKey = `gds-cube:pending-chat-deeplink:${chatArtifactId}`;
const raw = typeof sessionStorage !== 'undefined'
  ? sessionStorage.getItem(storageKey)
  : null;

if (raw) {
  // Line 320: Clear immediately (prevent double-consume)
  sessionStorage.removeItem(storageKey);
  // Line 322: Parse and cache
  chatPayloadRef.current = JSON.parse(raw) as Record<string, unknown>;
  chatPayloadCacheRef.current = { id: chatArtifactId, payload: chatPayloadRef.current };
}

// Line 457-464: Apply payload as the primary query
const rawQuery =
  (chatArtifactId && processedArtifactRef.current === chatProcessKey
    ? chatPayloadRef.current
    : null) ?? /* other sources */ null;
```

**To extend for overlay:**
1. Read **two** query objects from the deeplink (primary + overlay) — currently line 322 reads a single `Query`
2. Store overlay query in a **separate ref** (e.g., `overlayQueryRef`)
3. Pass both to `QueryBuilder` component (line 555) as new props:
   ```typescript
   <QueryBuilder
     defaultQuery={applyGameFilter(query, gameId, cubeHasGameDim)}
     overlayQuery={overlayQuery ?? undefined}  // NEW
     overlayChartType="line"  // NEW: force overlay to line
     // existing props...
   />
   ```
4. Thread through to `QueryBuilderInternals` (line 115) and invoke compare mode with `'overlay'` setting

---

## 4. COMPARE ENGINE REUSE

**Current CompareSetting type** (`compare-url-codec.ts:22`):
```typescript
export type CompareSetting = CompareMode | null;
export type CompareMode = 'prev' | `game:${string}`;  // from derive-compare-query.ts:24
```

**MergedRow structure** (`merge-by-dim-key.ts:19-26`):
```typescript
export interface MergedRow extends DataRow {
  [key: `${string}__cmp`]: number | null;      // comparison value
  [key: `${string}__delta`]: number | null;    // Δ (current - comp)
  [key: `${string}__deltaPct`]: number | null; // Δ% (current - comp)/comp
}
```

**To add 'overlay' mode:**

1. **Extend `CompareMode` type** (`derive-compare-query.ts:24`):
   ```typescript
   export type CompareMode = 'prev' | `game:${string}` | 'overlay:<id>';
   ```

2. **Pass explicit query instead of deriving it** (`use-compare-results.ts:174-245`):
   - Line 179: `deriveCompareQuery` is called to build the 2nd query
   - For 'overlay' mode, **skip derivation**, use the provided query directly
   - New param in `RunCompareLoadParams` interface (line 141):
     ```typescript
     interface RunCompareLoadParams {
       query: Query;
       mode: CompareMode;
       overlayQuery?: Query;  // NEW: explicit 2nd query for 'overlay' mode
       // existing fields...
     }
     ```

3. **Modify `runCompareLoad` logic** (line 174-245):
   ```typescript
   export async function runCompareLoad(
     params: RunCompareLoadParams,
   ): Promise<CompareLoadResult> {
     const { query, mode, overlayQuery, ...rest } = params;
     
     let compareQuery: Query | null;
     if (mode === 'overlay' && overlayQuery) {
       compareQuery = overlayQuery;  // Use explicit query
     } else {
       compareQuery = deriveCompareQuery(query, mode as Exclude<CompareMode, 'overlay'>);
     }
     
     // Rest of logic continues as-is (lines 184-244)
   }
   ```

4. **Update `UseCompareResultsInput`** (line 251):
   ```typescript
   interface UseCompareResultsInput {
     query: Query;
     mode: CompareMode;
     overlayQuery?: Query;  // NEW
     // existing fields...
   }
   ```

5. **No changes needed to `mergeByDimKey`** — it already works with any two row sets; the "comparison" is just the 2nd set regardless of origin (prev period, other game, or explicit overlay)

---

## 5. PIN TO DASHBOARD & MERGED STATE

**Current tile payload** (`pin-to-dashboard-modal.tsx:83-88`):
```typescript
await dashboardsClient.addTile(selectedSlug, gameId, {
  title: tileTitle.trim() || 'Query result',
  query_json: queryJson,              // Single query (string)
  viz_type: vizType,
  position_json: JSON.stringify({ x: 0, y: 999, w: 4, h: 3 }),
  chart_type: chartType,              // Single chart type
  pivot_config: pivotConfigJson,      // Single pivot config
});
```

**Gap for merged/dual-axis state:**
- The tile schema has **one query slot** (`query_json`)
- Pinning a merged chart (bar+line from two queries) loses the overlay query
- **Solution required:** extend tile schema to support:
  ```typescript
  {
    query_json: string;           // primary
    overlay_query_json?: string;  // NEW: 2nd query (nullable)
    chart_mode?: 'single' | 'dual-axis';  // NEW: render hint
    chart_type: ChartType;        // which type for each axis? (needs refinement)
  }
  ```
- **OR simpler:** encode overlay + merge state in `chart_type` as a discriminated union:
  - `'line'` → single-axis line (existing)
  - `'dual-axis:bar|line'` → bar on left (from `query_json`), line on right (from `overlay_query_json`)
  - Dashboard tile-reader then unpacks the mode and fetches/merges both queries at tile render time

**Verdict:** Pin assumes single query. Will need **backend API change** to the dashboard tile schema + UI changes to `PinToDashboardModal` to capture overlay query.

---

## 6. HARDEST INTEGRATION POINTS

### Point A: ChartRenderer Type Mismatch (🔴 HARDEST)

**Problem:** `PlaygroundChartRenderer` expects `{resultSet: ResultSet<any>}` — a **single result set from one query**. To render merged dual-axis, we must:
- Either: pass two result sets and merge inside `PlaygroundChartRenderer`
- Or: pre-merge rows in the parent + construct a synthetic `ResultSet` shape

**Current call site:** `QueryBuilderChartResults.tsx:68`
```typescript
<PlaygroundChartRenderer
  query={query}
  chartType={chartType}
  resultSet={resultSet}  // Single only
  pivotConfig={pivotConfig}
  chartHeight={MAX_HEIGHT - 20}
/>
```

**Why hard:** Cube's `ResultSet` class has internal state (`loadResponse`, serialization logic). Creating a fake one is fragile. Better approach:
1. **Create a new component** `DualAxisChartRenderer` that takes `{primaryRows, overlayRows, dimKeys, measures}` and renders a merged dual-axis Recharts chart directly (no `ResultSet` dependency)
2. **Conditional render** in `QueryBuilderChartResults` (line 68):
   ```typescript
   {compareState.mergedRows ? (
     <DualAxisChartRenderer
       mergedRows={compareState.mergedRows}
       chartType={chartType}
       // ...
     />
   ) : (
     <PlaygroundChartRenderer
       resultSet={resultSet}
       // ...
     />
   )}
   ```

### Point B: Compare Mode State Threading

**Problem:** Compare state lives in `QueryBuilderInternals` context (line 150-161), but the chart renderer doesn't know about it today. The compare context is read-only by the right-pane "Compare" tab (compare-pane.tsx).

**Solution:** 
- Extend `CompareContext` to be **consumed by center chart too**
- Wrap `CompareContext.Provider` around **both** center column AND chart pane (already done at line 240-243)
- Center chart checks `useCompareContext()` → if `compareState.mergedRows !== null`, render dual-axis; else render single-axis

---

## 7. CLEAN EXTENSION POINT: URL Codec for Overlay

**Good news:** Compare URL codec (`compare-url-codec.ts`) is **already designed for arbitrary modes**:
- `readCompareFromUrl()` → parses `?compare=<mode>` parameter (line 42-51)
- `writeCompareToUrl()` → updates URL without reload (line 64-84)
- `injectCompareIntoHashUrl()` → embeds compare into deeplinks (line 97-110)

**To enable overlay mode:**
- Extend validation (line 28-32) to accept `'overlay'` as valid
- Deeplink emitters (chat artifact card) append `?compare=overlay` + stash the overlay query in sessionStorage keyed by artifact ID
- Container reads both `pending-chat-deeplink:<id>` (primary) + `pending-overlay-query:<id>` (overlay)
- Thread both queries through to compare hook with `mode: 'overlay'`

---

## SUMMARY TABLE

| Component | File:Line | Current State | Required Change |
|-----------|-----------|---------------|-----------------|
| **Center chart renderer** | `ChartRenderer.tsx:207-367` | Single-axis only | Add Recharts dual-axis pattern (ComposedChart + 2× YAxis) OR create new DualAxisChartRenderer |
| **Chart type union** | `ChartRenderer.tsx:207` | TypeToChartComponent no 'dual-axis' | Add 'dual-axis' case to switch (OR rename to composedChart) |
| **Result set input** | `QueryBuilderChartResults.tsx:55-74` | Single resultSet prop | Add `mergedRows?: MergedRow[]` prop as alternative to resultSet |
| **Compare mode** | `compare-url-codec.ts:24` | `'prev' \| 'game:${string}'` | Extend to include `'overlay'` |
| **Compare query derivation** | `use-compare-results.ts:174` | Always derives 2nd query | Check mode; if 'overlay', use explicit overlayQuery param instead |
| **Dashboard tile schema** | `pin-to-dashboard-modal.tsx:83-88` | One query_json field | Add overlay_query_json + chart_mode discriminator |
| **Deeplink consumption** | `QueryBuilderContainer.tsx:313` | Reads single query from storage | Read overlay query too + pass both to QueryBuilder |
| **QueryBuilder props** | `QueryBuilderInternals.tsx:115-236` | No overlay support | Thread overlayQuery + overlayChartType through to compare hook |

---

## UNRESOLVED QUESTIONS

1. **Dashboard tile schema revision:** Does the backend tile model have versioning? Can we add optional fields without breaking legacy tiles?
2. **Dimension key alignment:** If the two queries have different dimensions (primary on `date + country`, overlay on `date + platform`), how does merge handle non-matching dim keys? Should we warn or fall back to single-axis?
3. **Chart type selector UI:** When dual-axis is active, should "bar/line/area" buttons be disabled? Or allow chart-type-per-axis picker (left axis: bar vs line, right axis: line vs area)?
4. **Compare tab UX:** Does the right-pane "Compare" tab show comparison delta columns when center chart is in dual-axis mode? Or is "Compare" tab orthogonal (own mode switch)?

---

**Report confidence:** 95% — all code paths traced, types verified, integration points identified. No code edits made (read-only research per spec).
