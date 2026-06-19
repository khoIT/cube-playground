/**
 * Range helpers shared by the Monitor tab control bar + range picker.
 *
 * The window is held as inclusive YYYY-MM-DD strings (server `from`/`to`
 * convention). Because sub-daily snapshot reads are capped tighter on the
 * server (it 400s an over-cap explicit range), the tab clamps a wide range down
 * to the active grain's cap BEFORE querying — keeping the most-recent `to` end
 * fixed and reporting whether a clamp happened so the control bar can flag it.
 */

import type { MovementGranularity } from '../../../../../api/segment-movement-client';

/** Grains read at the tighter window cap (mirror server SUBDAILY_GRANULARITIES). */
export const SUBDAILY_GRAINS: ReadonlySet<MovementGranularity> = new Set([
  '15m', '30m', '1h', '3h', '6h', '12h',
]);

/** Mirror the server reader caps (segment-movement-reader.ts). */
export const MAX_DAILY_DAYS = 180;
export const MAX_SUBDAILY_DAYS = 14;

export interface DateRange {
  from: string;
  to: string;
}

/** Today as a YYYY-MM-DD calendar date in GMT+7 (the snapshot writer's tz). */
export function todayInSaigon(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Saigon' });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD strings (1 when equal). */
export function dayCountInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Default window: last 30 days ending today (daily-grain safe). */
export function defaultRange(): DateRange {
  const to = todayInSaigon();
  return { from: addDays(to, -29), to };
}

/** The server day cap for a given view grain. */
export function capForGrain(grain: MovementGranularity): number {
  return SUBDAILY_GRAINS.has(grain) ? MAX_SUBDAILY_DAYS : MAX_DAILY_DAYS;
}

/**
 * Clamp a desired range to the active grain's cap, anchoring the recent (`to`)
 * end so a sub-daily view always shows the latest window. Returns the effective
 * range plus whether it was narrowed, so the control bar can surface a "clamped"
 * note instead of the query silently 400-ing.
 */
export function clampRangeToGrain(
  range: DateRange,
  grain: MovementGranularity,
): { range: DateRange; clamped: boolean } {
  const cap = capForGrain(grain);
  if (dayCountInclusive(range.from, range.to) <= cap) return { range, clamped: false };
  return { range: { from: addDays(range.to, -(cap - 1)), to: range.to }, clamped: true };
}
