/**
 * Single-source-of-truth re-resolver for a stored time phrase. Given a phrase
 * like "this week" or "last 7 days" the engine extracted on a prior turn, we
 * compute a fresh dateRange against the current clock so day/week/month
 * rollover stays accurate inside a session (and, in phase 2, across sessions).
 *
 * Delegates to the same `resolveDateRanges` rule table the slot-extractor
 * uses, so write-side and read-side semantics cannot diverge.
 */

import { resolveDateRanges, type Granularity } from './date-resolver.js';

export interface ResolvedPhrase {
  dateRange: string | [string, string];
  granularity?: Granularity;
}

/**
 * Resolve a stored phrase to a fresh `dateRange`. Returns null when the
 * phrase no longer matches any rule (e.g. typo on write, future schema
 * change). Caller falls back to the previously stored range.
 */
export function resolveTimePhrase(
  phrase: string | undefined,
  now: number,
): ResolvedPhrase | null {
  if (!phrase) return null;
  const matches = resolveDateRanges(phrase, now);
  if (matches.length === 0) return null;
  const m = matches[0];
  return { dateRange: m.dateRange, granularity: m.granularity };
}
