/**
 * chart-heatmap-axis-order — canonical ordering for time-like heatmap axes.
 *
 * Heatmap axes preserve submitted row order, but "top N cells by value"
 * queries arrive value-sorted, which scrambles time-like axes (Sun lands
 * before Fri because Sun's best cell beats Fri's). When every axis value is
 * recognisably a weekday, month, hour, or number, we re-sort into natural
 * time order; anything else keeps the submitted order untouched.
 */

const WEEKDAY_INDEX: Record<string, number> = {
  mon: 0, monday: 0,
  tue: 1, tues: 1, tuesday: 1,
  wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4,
  sat: 5, saturday: 5,
  sun: 6, sunday: 6,
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Numeric rank for hour-like / numeric values: 7, "7", "07h", "7h", "07:30".
 * Returns null when the value doesn't parse.
 */
function numericRank(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = value.trim();
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hourish = /^(\d+(?:\.\d+)?)\s*h$/i.exec(s);
  if (hourish) return Number(hourish[1]);
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

/** Rank every value with `rank`, or null if any value fails to rank. */
function rankAll(
  values: Array<string | number>,
  rank: (v: string | number) => number | null,
): number[] | null {
  const ranks: number[] = [];
  for (const v of values) {
    const r = rank(v);
    if (r === null) return null;
    ranks.push(r);
  }
  return ranks;
}

const lookupRank =
  (index: Record<string, number>) =>
  (v: string | number): number | null =>
    index[String(v).trim().toLowerCase()] ?? null;

/**
 * Sorts `values` into natural time order when ALL of them are weekdays,
 * months, or hour-like/numeric values; otherwise returns the input as-is
 * (submitted order is owned by the query for categorical axes).
 */
export function canonicalAxisOrder(values: Array<string | number>): Array<string | number> {
  if (values.length < 2) return values;
  const ranks =
    rankAll(values, lookupRank(WEEKDAY_INDEX)) ??
    rankAll(values, lookupRank(MONTH_INDEX)) ??
    rankAll(values, numericRank);
  if (!ranks) return values;
  return values
    .map((v, i) => ({ v, r: ranks[i] }))
    .sort((a, b) => a.r - b.r)
    .map(({ v }) => v);
}

const WEEKDAY_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Pads a recognisably hour-like or weekday axis to its full natural range
 * (00h..23h, Mon..Sun) so "top N cells by value" grids keep their temporal
 * shape — gaps render as empty slots instead of silently vanishing columns.
 *
 * Expects `values` already in canonical order (see canonicalAxisOrder).
 * Synthesised labels mirror the input style (zero-padding, full vs abbrev
 * weekday names) so existing values still hit the (y, x) cell lookup.
 * Anything unrecognised is returned as-is.
 */
export function padTimeAxis(values: Array<string | number>): Array<string | number> {
  if (values.length < 2) return values;

  // Hour-like "NNh" strings, all within 0–23 → pad to the full 24-hour range.
  if (values.every((v) => typeof v === 'string' && /^\d{1,2}h$/i.test(v.trim()))) {
    const byHour = new Map(values.map((v) => [parseInt(String(v), 10), v]));
    if (Math.max(...byHour.keys()) <= 23) {
      const zeroPadded = values.some((v) => /^0\d/.test(String(v).trim()));
      return Array.from({ length: 24 }, (_, h) =>
        byHour.get(h) ?? (zeroPadded ? `${String(h).padStart(2, '0')}h` : `${h}h`),
      );
    }
    return values;
  }

  // Weekdays → pad to all 7 days.
  const dayRanks = rankAll(values, lookupRank(WEEKDAY_INDEX));
  if (dayRanks) {
    const byDay = new Map(values.map((v, i) => [dayRanks[i], v]));
    const fullNames = values.every((v) => String(v).trim().length > 3);
    const names = fullNames ? WEEKDAY_FULL : WEEKDAY_ABBREV;
    return names.map((name, i) => byDay.get(i) ?? name);
  }

  return values;
}
