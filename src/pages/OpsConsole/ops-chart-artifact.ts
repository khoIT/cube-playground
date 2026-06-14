/**
 * ops-chart-artifact — pure adapters turning the Ops Overview's data shapes into
 * `ChartArtifact`s the shared chat chart renderer (`AssistantChartSection`)
 * consumes. No React, no side effects.
 *
 * Reusing the chat renderer (instead of the old hand-rolled SVG trend charts)
 * gives the Ops Console chart-type switching, a raw-data table, and CSV export
 * for free. Money columns are keyed with a `_vnd` suffix so the renderer's unit
 * detection formats the axis/tooltip as VND; the human label still carries the
 * ₫ symbol.
 */
import type { ChartArtifact, ChartColumn, ChartSpec } from '../../api/chat-sse-client';

/** Shared category (x-axis) column key for every Ops trend chart. */
const DATE_KEY = 'date';
const DATE_COLUMN: ChartColumn = { key: DATE_KEY, label: 'Date', dataType: 'time', kind: 'timeDimension' };

/**
 * Single-measure daily line (e.g. "Cash collected — daily"). Rows are
 * `{ date, [valueKey]: v }`; a `_vnd`-suffixed valueKey makes the renderer
 * format the axis as VND.
 */
export function lineArtifact(opts: {
  id: string;
  title: string;
  caption?: string;
  dates: string[];
  valueKey: string;
  valueLabel: string;
  values: number[];
}): ChartArtifact {
  const data = opts.dates.map((date, i) => ({ [DATE_KEY]: date, [opts.valueKey]: opts.values[i] ?? 0 }));
  const spec: ChartSpec = {
    type: 'line',
    title: opts.title,
    caption: opts.caption,
    data,
    encoding: { category: DATE_KEY, value: opts.valueKey },
  };
  const columns: ChartColumn[] = [
    DATE_COLUMN,
    { key: opts.valueKey, label: opts.valueLabel, dataType: 'number', kind: 'measure' },
  ];
  return { id: opts.id, spec, truncated: false, originalRowCount: data.length, columns };
}

/**
 * Two measures over the same dates on independent axes (e.g. cash vs payers).
 *
 * The spec is a plain single-axis `line` (category × value) carrying BOTH
 * numeric columns in each row — the renderer's `preferDualAxis` then auto-opens
 * it as the dual-axis combo (left bars = first metric, right line = second).
 * The encoding MUST NOT set `series`: `canDualAxis` requires a bare
 * category × value spec. Row key order matters — the left metric must be the
 * first numeric key (the renderer reads `Object.keys(rows[0])` to order axes).
 */
export function dualMeasureArtifact(opts: {
  id: string;
  title: string;
  caption?: string;
  dates: string[];
  leftKey: string;
  leftLabel: string;
  leftValues: number[];
  rightKey: string;
  rightLabel: string;
  rightValues: number[];
}): ChartArtifact {
  const data = opts.dates.map((date, i) => ({
    [DATE_KEY]: date,
    [opts.leftKey]: opts.leftValues[i] ?? 0,
    [opts.rightKey]: opts.rightValues[i] ?? 0,
  }));
  const spec: ChartSpec = {
    type: 'line',
    title: opts.title,
    caption: opts.caption,
    data,
    encoding: { category: DATE_KEY, value: opts.leftKey },
  };
  const columns: ChartColumn[] = [
    DATE_COLUMN,
    { key: opts.leftKey, label: opts.leftLabel, dataType: 'number', kind: 'measure' },
    { key: opts.rightKey, label: opts.rightLabel, dataType: 'number', kind: 'measure' },
  ];
  return { id: opts.id, spec, truncated: false, originalRowCount: data.length, columns };
}

/**
 * Stacked bars over time, one series per category (e.g. gateway mix). Converts
 * the wide per-day records (`Record<categoryKey, cash>[]`, aligned 1:1 with
 * `dates`) into long rows `{ date, [seriesKey]: cat, [valueKey]: cash }` — the
 * shape the renderer's stacked-bar pivot expects.
 */
