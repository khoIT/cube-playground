# Chat Service Combined Artifact Emit — Technical Research Report

**Researcher:** claude-researcher  
**Date:** 2026-06-19 17:16 GMT+7  
**Scope:** Feasibility and design of emitting dual-axis combined query artifacts  
**Status:** Ready for implementation planning

---

## Executive Summary

Single-tool new `emit_combined_artifact` is **strongly preferred** over post-process merge. The turn loop already collects artifacts into a simple array; the merge seam is cleanest at tool-call time (LLM decides which queries combine), not after-the-fact. Server-side dual-axis chart construction from aligned rows is viable — no blocker.

---

## 1. Emit Tool Flow & Schema

**File:** `chat-service/src/tools/emit-query-artifact.ts`

### Input Schema (lines 38–56)

```typescript
export const inputSchema = {
  title: z.string().min(1),
  summary: z.string().min(1),
  query: CubeQuerySchema,
  source: z.enum(['business-metric', 'segment', 'raw']),
  sourceRef: z.object({ id: z.string(), name?: z.string() }).optional(),
  chart: ChartSpecSchema.optional(),
};
```

**Note:** LLM is NOT required to provide `chart` inline; if omitted, server derives one (lines 188–210).

### Artifact Assembly (lines 225–237)

```typescript
const artifact: QueryArtifact = {
  id: deeplink.artifactId,
  title: args.title,
  summary: args.summary + coverageSuffix,
  game: ctx.gameId,
  query: effectiveQuery,
  source: args.source,
  sourceRef: args.sourceRef,
  deeplinkUrl: deeplink.url,
  deeplinkVia: deeplink.via,
  payload: deeplink.payload,
  chart,
};
```

**Key detail:** `deeplink.via` is either `'inline'` (URL ≤8KB) or `'session-storage'` (payload stored server-side, URL carries UUID). When `via === 'session-storage'`, `payload` contains the full CubeQuery so FE can round-trip it from the deeplink artifact ID.

### SSE Emission (line 240)

```typescript
ctx.sseEmitter.emit('query_artifact', artifact);
```

---

## 2. Chart Building & Dual-Axis Feasibility

**File:** `chat-service/src/services/chart-spec.ts`

### ChartSpec Type (lines 58–92)

```typescript
export const ChartSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bar'), encoding: BaseEncoding }),
  z.object({ type: z.literal('line'), encoding: BaseEncoding }),
  z.object({ type: z.literal('multi-line'), encoding: SeriesEncoding }),
  // ... 12 chart types total (pie, donut, stacked-bar, heatmap, scatter, etc.)
]);
```

**Verdict:** NO existing `'dual-axis'` chart type. Each ChartSpec has ONE encoding rule: `category` (x), `value` (y), optionally `series` (grouping).

### ChartArtifact Type (lines 116–127)

```typescript
export interface ChartArtifact {
  id: string;
  spec: ChartSpec;
  truncated: boolean;
  originalRowCount: number;
  artifactRef?: string;
  columns?: ChartColumn[];
}
```

**Data shape:** `spec.data` is an array of `Record<string, string | number>`. Server-side chart is built here (not FE computation); chart data lives in the artifact sent over SSE.

### Chart Build Flow (emit-query-artifact.ts:171–210)

1. **LLM-supplied chart:** validated + built (line 173: `buildChartArtifact(args.chart, ...)`)
2. **Fallback (no LLM chart):** rows loaded via `loadCubeRowsCovered` (line 190), then `deriveChartSpec(effectiveQuery, loaded.rows, meta)` (line 199) auto-infers type from query shape.

**Implication:** Dual-axis chart data MUST be built server-side by loading + merging two queries' rows on a shared date key. No FE-side chart computation available.

---

## 3. Two Artifacts, One Turn — Where They Come From

**File:** `chat-service/src/api/turn.ts` (turn loop)

### Artifact Collection (lines ~260–275)

```typescript
const collectedArtifacts: QueryArtifact[] = [];
const collectedCharts: ChartArtifact[] = [];
sseEmitter.on('query_artifact', (artifact: QueryArtifact) => {
  collectedArtifacts.push(artifact);
  emit({ type: 'query_artifact', data: artifact });
});
```

**Flow:**
1. Turn invokes LLM with tools.
2. LLM may call `emit_query_artifact` multiple times (free-form tool calls).
3. Each call emits SSE live + pushes to `collectedArtifacts` array.
4. Turn persists all artifacts on the assistant row (line ~530: `artifacts: collectedArtifacts`).

