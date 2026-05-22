/**
 * Share-of-total helpers used by Results table and Analysis › Breakdown.
 *
 * Sums a measure across all rows client-side so a synthetic "% of total"
 * column can be appended without round-tripping to Cube.
 */

export function sumMeasure(rows: ReadonlyArray<Record<string, unknown>>, measure: string): number {
  let sum = 0;
  for (const row of rows) {
    const v = Number(row?.[measure]);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

export function formatShare(value: unknown, total: number, digits = 1): string {
  if (total === 0) return '—';
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
  return `${((v / total) * 100).toFixed(digits)}%`;
}

/** Synthetic column id used for the `% of total` virtual column. */
export const SHARE_COLUMN_PREFIX = '__pct__';

export function shareColumnId(measure: string): string {
  return `${SHARE_COLUMN_PREFIX}${measure}`;
}

export function isShareColumn(id: string): boolean {
  return id.startsWith(SHARE_COLUMN_PREFIX);
}
