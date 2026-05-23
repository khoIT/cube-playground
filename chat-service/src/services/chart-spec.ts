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

// ---------------------------------------------------------------------------
// ChartSpec — Zod discriminated union over the 9 chart types
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
  z.object({ ...baseShape, type: z.literal('multi-line'), encoding: SeriesEncoding }),
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type ChartType = ChartSpec['type'];

// ---------------------------------------------------------------------------
// ChartArtifact — the runtime object emitted to SSE and persisted to DB
// ---------------------------------------------------------------------------

export interface ChartArtifact {
  id: string;
  spec: ChartSpec;
  /** True when truncateTopN dropped rows into an "Other" lump. */
  truncated: boolean;
  /** Row count before truncation. */
  originalRowCount: number;
  /** Optional pointer to a query_artifact that produced this data. */
  artifactRef?: string;
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
  if (spec.type === 'pie' || spec.type === 'donut') {
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
