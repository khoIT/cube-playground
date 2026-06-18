/**
 * Per-segment snapshot capture cadence — the vocabulary + the bucket math the
 * snapshot job uses to decide WHEN to materialize a segment, and the canonical
 * `snapshot_ts` key it stamps on every row.
 *
 * Capture cadence (here) is distinct from the monitor view's granularity toggle:
 * this controls how often the backend captures; the toggle downsamples captured
 * points at read time. Default 'daily' keeps every existing segment on its prior
 * once-a-day behaviour; only opted-in segments run sub-daily.
 *
 * All time math is in GMT+7 (the ops timezone, matching the job's snapshot_date)
 * so a `snapshot_ts` reads as a wall-clock bucket the operator recognizes. The
 * value is a tz-naive 'YYYY-MM-DD HH:MM:00' string — the canonical bucket key
 * (Trino parses it as a TIMESTAMP literal; SQLite compares it lexically, which
 * is monotonic for this fixed-width format).
 */

export const SNAPSHOT_CADENCES = ['15m', '1h', '3h', '6h', '12h', 'daily'] as const;
export type SnapshotCadence = (typeof SNAPSHOT_CADENCES)[number];

export const DEFAULT_CADENCE: SnapshotCadence = 'daily';

/** Bucket width in ms. Daily is the calendar day (86_400_000). */
export const CADENCE_MS: Record<SnapshotCadence, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '3h': 3 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/** Hours-per-bucket for the sub-daily, hour-aligned cadences (anchored at the
 *  GMT+7 day's 00:00 so buckets tile the day cleanly: e.g. 3h → 00/03/06/…). */
const CADENCE_HOURS: Partial<Record<SnapshotCadence, number>> = {
  '1h': 1,
  '3h': 3,
  '6h': 6,
  '12h': 12,
};

const TZ_OFFSET_MS = 7 * 3_600_000; // GMT+7 (Asia/Saigon)

/** Narrow an arbitrary value to a known cadence (route/DB-read validation). */
export function isSnapshotCadence(value: unknown): value is SnapshotCadence {
  return typeof value === 'string' && (SNAPSHOT_CADENCES as readonly string[]).includes(value);
}

/** Coerce a stored/raw cadence to a valid one, falling back to the default. */
export function coerceCadence(value: unknown): SnapshotCadence {
  return isSnapshotCadence(value) ? value : DEFAULT_CADENCE;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Floor `nowMs` to the start of its cadence bucket, in GMT+7 wall-clock, as the
 * canonical `snapshot_ts` string 'YYYY-MM-DD HH:MM:00'.
 *
 *  - daily  → '<gmt7-date> 00:00:00' (one deterministic key/day regardless of
 *             which tick inside the window actually fires it).
 *  - N-hour → hour floored to a multiple of N within the GMT+7 day.
 *  - 15m    → minute floored to a multiple of 15.
 */
export function floorToCadenceBucket(nowMs: number, cadence: SnapshotCadence): string {
  const d = new Date(nowMs + TZ_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  let h = d.getUTCHours();
  let mi = d.getUTCMinutes();

  if (cadence === 'daily') {
    h = 0;
    mi = 0;
  } else if (cadence === '15m') {
    mi = Math.floor(mi / 15) * 15;
  } else {
    const step = CADENCE_HOURS[cadence] ?? 1;
    h = Math.floor(h / step) * step;
    mi = 0;
  }

  return `${y}-${pad2(mo)}-${pad2(da)} ${pad2(h)}:${pad2(mi)}:00`;
}

/**
 * Whether a new cadence bucket has begun since `lastTs` — i.e. the segment is
 * due to materialize this tick. Fires once per bucket: the current bucket key
 * differs from the last snapshot's. A null `lastTs` (never snapshotted) is due.
 * This is what makes a 15m base tick safe for daily segments — their bucket key
 * only changes at GMT+7 midnight.
 */
export function cadenceElapsed(
  lastTs: string | null | undefined,
  nowMs: number,
  cadence: SnapshotCadence,
): boolean {
  if (!lastTs) return true;
  return floorToCadenceBucket(nowMs, cadence) !== lastTs;
}

/** The calendar date ('YYYY-MM-DD') a `snapshot_ts` belongs to (partition key). */
export function snapshotDateOf(snapshotTs: string): string {
  return snapshotTs.slice(0, 10);
}