### No Post-Process Merge Today

Currently, all artifact emission is **synchronous + immediate**: each tool call → emit → array append → live SSE. There is NO post-process step that inspects `collectedArtifacts` after the turn finishes.

**Implication:** Merge must happen BEFORE emission, not after. This strongly favors a NEW TOOL.

---

## 4. Tool Registration & Invocation Seam

**File:** `chat-service/src/tools/registry.ts`

### Registration Pattern (lines 46–120+)

```typescript
const REGISTRY: RegistryEntry[] = [
  {
    name: emitQueryArtifact.name,
    description: emitQueryArtifact.description,
    inputSchema: emitQueryArtifact.inputSchema,
    handler: emitQueryArtifact.handler,
  },
  // ... 20+ other tools
];
```

Each tool is imported, wrapped, and added to REGISTRY. The `buildSdkTools()` function (line ~250) iterates REGISTRY and returns an SDK-shaped ToolDefinition array passed to the LLM.

**How to add new tool:** Import a new module (e.g., `emit_combined_artifact`), append to REGISTRY with same wrapper. No hardcoded tool list — central registry.

---

## 5. Row Loading & Merge Feasibility

**File:** `chat-service/src/services/load-cube-rows.ts`

### LoadCubeResult Type (lines 53–58)

```typescript
export interface LoadCubeResult {
  rows: CubeRow[];
  query: CubeQuery;
  snap?: CoverageSnap;
}

type CubeRow = Record<string, string | number>;
```

**Row shape:** Plain JS objects. Example: `{ "active_daily.log_date": "2026-06-19", "active_daily.paying_dau": 45000 }`.

### Function Signature (lines 162–195)

```typescript
export async function loadCubeRowsCovered(
  rawQuery: CubeQuery,
  ctx: ToolContext,
  opts: { maxRows: number; snapOnEmpty?: boolean },
): Promise<LoadCubeResult>
```

**Capability:** Already handles:
- Cache hit/miss + re-execute.
- Coverage snap (empty relative range → snap to latest data window).
- Returns normalized query + rows + snap metadata.

**Merge step:** Can call `loadCubeRowsCovered` for BOTH queries independently, then align on shared date key (e.g., both have `"active_daily.log_date"` or `"mf_users.dteventtime"`). Rows align by date string, then cross-join measures.

---

## 6. Mergeable Query Guardrail

### Validation Checklist

```typescript
// Proposed merge-feasibility check
function canMerge(query1: CubeQuery, query2: CubeQuery): {
  ok: boolean;
  reason?: string;
  dateKey?: string;
} {
  // 1. Both must have exactly 1 timeDimension with dateRange
  const td1 = query1.timeDimensions?.find(t => t.dateRange !== null && t.dateRange !== undefined);
  const td2 = query2.timeDimensions?.find(t => t.dateRange !== null && t.dateRange !== undefined);
  if (!td1 || !td2) return { ok: false, reason: 'both queries must have a timeDimension with dateRange' };
  
  // 2. Same time dimension (e.g., both "active_daily.log_date")
  if (td1.dimension !== td2.dimension) return { ok: false, reason: 'time dimensions must match' };
  
  // 3. Same granularity (day, week, month, etc.)
  if (td1.granularity !== td2.granularity) return { ok: false, reason: 'granularities must match' };
  
  // 4. Same dateRange tuple (after normalization)
  if (JSON.stringify(td1.dateRange) !== JSON.stringify(td2.dateRange)) {
    return { ok: false, reason: 'date ranges must match' };
  }
  
  // 5. No overlapping measures (else ambiguous y-axis)
  const measures1 = new Set(query1.measures ?? []);
  const measures2 = new Set(query2.measures ?? []);
  const overlap = [...measures1].filter(m => measures2.has(m));
  if (overlap.length > 0) return { ok: false, reason: `overlapping measures: ${overlap.join(', ')}` };
  
  return { ok: true, dateKey: td1.dimension };
}
```

**Live types:** TimeDimension (types.ts:16–20), CubeQuery (types.ts:29–38).

---

## 7. Recommendation: NEW TOOL vs POST-PROCESS

### **RECOMMENDATION: NEW TOOL `emit_combined_artifact`** ✓

**Justified by:**

1. **Clean seam at tool-call time.** LLM decides which two queries combine; the tool validates merge-feasibility, loads both queries, aligns rows, builds dual-axis ChartSpec server-side, emits ONE combined artifact. No loose ends.

