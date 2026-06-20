/**
 * chart-spec — shared declarative chart-spec schema + helpers.
 *
 * The LLM produces a ChartSpec; the chat-service validates, applies top-N
 * truncation, and emits the result as a ChartArtifact. The frontend compiles
 * the spec into a recharts component at render time.
 *
 * Schemas live as Zod discriminated unions so the SDK auto-generates JSON
 * schema with per-variant `encoding` requirements (e.g. `stacked-bar` requires
 * `series`).
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard input cap — Zod rejects specs above this row count. */
export const MAX_ROWS = 100;

/** Soft cap applied via truncateTopN — extra rows lumped into one "Other" row. */
export const TOP_N = 30;

/** Pie / donut can't read with more than this many slices. */
export const PIE_MAX_ROWS = 12;

/**
 * Heatmap row cap — one row per (x, y) cell, so a day-of-week × hour grid is
 * 7 × 24 = 168 rows. Higher than MAX_ROWS because cells are cheap to render
 * and truncating would punch holes in the grid.
 */
export const HEATMAP_MAX_ROWS = 400;

// ---------------------------------------------------------------------------
// ChartSpec — Zod discriminated union over the supported chart types
// ---------------------------------------------------------------------------

/** Base data-row shape — string-or-number values keyed by column. */
const DataRowSchema = z.record(z.string(), z.union([z.string(), z.number()]));

const BaseEncoding = z.object({
  category: z.string().min(1).describe('column for x-axis / pie slice / point x'),
  value: z.string().min(1).describe('column for y-axis / pie size / point y'),
});

const SeriesEncoding = BaseEncoding.extend({
  series: z.string().min(1).describe('column for stack / multi-line grouping'),
});

const baseShape = {
  title: z.string().min(1),
  caption: z.string().optional(),
  data: z.array(DataRowSchema).min(1).max(MAX_ROWS),
};

export const ChartSpecSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, type: z.literal('bar'), encoding: BaseEncoding }),
  z.object({ ...baseShape, type: z.literal('horizontal-bar'), encoding: BaseEncoding }),
  z.object({ ...baseShape, type: z.literal('line'), encoding: BaseEncoding }),
  z.object({ ...baseShape, type: z.literal('area'), encoding: BaseEncoding }),
  z.object({ ...baseShape, type: z.literal('scatter'), encoding: BaseEncoding }),
  z.object({
    ...baseShape,
    type: z.literal('pie'),
    encoding: BaseEncoding,
    data: z.array(DataRowSchema).min(1).max(PIE_MAX_ROWS),
  }),
  z.object({
    ...baseShape,
    type: z.literal('donut'),
    encoding: BaseEncoding,
    data: z.array(DataRowSchema).min(1).max(PIE_MAX_ROWS),
  }),
  z.object({ ...baseShape, type: z.literal('stacked-bar'), encoding: SeriesEncoding }),
  z.object({ ...baseShape, type: z.literal('grouped-bar'), encoding: SeriesEncoding }),
  z.object({ ...baseShape, type: z.literal('multi-line'), encoding: SeriesEncoding }),
  // Funnel: ordered conversion steps. `category` is the step label, `value` the
  // count at that step. Rows are kept in submitted order (step order), so the
  // query must order by the funnel's step index — NOT by value.
  z.object({ ...baseShape, type: z.literal('funnel'), encoding: BaseEncoding }),
  // Heatmap: two categorical dimensions × one metric, one row per (x, y) cell.
  // `category` is the x column, `series` the y column, `value` the cell
  // intensity. Higher row cap than other types — a grid is cells, not bars.
  z.object({
    ...baseShape,
    type: z.literal('heatmap'),
    encoding: SeriesEncoding,
    data: z.array(DataRowSchema).min(1).max(HEATMAP_MAX_ROWS),
  }),
  // Dual-axis: two metrics over one (date) category on independent y-axes —
  // bars on the left (`value`), a line on the right (`series`). Emitted by the
  // combined-artifact path when two differently-scaled metrics (e.g. DAU ~tens
  // of thousands vs revenue ~millions) are aligned on a shared date axis; a
  // single shared scale would flatten one of them. The FE renderer reads
  // `value` (left/bars) + `series` (right/line) — same encoding the client-side
  // dual-axis view transform uses.
  z.object({ ...baseShape, type: z.literal('dual-axis'), encoding: SeriesEncoding }),
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type ChartType = ChartSpec['type'];

