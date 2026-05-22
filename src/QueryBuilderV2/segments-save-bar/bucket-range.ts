/**
 * Converts a granularity-bucketed time value (the bucket-start timestamp Cube
 * returns for a grouped time dimension) into an inclusive [start, end] date
 * range that uniquely identifies that bucket in a subsequent Cube filter.
 *
 * Used by the expansion query + predicate builder so a cohort row like
 * `{ "mf_users.first_login_date.week": "2026-03-02" }` becomes a per-row
 * constraint `inDateRange("mf_users.first_login_date", ["2026-03-02", "2026-03-08"])`.
 *
 * Granularity semantics (UTC, inclusive end):
 *   day      → [d, d]
 *   week     → [d, d + 6 days]
 *   month    → [d, last day of month]
 *   quarter  → [d, last day of (start + 2 months)]
 *   year     → [d, Dec 31 of that year]
 *   second/minute/hour → [d, d] (point-precision granularity preserved as-is)
 */

import type { TimeDimensionGranularity } from '@cubejs-client/core';

export type BucketDateRange = [string, string];

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function bucketDateRange(
  rawBucketStart: unknown,
  granularity: TimeDimensionGranularity | string | undefined,
): BucketDateRange | null {
  if (rawBucketStart == null) return null;
  const start = new Date(rawBucketStart as string | number | Date);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime());

  switch (granularity) {
    case 'year':
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      end.setUTCDate(end.getUTCDate() - 1);
      break;
    case 'quarter':
      end.setUTCMonth(end.getUTCMonth() + 3);
      end.setUTCDate(end.getUTCDate() - 1);
      break;
    case 'month':
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(end.getUTCDate() - 1);
      break;
    case 'week':
      end.setUTCDate(end.getUTCDate() + 6);
      break;
    case 'day':
    case 'hour':
    case 'minute':
    case 'second':
    default:
      // single-point bucket — start == end
      break;
  }

  return [toYmd(start), toYmd(end)];
}
