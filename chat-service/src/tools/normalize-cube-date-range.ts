/**
 * normalize-cube-date-range — rewrite chat-emitted "last N <unit>" strings
 * to explicit [start, end] tuples before they reach Cube.
 *
 * Why: Cube's api-gateway date-parser hardcodes calendar-aligned semantics
 * for `last N week/month/quarter/year` —
 *
 *   momentRange = [
 *     start.add(-N, unit).startOf(unit),
 *     end.add(-1,  unit).endOf(unit),
 *   ]
 *
 * On 2026-05-26, `"last 3 months"` resolves to [2026-02-01, 2026-04-30]
 * (May excluded). LLMs and most users intend a rolling window. Only
 * `last N day(s)` is already rolling in Cube, so we pass those through.
 *
 * Strategy: convert non-day "last N <unit>" to a rolling tuple
 *   start = today - N <unit>            (calendar-correct month/year math)
 *   end   = today - 1 day                (matches Cube's day-branch end)
 *
 * Anything else (custom tuples, `today`, `yesterday`, `this X`, `last X`
 * without N, malformed strings) is returned unchanged so Cube keeps full
 * authority over edge cases we don't claim to handle.
 *
 * Source of truth for Cube's parser:
 *   @cubejs-backend/api-gateway/dist/src/date-parser.js
 */

type RollingUnit = 'week' | 'month' | 'quarter' | 'year';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function subtract(date: Date, qty: number, unit: RollingUnit): Date {
  const next = new Date(date);
  switch (unit) {
    case 'week':
      next.setUTCDate(next.getUTCDate() - qty * 7);
      break;
    case 'month':
      next.setUTCMonth(next.getUTCMonth() - qty);
      break;
    case 'quarter':
      next.setUTCMonth(next.getUTCMonth() - qty * 3);
      break;
    case 'year':
      next.setUTCFullYear(next.getUTCFullYear() - qty);
      break;
  }
  return next;
}

const LAST_N_RE = /^last\s+(\d{1,3})\s+(weeks?|months?|quarters?|years?)$/i;

/**
 * If `s` is `"last N week/month/quarter/year"`, return a rolling [ISO, ISO]
 * tuple. Otherwise return `s` unchanged. `now` defaults to Date.now() —
 * pass an explicit Date for deterministic tests.
 */
export function normalizeRelativeDateRangeString(
  s: string,
  now: Date = new Date(),
): string | [string, string] {
  const m = LAST_N_RE.exec(s.trim());
  if (!m) return s;
  const qty = parseInt(m[1], 10);
  if (!Number.isFinite(qty) || qty < 1) return s;
  const unitToken = m[2].toLowerCase();
  const unit: RollingUnit = unitToken.startsWith('week')
    ? 'week'
    : unitToken.startsWith('month')
      ? 'month'
      : unitToken.startsWith('quarter')
        ? 'quarter'
        : 'year';
  const start = subtract(now, qty, unit);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1); // yesterday, matches Cube's day-branch
  return [isoDate(start), isoDate(end)];
}

interface TimeDimensionLike {
  dimension: string;
  granularity?: string;
  dateRange?: string | [string, string];
}

/**
 * Walk a Cube `timeDimensions` array and rewrite calendar-aligned
 * `dateRange` strings to rolling tuples. Tuples and unknown strings are
 * passed through. Returns a new array; input is not mutated.
 */
export function normalizeCubeDateRanges<T extends TimeDimensionLike>(
  tds: T[] | undefined,
  now: Date = new Date(),
): T[] | undefined {
  if (!tds) return tds;
  let mutated = false;
  const next = tds.map((td) => {
    if (typeof td.dateRange !== 'string') return td;
    const normalized = normalizeRelativeDateRangeString(td.dateRange, now);
    if (normalized === td.dateRange) return td;
    mutated = true;
    return { ...td, dateRange: normalized };
  });
  return mutated ? next : tds;
}