// ---------------------------------------------------------------------------
// ChartArtifact — the runtime object emitted to SSE and persisted to DB
// ---------------------------------------------------------------------------

/**
 * Per-column descriptor for a chart's data rows. Resolved from /meta so the UI
 * renders deterministic labels (table headers, axis titles) and the manual
 * column-picker knows which columns are numeric (Y-axis eligible) — instead of
 * trusting LLM-invented column names.
 */
export interface ChartColumn {
  /** Row key == Cube member ref, e.g. "mf_users.ltv_total_vnd". */
  key: string;
  /** Display label — meta shortTitle/title, else humanised key. */
  label: string;
  dataType: 'number' | 'string' | 'time';
  kind: 'measure' | 'dimension' | 'timeDimension';
}

export interface ChartArtifact {
  id: string;
  spec: ChartSpec;
  /** True when truncateTopN dropped rows into an "Other" lump. */
  truncated: boolean;
  /** Row count before truncation. */
  originalRowCount: number;
  /** Optional pointer to a query_artifact that produced this data. */
  artifactRef?: string;
  /** Meta-resolved descriptors for every column present in spec.data rows. */
  columns?: ChartColumn[];
}

// ---------------------------------------------------------------------------
// truncateTopN — keep top-N rows by value, sum remainder into "Other"
// ---------------------------------------------------------------------------

interface TruncateResult {
  spec: ChartSpec;
  truncated: boolean;
  originalRowCount: number;
}

export function truncateTopN(spec: ChartSpec, limit = TOP_N): TruncateResult {
  const originalRowCount = spec.data.length;

  // Pie/donut have their own (tighter) cap enforced by Zod — no truncation here.
  // Funnel rows are step-ordered; top-N would drop/reorder steps and break the
  // taper, so it's never truncated either (funnels are inherently few rows).
  // Heatmap rows are grid cells — dropping any would punch holes in the grid,
  // so it relies on its own (higher) Zod cap instead.
  // Line/area/multi-line are time-ordered (a continuous trend): value-sorting
  // and lumping the tail into "Other" would scramble the x-axis and produce a
  // misleading chart. They keep their natural order, bounded by the Zod max.
  if (
    spec.type === 'pie' ||
    spec.type === 'donut' ||
    spec.type === 'funnel' ||
    spec.type === 'heatmap' ||
    spec.type === 'line' ||
    spec.type === 'area' ||
    spec.type === 'multi-line' ||
    // Dual-axis rows are date-ordered; value-sorting + "Other"-lumping would
    // scramble the shared date axis exactly like line/area.
    spec.type === 'dual-axis'
  ) {
    return { spec, truncated: false, originalRowCount };
  }

  if (originalRowCount <= limit) {
    return { spec, truncated: false, originalRowCount };
  }

  const { category, value } = spec.encoding;

  const sorted = [...spec.data].sort((a, b) => {
    const av = Number(a[value]) || 0;
    const bv = Number(b[value]) || 0;
    return bv - av;
  });

  const top = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1);

  // For series-encoded charts, the "Other" row needs the series column too —
  // we lose the per-series breakdown when collapsing, so we drop into a single
  // synthetic row tagged with series='Other' to keep the schema consistent.
  const otherRow: Record<string, string | number> = {
    [category]: 'Other',
    [value]: rest.reduce((sum, r) => sum + (Number(r[value]) || 0), 0),
  };
  if ('series' in spec.encoding) {
    otherRow[spec.encoding.series] = 'Other';
  }

  // Reconstruct spec — narrow back to the discriminated variant via type assertion.
  const truncatedSpec = { ...spec, data: [...top, otherRow] } as ChartSpec;

  return { spec: truncatedSpec, truncated: true, originalRowCount };
}

// ---------------------------------------------------------------------------
// buildChartArtifact — single entry point used by tool handlers
// ---------------------------------------------------------------------------

export function buildChartArtifact(
  spec: ChartSpec,
  opts: { artifactRef?: string } = {},
): ChartArtifact {
  const { spec: truncatedSpec, truncated, originalRowCount } = truncateTopN(spec);
  return {
    id: randomUUID(),
    spec: truncatedSpec,
    truncated,
    originalRowCount,
    artifactRef: opts.artifactRef,
  };
}
