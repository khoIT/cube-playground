/**
 * normalize-relative-date-range — FE-side rewriter for chat-emitted or
 * manually-shared playground URLs that carry "last N <unit>" strings.
 *
 * Mirrors the chat-service helper of the same name. Kept duplicated rather
 * than shared because the two codebases compile independently.
 *
 * Why: Cube's api-gateway date-parser snaps "last N week/month/quarter/year"
 * to completed calendar units, excluding the current period — surprising for
 * playground users. Only "last N day(s)" is rolling in Cube, so we pass those
 * through.
 *
 * Source of truth for Cube's parser:
 *   @cubejs-backend/api-gateway/dist/src/date-parser.js
 */

import type { Query, TimeDimension } from '@cubejs-client/core';

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
 * Returns a rolling [ISO, ISO] tuple when `s` matches "last N <unit>" for
 * week/month/quarter/year. Otherwise returns `s` unchanged.
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

/**
 * Rewrite calendar-aligned relative strings in a Cube `Query.timeDimensions`
 * to rolling tuples. Returns the same query reference when nothing changed
 * so React memoisation / referential equality checks downstream stay stable.
 */
export function normalizeQueryRelativeDateRanges(
  query: Query | null | undefined,
  now: Date = new Date(),
): Query | null | undefined {
  if (!query || !query.timeDimensions) return query;
  let mutated = false;
  const nextTds = query.timeDimensions.map((td) => {
    if (typeof td.dateRange !== 'string') return td;
    const normalized = normalizeRelativeDateRangeString(td.dateRange, now);
    if (normalized === td.dateRange) return td;
    mutated = true;
    return { ...td, dateRange: normalized } as TimeDimension;
  });
  return mutated ? { ...query, timeDimensions: nextTds } : query;
}