2. **No retroactive merge.** Post-process merge would run AFTER all tool calls finish (post-turn). At that point, LLM has already decided to emit two separate artifacts live on SSE. Retroactively "un-emit" and replace with one combined card would require:
   - Buffering all artifacts until turn-end (breaks live streaming UX).
   - Detecting "mergeable pairs" via heuristics (fragile; what if only ~30% of measure pairs share a date dimension?).
   - Revising the SSE stream mid-turn (complex error path; violates "emit-once" guarantees).

3. **Reduces tool surface area.** `emit_combined_artifact` is a thin wrapper:
   - Accept `query1`, `query2`, `title`, `summary`.
   - Call `canMerge()` — if false, return error (LLM retries with two separate emit_query_artifact calls).
   - Load both + merge rows on date key.
   - Build dual-axis ChartSpec from merged rows.
   - Emit ONE artifact with BOTH queries in payload so FE deeplink can re-merge them.

4. **Registry is ready.** Tools are modular, centralized in REGISTRY. Adding `emit_combined_artifact` is a one-file add + one REGISTRY entry.

**Dual-Axis ChartSpec Design:** Extend ChartSpecSchema discriminator to include:
```typescript
z.object({
  type: z.literal('dual-axis'),
  title: z.string(),
  data: z.array(DataRowSchema),
  encodingLeft: BaseEncoding.describe('primary y-axis'),
  encodingRight: BaseEncoding.describe('secondary y-axis'),
})
```
Recharts FE renderer (outside scope) uses recharts `ComposedChart` + two `YAxis` instances.

---

## Artifacts & Data Structures

### CubeQuery Type (types.ts:29–38)
```typescript
export interface CubeQuery {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: TimeDimension[];
  filters?: CubeFilter[];
  order?: Record<string, 'asc' | 'desc'> | [string, 'asc' | 'desc'][];
  limit?: number;
  offset?: number;
  segments?: string[];
}
```

### TimeDimension Type (types.ts:16–20)
```typescript
export interface TimeDimension {
  dimension: string;
  granularity?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  dateRange?: string | [string, string];
}
```

### QueryArtifact Type (types.ts:44–58)
```typescript
export interface QueryArtifact {
  id: string;
  title: string;
  summary: string;
  game: string;
  query: CubeQuery;
  source: 'business-metric' | 'segment' | 'raw';
  sourceRef?: { id: string; name?: string };
  previewRows?: number;
  deeplinkUrl: string;
  deeplinkVia: 'inline' | 'session-storage';
  payload?: CubeQuery;
  chart?: ChartArtifact;
}
```

---

## Implementation Path (Draft)

1. **New file:** `chat-service/src/tools/emit-combined-artifact.ts`
   - Export `name`, `description`, `inputSchema`, `handler`.
   - Input: `query1`, `query2`, `title`, `summary`, `sourceRef`.
   - Handler: validate + load + merge + emit.

2. **ChartSpec extension** (chart-spec.ts)
   - Add `'dual-axis'` type to discriminated union.

3. **Registry entry** (registry.ts)
   - Import `emitCombinedArtifact`.
   - Append to REGISTRY.

4. **Tests:** Merge feasibility (same date key, same grain), row alignment, chart build.

---

## Unresolved Questions

1. **Recharts dual-axis rendering:** How should FE render the merged chart? A `ComposedChart` with two `YAxis` instances keyed left/right? (Out of scope — FE work.)
2. **Deeplink round-trip:** When FE opens a dual-axis artifact deeplink in `/build`, does the chart builder support multi-query mode, or does it only render one at a time? (Needs FE clarification.)
3. **Measures scale collision:** If `query1.paying_dau` is ~40k and `query2.revenue_vnd` is ~8M, do we auto-normalize axes or let user adjust? (UX design decision.)

---

## Files Touched

- `chat-service/src/tools/emit-query-artifact.ts` — reference only (no edit)
- `chat-service/src/types.ts` — reference only (QueryArtifact/CubeQuery/TimeDimension)
- `chat-service/src/services/load-cube-rows.ts` — reference only (LoadCubeResult, CubeRow)
- `chat-service/src/services/chart-spec.ts` — reference only (ChartSpec, ChartArtifact)
- `chat-service/src/api/turn.ts` — reference only (artifact collection loop)
- `chat-service/src/tools/registry.ts` — reference only (tool registration pattern)

---

**Environment:** Darwin, GMT+7 (2026-06-19 17:16)  
**Ready:** Yes. Plan-phase research complete; unblocked for implementation planning.
