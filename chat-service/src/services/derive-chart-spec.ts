/**
 * derive-chart-spec — deterministically pick a sensible ChartSpec from a Cube
 * query's shape + its result rows, used as the software-level fallback so an
 * emitted query artifact ALWAYS carries a chart even when the LLM omits one.
 *
 * Heuristics (data-shape driven):
 *   - time dimension (has granularity) + a non-time dimension → multi-line
 *   - time dimension only                                     → line
 *   - one non-time dimension + a 2nd grouping dimension       → stacked-bar
 *   - one non-time dimension                                  → bar
 *   - measures only / no usable shape / no rows               → null (skip)
 *
 * Returns null whenever it can't form a valid spec — the caller then ships the
 * artifact chart-less rather than emitting a misleading chart. The candidate is
 * validated against ChartSpecSchema before return, so an invalid derivation
 * (e.g. a missing column key) degrades to null instead of a broken chart.
 */

import { ChartSpecSchema, MAX_ROWS, type ChartSpec } from './chart-spec.js';

type CubeRow = Record<string, string | number>;

interface QueryShape {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{ dimension: string; granularity?: string }>;
}

/**
 * Resolve the actual row-key for a member. Cube keys a granular time dimension
 * as "cube.member.granularity" (e.g. ".day"); measures/plain dimensions key on
 * the bare ref. Falls back to any key sharing the member's prefix.
 */
function rowKeyFor(rows: CubeRow[], member: string, granularity?: string): string | null {
  const keys = Object.keys(rows[0] ?? {});
  if (granularity && keys.includes(`${member}.${granularity}`)) return `${member}.${granularity}`;
  if (keys.includes(member)) return member;
  return keys.find((k) => k.startsWith(`${member}.`)) ?? null;
}

export function deriveChartSpec(query: QueryShape, rows: CubeRow[], _meta?: unknown): ChartSpec | null {
  if (rows.length === 0) return null;

  const measures = query.measures ?? [];
  if (measures.length === 0) return null; // nothing to plot on the value axis

  const value = rowKeyFor(rows, measures[0]);
  if (!value) return null;

  const data = rows.slice(0, MAX_ROWS);
  const title = ''; // caller (emit handler) owns the artifact title; spec title
  // is unused for the fallback's labelling (columns[] drives axis labels), but
  // ChartSpecSchema requires a non-empty string — use the value member as a
  // minimal, honest placeholder.
  const specTitle = title || measures[0];

  const timeDim = (query.timeDimensions ?? []).find((t) => t.granularity);
  const nonTimeDims = query.dimensions ?? [];

  let candidate: ChartSpec | null = null;

  if (timeDim) {
    const category = rowKeyFor(rows, timeDim.dimension, timeDim.granularity);
    if (category) {
      const seriesDim = nonTimeDims[0];
      const series = seriesDim ? rowKeyFor(rows, seriesDim) : null;
      candidate = series
        ? { type: 'multi-line', title: specTitle, data, encoding: { category, value, series } }
        : { type: 'line', title: specTitle, data, encoding: { category, value } };
    }
  } else if (nonTimeDims.length >= 1) {
    const category = rowKeyFor(rows, nonTimeDims[0]);
    if (category) {
      const series = nonTimeDims[1] ? rowKeyFor(rows, nonTimeDims[1]) : null;
      candidate = series
        ? { type: 'stacked-bar', title: specTitle, data, encoding: { category, value, series } }
        : { type: 'bar', title: specTitle, data, encoding: { category, value } };
    }
  }

  if (!candidate) return null;

  // Final guard: only return a spec the schema accepts (valid encoding, row
  // count in range). Anything else degrades to chart-less rather than broken.
  const parsed = ChartSpecSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
