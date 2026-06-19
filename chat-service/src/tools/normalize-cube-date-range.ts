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

const MS_PER_DAY = 86_400_000;
const LAST_N_DAYS_RE = /^last\s+(\d{1,4})\s+days?$/i;

function parseIso(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inclusive day span of an ISO tuple, e.g. [d, d] → 1. Null on unparseable. */
function inclusiveSpanDays(from: string, to: string): number | null {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY) + 1;
}

export interface WindowClampResult<T> {
  timeDimensions: T[] | undefined;
  /** True when at least one window was shortened. */
  clamped: boolean;
  /** The new [from, to] of the first clamped window (for disclosure). */
  clampedRange?: [string, string];
}

/**
 * Cap every analysis time window to at most `capDays` (the most RECENT capDays).
 * Bounds cold-Trino scan cost on heavy event cubes where a long window is the
 * slow path. `capDays <= 0` disables the clamp (returns input unchanged).
 *
 * Operates on the post-normalization shape: ISO tuples are clamped by moving
 * `from` forward to `to - (capDays - 1)`; a rolling `"last N days"` string is
 * rewritten to `"last {capDays} days"` when N exceeds the cap. Calendar/edge
 * strings (`today`, `this month`, custom phrases) and already-short windows pass
 * through untouched. Returns a new array only when something changed.
 */
export function clampAnalysisWindows<T extends TimeDimensionLike>(
  tds: T[] | undefined,
  capDays: number,
): WindowClampResult<T> {
  if (!tds || capDays <= 0) return { timeDimensions: tds, clamped: false };

  let clamped = false;
  let clampedRange: [string, string] | undefined;

  const next = tds.map((td) => {
    const dr = td.dateRange;

    if (Array.isArray(dr)) {
      const span = inclusiveSpanDays(dr[0], dr[1]);
      if (span !== null && span > capDays) {
        const to = parseIso(dr[1])!;
        const from = new Date(to.getTime() - (capDays - 1) * MS_PER_DAY);
        const tuple: [string, string] = [isoDate(from), dr[1]];
        clamped = true;
        clampedRange ??= tuple;
        return { ...td, dateRange: tuple };
      }
      return td;
    }

    if (typeof dr === 'string') {
      const m = LAST_N_DAYS_RE.exec(dr.trim());
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > capDays) {
          clamped = true;
          return { ...td, dateRange: `last ${capDays} days` };
        }
      }
    }

    return td;
  });

  return { timeDimensions: clamped ? next : tds, clamped, clampedRange };
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