export function stackedArtifact(opts: {
  id: string;
  title: string;
  caption?: string;
  dates: string[];
  categories: string[];
  days: Record<string, number>[];
  valueKey?: string;
  valueLabel?: string;
  seriesKey?: string;
  seriesLabel?: string;
}): ChartArtifact {
  const valueKey = opts.valueKey ?? 'cash_vnd';
  const seriesKey = opts.seriesKey ?? 'gateway';
  const data: Array<Record<string, string | number>> = [];
  opts.dates.forEach((date, i) => {
    const rec = opts.days[i] ?? {};
    for (const cat of opts.categories) {
      data.push({ [DATE_KEY]: date, [seriesKey]: cat, [valueKey]: rec[cat] ?? 0 });
    }
  });
  const spec: ChartSpec = {
    type: 'stacked-bar',
    title: opts.title,
    caption: opts.caption,
    data,
    encoding: { category: DATE_KEY, value: valueKey, series: seriesKey },
  };
  const columns: ChartColumn[] = [
    DATE_COLUMN,
    { key: seriesKey, label: opts.seriesLabel ?? 'Gateway', dataType: 'string', kind: 'dimension' },
    { key: valueKey, label: opts.valueLabel ?? 'Cash collected (₫)', dataType: 'number', kind: 'measure' },
  ];
  return { id: opts.id, spec, truncated: false, originalRowCount: data.length, columns };
}

/** ISO day-of-week (1=Mon … 7=Sun, per Trino EXTRACT(DOW)) → weekday abbrev.
 *  The heatmap renderer recognises "Mon".."Sun" and orders/pads them Mon→Sun. */
const ISO_DOW_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Purchase-timing heatmap: cash per (hour-of-day × day-of-week). The renderer
 * puts `category` on the x-axis and `series` on the y-axis, so hour → x (columns)
 * and weekday → y (rows). Hours are emitted as zero-padded "HHh" and weekdays as
 * abbreviations so the renderer's time-axis logic orders + pads them (00h..23h,
 * Mon..Sun) instead of leaving gaps. cash keyed `_vnd` → VND-formatted cells.
 */
export function heatmapArtifact(opts: {
  id: string;
  title: string;
  caption?: string;
  cells: { hour: number; dow: number; cash: number }[];
}): ChartArtifact {
  const HOUR_KEY = 'hour';
  const DOW_KEY = 'weekday';
  const VALUE_KEY = 'cash_vnd';
  const data = opts.cells.map((c) => ({
    [HOUR_KEY]: `${String(c.hour).padStart(2, '0')}h`,
    [DOW_KEY]: ISO_DOW_LABEL[c.dow] ?? String(c.dow),
    [VALUE_KEY]: c.cash,
  }));
  const spec: ChartSpec = {
    type: 'heatmap',
    title: opts.title,
    caption: opts.caption,
    data,
    encoding: { category: HOUR_KEY, value: VALUE_KEY, series: DOW_KEY },
  };
  const columns: ChartColumn[] = [
    { key: HOUR_KEY, label: 'Hour of day', dataType: 'string', kind: 'dimension' },
    { key: DOW_KEY, label: 'Day of week', dataType: 'string', kind: 'dimension' },
    { key: VALUE_KEY, label: 'Cash collected (₫)', dataType: 'number', kind: 'measure' },
  ];
  return { id: opts.id, spec, truncated: false, originalRowCount: data.length, columns };
}

/**
 * Single-category bar (e.g. revenue concentration by payer tier). One row per
 * category; value keyed `_vnd` for VND formatting. The biggest bar (whales)
 * dwarfing the rest is the concentration signal.
 */
export function barArtifact(opts: {
  id: string;
  title: string;
  caption?: string;
  categoryKey: string;
  categoryLabel: string;
  valueKey: string;
  valueLabel: string;
  rows: { category: string; value: number }[];
}): ChartArtifact {
  const data = opts.rows.map((r) => ({ [opts.categoryKey]: r.category, [opts.valueKey]: r.value }));
  const spec: ChartSpec = {
    type: 'bar',
    title: opts.title,
    caption: opts.caption,
    data,
    encoding: { category: opts.categoryKey, value: opts.valueKey },
  };
  const columns: ChartColumn[] = [
    { key: opts.categoryKey, label: opts.categoryLabel, dataType: 'string', kind: 'dimension' },
    { key: opts.valueKey, label: opts.valueLabel, dataType: 'number', kind: 'measure' },
  ];
  return { id: opts.id, spec, truncated: false, originalRowCount: data.length, columns };
}
