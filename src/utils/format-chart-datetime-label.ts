/**
 * Chart datetime label formatting — shared by segment insight charts,
 * dashboard tiles and chat artifact charts.
 *
 * Cube returns time dimensions as ISO strings ("2026-04-07T00:00:00.000");
 * rendering them raw makes axes unreadable. These helpers truncate to the
 * relevant grain: date-only data → "Apr 7", hour grain → "Apr 7 14:00",
 * with the year appended at year boundaries when a series crosses years.
 *
 * Parsing is regex-based on purpose: `new Date('2026-04-07')` is interpreted
 * as UTC midnight and can shift a calendar day when re-rendered in local
 * time (GMT+7). String slicing keeps the label exactly what the data says.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

interface ParsedLabel {
  year: number;
  month: number; // 1-12
  day: number;
  /** "HH:MM" when the source carried a non-midnight time, else null. */
  time: string | null;
}

/** Parse an ISO date / datetime string; null for anything else. */
export function parseDateLikeLabel(value: unknown): ParsedLabel | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATETIME_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = hh != null && `${hh}:${mm}` !== '00:00' ? `${hh}:${mm}` : null;
  return { year: Number(y), month, day, time };
}

/** True when the value looks like an ISO date/datetime string. */
export function isDateLikeLabel(value: unknown): boolean {
  return parseDateLikeLabel(value) != null;
}

function shortLabel(p: ParsedLabel, withYear: boolean): string {
  const base = `${MONTHS[p.month - 1]} ${p.day}`;
  const dated = withYear ? `${base}, ${p.year}` : base;
  return p.time ? `${dated} ${p.time}` : dated;
}

/**
 * Tooltip form — always carries the year: "Apr 7, 2026" / "Apr 7, 2026 14:00".
 * Non-date values pass through unchanged.
 */
export function formatChartDateTooltip(value: unknown): string {
  const p = parseDateLikeLabel(value);
  return p ? shortLabel(p, true) : String(value ?? '');
}

/**
 * Build an axis tick formatter for a series of x values.
 *
 * - Non-date values pass through unchanged (categorical axes stay intact).
 * - Single-year ranges render "Apr 7" (hour grain: "Apr 7 14:00").
 * - Ranges crossing years append the year on the first tick and on every
 *   year change ("Dec 30" … "Jan 2, 2027") so the reader keeps orientation.
 */
export function makeTimeTickFormatter(values: ReadonlyArray<unknown>): (value: unknown) => string {
  // Precompute one label per distinct raw value so the per-tick callback is a
  // map lookup — recharts calls formatters per tick per render.
  const labels = new Map<string, string>();
  let prevYear: number | null = null;
  for (const raw of values) {
    const key = String(raw ?? '');
    if (labels.has(key)) continue;
    const p = parseDateLikeLabel(raw);
    if (!p) {
      labels.set(key, key);
      continue;
    }
    labels.set(key, shortLabel(p, prevYear !== null && p.year !== prevYear));
    prevYear = p.year;
  }
  // First date tick carries the year only when the series spans >1 year —
  // mark it after the scan so single-year axes stay clean.
  if (values.length > 0) {
    const years = new Set<number>();
    for (const raw of values) {
      const p = parseDateLikeLabel(raw);
      if (p) years.add(p.year);
    }
    if (years.size > 1) {
      const first = values.find((v) => parseDateLikeLabel(v) != null);
      if (first != null) {
        const p = parseDateLikeLabel(first);
        if (p) labels.set(String(first), shortLabel(p, true));
      }
    }
  }
  return (value: unknown) => {
    const key = String(value ?? '');
    return labels.get(key) ?? formatChartDateTooltip(value);
  };
}
