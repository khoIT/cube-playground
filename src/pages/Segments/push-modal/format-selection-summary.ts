/**
 * Presentation helpers for the push-modal Selection card. Keeps formatting
 * concerns out of the React render path so the rules are unit-testable and
 * the modal stays declarative.
 *
 * Responsibilities:
 *   - Parse the cube-qualified column key into a compact label
 *     (member name + optional granularity tag).
 *   - Render time-dim values via formatDateByGranularity so the card shows
 *     "2026-05-18 W21" instead of "2026-05-18T00:00:00.000".
 *   - Format numeric scalars with locale separators + 2 decimals.
 *   - Hide per-value counts when the selection only has one row (the count
 *     would always be 1 and adds noise).
 */

import type { TimeDimensionGranularity } from '@cubejs-client/core';
import { formatDateByGranularity } from '../../../QueryBuilderV2/utils/format-date-by-granularity';

export interface ColumnLabel {
  /** Short member name (the trailing segment after the cube prefix). */
  member: string;
  /** Granularity tag, set when the column is a bucketed time dim. */
  granularity?: TimeDimensionGranularity | string;
}

/** Splits `mf_users.first_login_date.week` → { member: 'first_login_date', granularity: 'week' }. */
export function parseColumnLabel(
  column: string,
  granularityByCol: Record<string, string | undefined> = {},
): ColumnLabel {
  const known = granularityByCol[column];
  if (known) {
    const parts = column.split('.');
    parts.pop(); // drop granularity suffix
    const memberFull = parts.join('.');
    const memberShort = memberFull.split('.').slice(1).join('.') || memberFull;
    return { member: memberShort, granularity: known };
  }
  const parts = column.split('.');
  const memberShort = parts.length > 1 ? parts.slice(1).join('.') : column;
  return { member: memberShort };
}

/** Best-effort timestamp detection — Cube returns ISO strings for time dims. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function formatCategoricalValue(
  value: string,
  granularity?: TimeDimensionGranularity | string,
): string {
  if (granularity && (ISO_TIMESTAMP_RE.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value))) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return formatDateByGranularity(d, granularity as TimeDimensionGranularity);
    }
  }
  return value;
}

export function formatNumericScalar(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
