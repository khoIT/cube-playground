/**
 * Pure helpers for the push-modal "guided rail" review step:
 *   - friendly, compact rendering of cohort values ("Jun 5" not "2026-06-05T00:00:00.000")
 *   - a weekday restatement for single-day cohorts ("Thu, Jun 5") — the cheapest
 *     defense against off-by-one-day row picks
 *   - a suggested segment name assembled from the selected cohort values
 *
 * Date strings are decomposed via regex (never `new Date(isoString)`) so the
 * runtime timezone can't shift the calendar day (see bucket-range.ts for the
 * full rationale).
 */

import type { CategoricalSummary } from './selection-summary';
import { parseColumnLabel, formatCategoricalValue } from './format-selection-summary';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-06-05[T…]" → { y, m (1-based), d } without Date-constructor TZ pitfalls. */
function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Compact human form of a cohort value: day → "Jun 5", month → "May 2026", else raw. */
export function friendlyCohortValue(value: string, granularity?: string): string {
  const ymd = parseYmd(value);
  if (!ymd) return formatCategoricalValue(value, granularity);
  if (granularity === 'month') return `${MONTHS[ymd.m - 1]} ${ymd.y}`;
  if (granularity === 'year') return String(ymd.y);
  if (granularity === 'week') return `wk of ${MONTHS[ymd.m - 1]} ${ymd.d}`;
  // day / hour / undefined — day-level compactness is right for chips & names
  return `${MONTHS[ymd.m - 1]} ${ymd.d}`;
}

/** "2026-06-05" → "Thu, Jun 5" (local-agnostic). Null when not a date. */
export function weekdayRestatement(value: string): string | null {
  const ymd = parseYmd(value);
  if (!ymd) return null;
  // Date.UTC + getUTCDay: the weekday of a calendar date is TZ-independent
  // as long as construction and read use the same clock.
  const day = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay();
  return `${WEEKDAYS[day]}, ${MONTHS[ymd.m - 1]} ${ymd.d}`;
}

/**
 * Builds a name suggestion from the selected cohort values, e.g.
 *   [{log_date.day: 2026-06-05}]            → "Jun 5"
 *   [{os_platform: android}, {…: 2026-06-05}] → "android · Jun 5"
 * Multi-value columns contribute their top value plus a "+N" marker.
 * Returns '' when there is nothing usable (caller hides the suggest chip).
 */
export function suggestSegmentName(
  categoricals: CategoricalSummary[],
  granularityByCol: Record<string, string | undefined> = {},
): string {
  const parts: string[] = [];
  for (const cat of categoricals.slice(0, 2)) {
    if (cat.topValues.length === 0) continue;
    const { granularity } = parseColumnLabel(cat.column, granularityByCol);
    const head = friendlyCohortValue(cat.topValues[0].value, granularity);
    const extra = cat.topValues.length - 1;
    parts.push(extra > 0 ? `${head} +${extra}` : head);
  }
  return parts.join(' · ');
}
