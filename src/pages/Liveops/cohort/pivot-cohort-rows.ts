/**
 * pivotCohortRows — pure function. Converts raw active_daily rows (user_id + day)
 * into cohort retention rows.
 *
 * Definition of "retention" used here:
 *   - A user's cohort day = the FIRST day they appear in the window.
 *   - D0 = cohort day (baseline size).
 *   - DN = count of cohort users who were active on cohort_day + N.
 *
 * This is a "first-seen + re-appearance" definition, appropriate for daily
 * active data where the events table is `active_daily` (one row per user per
 * active day). Document surfaces this definition in the page header tooltip.
 *
 * Not-yet-mature semantics:
 *   The current calendar day is "today". A cohort installed on day D cannot
 *   have a mature DN reading unless today >= D + N. Immature cells are
 *   flagged via `matureMask[n]` = false and must render with a stripe
 *   pattern rather than 0%.
 *
 * Input row shape matches the Cube query in use-cohort-grid.ts:
 *   { 'active_daily.user_id': string, 'active_daily.log_date.day': string }
 */

export interface RawCohortRow {
  'active_daily.user_id': string;
  'active_daily.log_date.day': string;
}

export interface CohortRow {
  /** ISO date string for this cohort (YYYY-MM-DD) */
  installDate: string;
  /** Number of users whose first active day = installDate */
  size: number;
  /** Retained counts for each day-N column */
  d1: number;
  d3: number;
  d7: number;
  d14: number;
  d30: number;
  /** Retention percentages (d1 / size * 100, etc.) */
  d1Pct: number;
  d3Pct: number;
  d7Pct: number;
  d14Pct: number;
  d30Pct: number;
  /**
   * matureMask[i] = true when the cell has had enough time to be fully observed.
   * Index mapping: [0]=d1, [1]=d3, [2]=d7, [3]=d14, [4]=d30
   */
  matureMask: [boolean, boolean, boolean, boolean, boolean];
}

/** Day-N column offsets matched to matureMask index order. */
export const DAY_N_OFFSETS: ReadonlyArray<number> = [1, 3, 7, 14, 30] as const;

/**
 * Adds `days` calendar days to an ISO date string (YYYY-MM-DD).
 * Uses UTC arithmetic to avoid DST shift surprises.
 */
function addDays(isoDate: string, days: number): string {
  const ms = Date.UTC(
    parseInt(isoDate.slice(0, 4), 10),
    parseInt(isoDate.slice(5, 7), 10) - 1,
    parseInt(isoDate.slice(8, 10), 10),
  );
  const result = new Date(ms + days * 86_400_000);
  return result.toISOString().slice(0, 10);
}

/**
 * Converts raw Cube rows into sorted CohortRow[].
 *
 * @param rawRows   Flat rows from active_daily Cube query.
 * @param today     ISO date of "now" — used to compute maturity. Defaults to
 *                  the current UTC date. Inject in tests for determinism.
 * @returns         Rows sorted ascending by installDate (oldest first).
 */
export function pivotCohortRows(
  rawRows: RawCohortRow[],
  today: string = new Date().toISOString().slice(0, 10),
): CohortRow[] {
  if (rawRows.length === 0) return [];

  // Build a Map<userId → Set<day>> of all active days per user.
  const userActiveDays = new Map<string, Set<string>>();
  for (const row of rawRows) {
    const userId = row['active_daily.user_id'];
    const day = (row['active_daily.log_date.day'] ?? '').slice(0, 10);
    if (!userId || !day) continue;

    let days = userActiveDays.get(userId);
    if (!days) {
      days = new Set<string>();
      userActiveDays.set(userId, days);
    }
    days.add(day);
  }

  // Determine each user's first active day = cohort install date.
  const cohortMap = new Map<string, string[]>(); // installDate → userId[]
  for (const [userId, days] of userActiveDays) {
    let firstDay: string | null = null;
    for (const d of days) {
      if (firstDay === null || d < firstDay) firstDay = d;
    }
    if (!firstDay) continue;

    let members = cohortMap.get(firstDay);
    if (!members) {
      members = [];
      cohortMap.set(firstDay, members);
    }
    members.push(userId);
  }

  // Build sorted CohortRow[] for each install date.
  const sortedDates = Array.from(cohortMap.keys()).sort();

  return sortedDates.map((installDate): CohortRow => {
    const members = cohortMap.get(installDate)!;
    const size = members.length;

    // For each day-N offset, count how many cohort users were active on
    // installDate + N.
    const counts = DAY_N_OFFSETS.map((n) => {
      const targetDay = addDays(installDate, n);
      let retained = 0;
      for (const userId of members) {
        if (userActiveDays.get(userId)?.has(targetDay)) retained++;
      }
      return retained;
    });

    const pct = (count: number): number =>
      size > 0 ? Math.round((count / size) * 1000) / 10 : 0;

    // Maturity: the cell is mature when today >= installDate + N.
    const matureMask = DAY_N_OFFSETS.map((n) => addDays(installDate, n) <= today) as [
      boolean, boolean, boolean, boolean, boolean,
    ];

    return {
      installDate,
      size,
      d1: counts[0],
      d3: counts[1],
      d7: counts[2],
      d14: counts[3],
      d30: counts[4],
      d1Pct: pct(counts[0]),
      d3Pct: pct(counts[1]),
      d7Pct: pct(counts[2]),
      d14Pct: pct(counts[3]),
      d30Pct: pct(counts[4]),
      matureMask,
    };
  });
}
