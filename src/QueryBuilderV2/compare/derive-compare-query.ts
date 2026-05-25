/**
 * Pure function: derive a "comparison" Cube query from the current query.
 *
 * Modes:
 *   - 'prev'      — shift the time window backward by its own duration
 *   - 'game:<id>' — replace the game filter value with the target game id
 *
 * DateRange shapes handled:
 *   - named string:  'today', 'yesterday', 'last 7 days', 'last 30 days',
 *                    'last N days', 'last N weeks', 'last N months', 'this week',
 *                    'this month', 'this year', 'QTD', 'MTD', 'YTD'
 *   - literal pair:  ['2026-05-01', '2026-05-07']
 *   - inDateRange filter on the time dimension (shifts both bounds)
 *
 * No React imports — pure I/O, fully testable.
 */

import type { Filter, Query, TimeDimensionGranularity } from '@cubejs-client/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompareMode = 'prev' | `game:${string}`;

interface TimeDimensionWithDateRange {
  dimension: string;
  dateRange?: string | [string, string];
  granularity?: TimeDimensionGranularity;
  compareDateRange?: [string, string][];
}

// ---------------------------------------------------------------------------
// Date math helpers
// ---------------------------------------------------------------------------

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}/;

function toUtcDate(s: string): Date {
  // Cube returns datetimes without trailing Z — parse as UTC explicitly to
  // avoid local-timezone drift.
  const clean = s.length > 10 ? s.replace(' ', 'T').replace(/(\.\d+)?$/, 'Z') : s + 'T00:00:00Z';
  return new Date(clean);
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Subtract `days` from a yyyy-mm-dd string. */
function subtractDays(dateStr: string, days: number): string {
  const d = toUtcDate(dateStr);
  d.setUTCDate(d.getUTCDate() - days);
  return formatDate(d);
}

/** Inclusive day count between two yyyy-mm-dd strings. */
function daysBetween(from: string, to: string): number {
  const a = toUtcDate(from).getTime();
  const b = toUtcDate(to).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Named range shifting
// ---------------------------------------------------------------------------

/**
 * Shift a named dateRange string to its preceding window of the same length.
 * Returns null when the range name is unrecognised (caller uses it as a
 * pass-through and the comparison falls back gracefully).
 */
export function shiftNamedRange(name: string): string | null {
  const lower = name.toLowerCase().trim();

  if (lower === 'today') return 'yesterday';
  if (lower === 'yesterday') {
    // prior day of yesterday = 2 days ago — there is no Cube named range for
    // arbitrary prior days, so we return null and let callers fall back.
    return null;
  }

  // 'last N days/weeks/months'
  const lastN = lower.match(/^last\s+(\d+)\s+(day|week|month)s?$/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const unit = lastN[2];
    // Cube supports "last N days" — we can express "prior last N days" as a
    // literal date range computed relative to today.
    const today = formatDate(new Date());
    if (unit === 'day') {
      const windowEnd = subtractDays(today, n); // day before current window starts
      const windowStart = subtractDays(today, n * 2);
      return `${windowStart} to ${windowEnd}`;
    }
    if (unit === 'week') {
      const days = n * 7;
      const windowEnd = subtractDays(today, days);
      const windowStart = subtractDays(today, days * 2);
      return `${windowStart} to ${windowEnd}`;
    }
    if (unit === 'month') {
      // Approximate: 30-day months for simplicity.
      const days = n * 30;
      const windowEnd = subtractDays(today, days);
      const windowStart = subtractDays(today, days * 2);
      return `${windowStart} to ${windowEnd}`;
    }
  }

  // 'this week' / 'this month' / 'this year'
  if (lower === 'this week') return 'last week';
  if (lower === 'this month') return 'last month';
  if (lower === 'this year') return 'last year';
  if (lower === 'last week' || lower === 'last month' || lower === 'last year') {
    // Double-prior: not expressible as a named range → return null.
    return null;
  }

  // QTD/MTD/YTD — no clean named inverse, return null.
  return null;
}

// ---------------------------------------------------------------------------
// Literal pair shifting
// ---------------------------------------------------------------------------

/**
 * Shift a literal [from, to] pair backward by the window's own duration.
 * e.g. ['2026-05-01', '2026-05-07'] → ['2026-04-24', '2026-04-30'] (7 days).
 */
export function shiftLiteralRange(from: string, to: string): [string, string] {
  const n = daysBetween(from, to);
  const newTo = subtractDays(from, 1);       // day before `from`
  const newFrom = subtractDays(from, n);     // n days before `from`
  return [newFrom, newTo];
}

// ---------------------------------------------------------------------------
// Filter shifting (inDateRange)
// ---------------------------------------------------------------------------

/** Replace inDateRange filter values for the given dimension with shifted ones. */
function shiftInDateRangeFilter(
  filters: Filter[],
  dimension: string,
): Filter[] {
  return filters.map((f): Filter => {
    if ((f as any).member !== dimension) return f;
    if ((f as any).operator !== 'inDateRange') return f;
    const vals: string[] = (f as any).values ?? [];
    if (vals.length !== 2) return f;
    const [newFrom, newTo] = shiftLiteralRange(vals[0], vals[1]);
    return { ...(f as any), values: [newFrom, newTo] } as Filter;
  });
}

// ---------------------------------------------------------------------------
// Game filter swapping
// ---------------------------------------------------------------------------

const GAME_DIM_SUFFIX = '.gameId';

function swapGameFilter(filters: Filter[], targetGameId: string): Filter[] {
  return filters.map((f): Filter => {
    const member = (f as any).member as string | undefined;
    if (member?.endsWith(GAME_DIM_SUFFIX)) {
      return { ...(f as any), values: [targetGameId] } as Filter;
    }
    return f;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Derive the comparison query.
 *
 * Returns null when:
 *  - the mode is 'prev' and no shiftable dateRange is found (caller renders "—")
 *  - the input query itself is null
 */
export function deriveCompareQuery(
  query: Query | null | undefined,
  mode: CompareMode,
): Query | null {
  if (!query) return null;

  if (mode.startsWith('game:')) {
    const targetGameId = mode.slice(5);
    const newFilters = swapGameFilter((query.filters ?? []) as Filter[], targetGameId);
    return { ...query, filters: newFilters };
  }

  // mode === 'prev'
  const timeDimensions = (query.timeDimensions ?? []) as TimeDimensionWithDateRange[];

  if (timeDimensions.length > 0) {
    const newTimeDimensions = timeDimensions.map((td) => {
      const { dateRange } = td;
      if (!dateRange) return td;

      if (typeof dateRange === 'string') {
        const shifted = shiftNamedRange(dateRange);
        if (!shifted) {
          // Unrecognised named range — drop dateRange entirely so comparison
          // runs without a time window (caller renders "—" for delta columns).
          const { dateRange: _dropped, ...rest } = td;
          return rest;
        }
        return { ...td, dateRange: shifted };
      }

      if (Array.isArray(dateRange) && dateRange.length === 2) {
        const from = dateRange[0];
        const to = dateRange[1];
        if (YYYY_MM_DD.test(from) && YYYY_MM_DD.test(to)) {
          return { ...td, dateRange: shiftLiteralRange(from, to) };
        }
      }

      return td;
    });

    return { ...query, timeDimensions: newTimeDimensions as Query['timeDimensions'] };
  }

  // No timeDimensions — try shifting inDateRange filters.
  const filters = (query.filters ?? []) as Filter[];
  const hasInDateRange = filters.some((f) => (f as any).operator === 'inDateRange');
  if (hasInDateRange) {
    // Shift every inDateRange filter (there may be multiple time dimensions).
    let shifted = [...filters];
    for (const f of filters) {
      if ((f as any).operator === 'inDateRange') {
        shifted = shiftInDateRangeFilter(shifted, (f as any).member);
      }
    }
    return { ...query, filters: shifted };
  }

  return null; // no time dimension found
}
