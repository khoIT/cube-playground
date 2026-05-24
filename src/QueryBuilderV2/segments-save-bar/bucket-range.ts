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

/**
 * Extract `{ year, month, day }` (UTC, month 0-indexed) from any reasonable
 * bucket-start representation, side-stepping JS `Date`-constructor parsing
 * heuristics that flip the result by ±1 day depending on the runtime TZ.
 *
 * Cube returns weekly/monthly bucket labels as ISO datetimes without a `Z`
 * suffix (e.g. `"2026-05-04T00:00:00.000"`). `new Date(...)` parses no-Z ISO
 * strings as *local* time; when the runtime TZ is east of UTC (Asia/Saigon
 * = +07:00), local midnight Mon-May-4 maps to UTC `2026-05-03T17:00:00Z` and
 * `getUTCDate()` returns the wrong calendar day. Manual extraction via regex
 * avoids the Date constructor entirely for strings, while Date/number inputs
 * are read in UTC for symmetry.
 */
function extractUtcYmd(
  raw: unknown,
): { y: number; m: number; d: number } | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
  }
  const d = raw instanceof Date ? raw : new Date(raw as number);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

export function bucketDateRange(
  rawBucketStart: unknown,
  granularity: TimeDimensionGranularity | string | undefined,
): BucketDateRange | null {
  const parts = extractUtcYmd(rawBucketStart);
  if (!parts) return null;
  const start = new Date(Date.UTC(parts.y, parts.m, parts.d));
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
