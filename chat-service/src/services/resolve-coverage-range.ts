/**
 * resolve-coverage-range — find the latest date a cube/game actually has data
 * for, and compute a "snap" window so an empty query can fall back to a range
 * that DOES have data (instead of rendering an empty chart).
 *
 * Coverage truth comes from the live `get_time_coverage` probe (walks 31-day
 * windows of the real warehouse) — NOT the static seed, which carries prod dates
 * and would snap wrong on a local slice. The probe is up to ~30s, so results are
 * cached per (workspace, game, member): an empty query is the exception, and a
 * cube's latest date moves at most daily.
 *
 * Pure helpers (relative detection, window width, snap math) are split out so
 * they unit-test without a warehouse.
 */

import { handler as getTimeCoverage } from '../tools/get-time-coverage.js';
import type { ToolContext } from '../types.js';

export type DateRange = string | [string, string];

/** Default window width (days) when the requested range gives no usable width. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * A range is "relative" (safe to auto-snap) when the agent left it open or
 * expressed it as a relative phrase ("last 30 days"). An explicit [from,to]
 * tuple is a pinned period the user asked for — never silently moved.
 */
export function isRelativeRange(range: DateRange | undefined): boolean {
  return range == null || typeof range === 'string';
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift an ISO date (YYYY-MM-DD) by whole days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/**
 * Day-width of a requested range so the snapped window matches its size.
 * Tuple → inclusive day count. "last N day/week/month/quarter/year" → N×unit.
 * Anything else → DEFAULT_WINDOW_DAYS.
 */
export function rangeWidthDays(range: DateRange | undefined): number {
  if (Array.isArray(range)) {
    const a = Date.parse(`${range[0]}T00:00:00.000Z`);
    const b = Date.parse(`${range[1]}T00:00:00.000Z`);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      return Math.round((b - a) / 86_400_000) + 1;
    }
    return DEFAULT_WINDOW_DAYS;
  }
  if (typeof range === 'string') {
    const m = /^last\s+(\d{1,4})\s+(day|week|month|quarter|year)s?$/i.exec(range.trim());
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const perUnit =
        unit === 'day' ? 1 : unit === 'week' ? 7 : unit === 'month' ? 30 : unit === 'quarter' ? 91 : 365;
      return Math.max(1, n * perUnit);
    }
  }
  return DEFAULT_WINDOW_DAYS;
}

/** A `width`-day window ending on `latest` (inclusive). */
export function snapWindow(latest: string, width: number): [string, string] {
  return [addDays(latest, -(Math.max(1, width) - 1)), latest];
}

// Cache the (slow) coverage probe — keyed per workspace+game+member. An empty
// query is rare and the latest date moves at most daily, so a modest TTL keeps
// us from re-probing 30s on every miss.
const COVERAGE_TTL_MS = 60 * 60 * 1000; // 1h
const coverageCache = new Map<string, { latest: string | null; at: number }>();
let clock: () => number = () => Date.now();

/**
 * Latest date with data for `member` (e.g. "active_daily.log_date") in the
 * caller's game/workspace, or null if the probe found nothing / timed out.
 * Cached; never throws (a probe failure resolves to null → caller leaves the
 * range as-is and discloses that freshness is unconfirmed).
 */
export async function resolveCoverageLatest(member: string, ctx: ToolContext): Promise<string | null> {
  const key = `${ctx.workspace}#${ctx.gameId}#${member}`;
  const hit = coverageCache.get(key);
  if (hit && clock() - hit.at < COVERAGE_TTL_MS) return hit.latest;

  let latest: string | null = null;
  try {
    const r = (await getTimeCoverage({ member }, ctx)) as { found?: boolean; latestDate?: string };
    latest = r?.found && r.latestDate ? r.latestDate : null;
  } catch {
    latest = null;
  }
  coverageCache.set(key, { latest, at: clock() });
  return latest;
}

/** Test-only: control time. */
export function __setCoverageClockForTest(fn: () => number): void {
  clock = fn;
}
/** Test-only: reset cache + clock. */
export function __resetCoverageForTest(): void {
  coverageCache.clear();
  clock = () => Date.now();
}
