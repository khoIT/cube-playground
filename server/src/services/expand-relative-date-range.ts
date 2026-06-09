/**
 * Expands a Cube-style relative date range string into an absolute
 * `[startISO, endISO]` pair so it can be used as an `inDateRange` filter value
 * (which requires 2 ISO dates, not a relative string).
 *
 * Supported inputs (case-insensitive, trimmed):
 *   - "today"
 *   - "yesterday"
 *   - "this week" / "this month" / "this quarter" / "this year"
 *   - "last week" / "last month" / "last quarter" / "last year"
 *   - "last N hours" / "last N hour"   (precise rolling window — datetime bounds)
 *   - "last N days"  / "last N day"
 *   - "last N weeks" / "last N week"
 *   - "last N months"/ "last N month"
 *
 * Returns null when the input is not recognized — callers should treat that
 * as a malformed predicate (e.g. drop the filter and log).
 */

export function expandRelativeDateRange(
  raw: string,
  now: Date = new Date(),
): [string, string] | null {
  const s = raw.trim().toLowerCase();
  if (s.length === 0) return null;

  if (s === 'today') {
    return [iso(startOfDay(now)), iso(endOfDay(now))];
  }
  if (s === 'yesterday') {
    const y = addDays(now, -1);
    return [iso(startOfDay(y)), iso(endOfDay(y))];
  }

  if (s === 'this week')    return [iso(startOfWeek(now)),   iso(endOfWeek(now))];
  if (s === 'this month')   return [iso(startOfMonth(now)),  iso(endOfMonth(now))];
  if (s === 'this quarter') return [iso(startOfQuarter(now)),iso(endOfQuarter(now))];
  if (s === 'this year')    return [iso(startOfYear(now)),   iso(endOfYear(now))];

  if (s === 'last week') {
    const lw = addDays(startOfWeek(now), -7);
    return [iso(lw), iso(endOfWeek(lw))];
  }
  if (s === 'last month') {
    const lm = addMonths(startOfMonth(now), -1);
    return [iso(lm), iso(endOfMonth(lm))];
  }
  if (s === 'last quarter') {
    const lq = addMonths(startOfQuarter(now), -3);
    return [iso(lq), iso(endOfQuarter(lq))];
  }
  if (s === 'last year') {
    const ly = new Date(now.getFullYear() - 1, 0, 1);
    return [iso(ly), iso(endOfYear(ly))];
  }

  // "last N hours" — a precise rolling window ending now. Sub-day windows
  // (e.g. "last 24 hours") can't be expressed at day granularity, so this branch
  // returns full ISO datetime bounds; Cube accepts datetimes in inDateRange.
  const mh = s.match(/^last (\d+) (hour|hours)$/);
  if (mh) {
    const n = Math.max(1, parseInt(mh[1], 10));
    const start = new Date(now.getTime() - n * 3_600_000);
    return [start.toISOString(), now.toISOString()];
  }

  // "last N days|weeks|months" — N inclusive of today.
  const m = s.match(/^last (\d+) (day|days|week|weeks|month|months)$/);
  if (m) {
    const n = Math.max(1, parseInt(m[1], 10));
    const unit = m[2].replace(/s$/, '') as 'day' | 'week' | 'month';
    if (unit === 'day')   return [iso(startOfDay(addDays(now, -(n - 1)))), iso(endOfDay(now))];
    if (unit === 'week')  return [iso(startOfDay(addDays(now, -(n * 7 - 1)))), iso(endOfDay(now))];
    if (unit === 'month') return [iso(addMonths(startOfDay(now), -(n - 1))), iso(endOfDay(now))];
  }

  return null;
}

/** Milestone day-offsets (days before the as-of date) that count as an anniversary. */
export const ANNIVERSARY_OFFSET_DAYS = [30, 90, 180, 365, 730] as const;

/**
 * Expand an "anniversary" window into a set of single-day `[startISO, endISO]`
 * ranges — one per milestone offset before `now`/the as-of anchor. A member
 * whose date falls on any of these days hit a milestone as of the anchor. Each
 * range is a single calendar day so it composes into an OR of `inDateRange`
 * filters (anniversary is a set of points, not one contiguous window).
 */
export function expandAnniversaryWindows(now: Date = new Date()): [string, string][] {
  return ANNIVERSARY_OFFSET_DAYS.map((n) => {
    const day = addDays(now, -n);
    return [iso(startOfDay(day)), iso(endOfDay(day))] as [string, string];
  });
}

// ── Minimal date helpers (no deps) ────────────────────────────────────────

function iso(d: Date): string {
  // YYYY-MM-DD — Cube accepts this for inDateRange.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function startOfDay(d: Date): Date  { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date    { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function startOfWeek(d: Date): Date {
  // ISO week: Monday = 1, Sunday = 0 → shift to Monday.
  const x = startOfDay(d);
  const dow = x.getDay() || 7;
  return addDays(x, 1 - dow);
}
function endOfWeek(d: Date): Date    { return endOfDay(addDays(startOfWeek(d), 6)); }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date   { return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function endOfQuarter(d: Date): Date  { return endOfDay(new Date(startOfQuarter(d).getFullYear(), startOfQuarter(d).getMonth() + 3, 0)); }
function startOfYear(d: Date): Date  { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d: Date): Date    { return endOfDay(new Date(d.getFullYear(), 11, 31)); }
