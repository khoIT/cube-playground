/**
 * Rebase a multi-series chart so every series starts at 100 at the first shared
 * time point ("indexed" view). When two metrics differ by an order of magnitude
 * a shared linear axis squashes the smaller one flat; indexing to 100 compares
 * SHAPE (relative growth) instead of magnitude, so both trajectories read.
 *
 * Output is always a long-format `multi-line` spec keyed on synthetic series +
 * index columns, regardless of the input shape:
 *   - wide dual-metric (encoding.series is a numeric column) → two series, one
 *     per metric column;
 *   - long multi-line/grouped/stacked (encoding.series is a categorical dim) →
 *     one series per distinct series value;
 *   - single-series → the lone value column.
 *
 * A series whose first value is 0/missing can't be rebased (division by zero);
 * it is dropped and named in the caption so the chart never lies about it.
 */

import type { ChartSpec } from '../../../api/chat-sse-client';

type Row = Record<string, string | number>;

export const INDEX_KEY = '__index';
export const SERIES_KEY = '__series';

function firstFinite(values: Array<string | number>): number | null {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

export function rebaseSeriesToIndex(spec: ChartSpec): ChartSpec {
  const cat = spec.encoding.category;
  const valueKey = spec.encoding.value;
  const seriesKey = spec.encoding.series;
  const out: Row[] = [];
  const skipped: string[] = [];

  const seriesIsNumericColumn =
    seriesKey != null && spec.data.length > 0 && typeof spec.data[0][seriesKey] === 'number';

  if (seriesKey && seriesIsNumericColumn) {
    // Wide dual-metric: each metric column is its own series.
    for (const metric of [valueKey, seriesKey]) {
      const base = firstFinite(spec.data.map((r) => r[metric]));
      if (base == null) {
        skipped.push(metric);
        continue;
      }
      for (const r of spec.data) {
        const n = Number(r[metric]);
        if (!Number.isFinite(n)) continue;
        out.push({ [cat]: r[cat], [SERIES_KEY]: metric, [INDEX_KEY]: (n / base) * 100 });
      }
    }
  } else if (seriesKey) {
    // Long multi-line: group rows by their series value, preserving first-seen order.
    const groups = new Map<string, Row[]>();
    for (const r of spec.data) {
      const k = String(r[seriesKey]);
      const list = groups.get(k);
      if (list) list.push(r);
      else groups.set(k, [r]);
    }
    for (const [sval, rows] of groups) {
      const base = firstFinite(rows.map((r) => r[valueKey]));
      if (base == null) {
        skipped.push(sval);
        continue;
      }
      for (const r of rows) {
        const n = Number(r[valueKey]);
        if (!Number.isFinite(n)) continue;
        out.push({ [cat]: r[cat], [SERIES_KEY]: sval, [INDEX_KEY]: (n / base) * 100 });
      }
    }
  } else {
    // Single series — the value column alone.
    const base = firstFinite(spec.data.map((r) => r[valueKey]));
    if (base != null) {
      for (const r of spec.data) {
        const n = Number(r[valueKey]);
        if (!Number.isFinite(n)) continue;
        out.push({ [cat]: r[cat], [SERIES_KEY]: valueKey, [INDEX_KEY]: (n / base) * 100 });
      }
    }
  }

  const base = 'Indexed to 100 at the first point — compares shape, not magnitude.';
  const caption = skipped.length > 0 ? `${base} Omitted (no non-zero start): ${skipped.join(', ')}.` : base;

  return {
    type: 'multi-line',
    title: spec.title,
    caption,
    data: out,
    encoding: { category: cat, value: INDEX_KEY, series: SERIES_KEY },
  };
}
