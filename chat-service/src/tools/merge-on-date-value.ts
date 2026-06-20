/**
 * merge-on-date-value — align two independently-loaded Cube result sets onto a
 * single date axis so they can render as one dual-axis chart.
 *
 * Why not Cube-side or merge-by-dim-key: the two series come from different
 * cubes whose date members differ ("active_daily.log_date" vs
 * "user_recharge_daily.log_date"), so keying on the cube-prefixed member never
 * overlaps. We instead project each row's date onto a synthetic `__date` column
 * (the date VALUE, identical across cubes at the same grain) and full-outer join
 * over the union of dates. A date present in only one series keeps its row with
 * the missing side absent (renders as a gap), so asymmetric coverage never drops
 * a date from the axis.
 *
 * Measure columns keep their full Cube member ref as the row key so the chart's
 * columns[] descriptor can resolve their labels/units from /meta.
 */

type CubeRow = Record<string, string | number>;

/** One series: its loaded rows plus the resolved date + value column keys. */
export interface MergeSeries {
  rows: CubeRow[];
  /** Row key carrying the date value, e.g. "active_daily.log_date.day". */
  dateKey: string;
  /** Row key carrying the measure value, e.g. "active_daily.paying_dau". */
  valueKey: string;
}

/** Synthetic shared date column the dual-axis chart's category points at. */
export const MERGED_DATE_KEY = '__date';

/**
 * Full-outer merge of two series on their date value. Returns rows shaped
 * `{ __date, <primary.valueKey>, <overlay.valueKey> }`, sorted ascending by
 * date. A date present in only one series omits the other side's key.
 */
export function mergeOnDateValue(primary: MergeSeries, overlay: MergeSeries): CubeRow[] {
  const byDate = new Map<string, CubeRow>();

  const ingest = (series: MergeSeries) => {
    for (const row of series.rows) {
      const dateVal = row[series.dateKey];
      if (dateVal === undefined || dateVal === null) continue;
      const date = String(dateVal);
      const merged = byDate.get(date) ?? { [MERGED_DATE_KEY]: date };
      const v = row[series.valueKey];
      if (v !== undefined && v !== null) merged[series.valueKey] = v;
      byDate.set(date, merged);
    }
  };

  ingest(primary);
  ingest(overlay);

  return [...byDate.values()].sort((a, b) =>
    String(a[MERGED_DATE_KEY]).localeCompare(String(b[MERGED_DATE_KEY])),
  );
}

/**
 * Resolve the row key Cube used for a member. A granular time dimension is keyed
 * as "cube.member.granularity" (e.g. ".day"); measures/plain dims key on the
 * bare ref. Falls back to any key sharing the member's prefix, then the member
 * itself (so a caller always has a usable key even on an empty row set).
 */
export function resolveRowKey(rows: CubeRow[], member: string, granularity?: string): string {
  const keys = Object.keys(rows[0] ?? {});
  if (granularity && keys.includes(`${member}.${granularity}`)) return `${member}.${granularity}`;
  if (keys.includes(member)) return member;
  return keys.find((k) => k.startsWith(`${member}.`)) ?? member;
}
