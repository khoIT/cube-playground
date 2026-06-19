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

export const SNAPSHOT_CADENCES = ['15m', '30m', '1h', '3h', '6h', '12h', 'daily'] as const;
export type SnapshotCadence = (typeof SNAPSHOT_CADENCES)[number];

export const DEFAULT_CADENCE: SnapshotCadence = 'daily';

/** Bucket width in ms. Daily is the calendar day (86_400_000). */
export const CADENCE_MS: Record<SnapshotCadence, number> = {
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '3h': 3 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

/**
 * The operator-facing "Track every" vocabulary: the snapshot cadences plus
 * `Off` (no scheduled tracking — on-demand recompute only, matching a segment
 * whose `refresh_cadence_min` is NULL). A single `track_cadence` field drives
 * BOTH the live recompute and the lakehouse capture so the operator sees one
 * knob; the backend derives the two legacy columns from it (converters below).
 * `Off` is track-only — never a snapshot bucket, so it stays out of
 * SNAPSHOT_CADENCES / CADENCE_MS / the bucket math.
 */
export const TRACK_CADENCES = ['Off', ...SNAPSHOT_CADENCES] as const;
export type TrackCadence = (typeof TRACK_CADENCES)[number];

export const DEFAULT_TRACK_CADENCE: TrackCadence = 'daily';

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
  } else if (cadence === '30m') {
    mi = Math.floor(mi / 30) * 30;
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

// ── Track cadence ↔ legacy columns ───────────────────────────────────────────
// The single source of truth is `track_cadence`; the two legacy columns
// (`refresh_cadence_min`, `snapshot_cadence`) are DERIVED from it so the two
// existing schedulers stay slaved to one operator knob. These pure converters
// are the only place that mapping lives (DRY) — the PATCH route dual-writes via
// them, and the 065 migration's SQL backfill mirrors `refreshMinutesToTrack`.

/** Narrow an arbitrary value to a known track cadence (route validation). */
export function isTrackCadence(value: unknown): value is TrackCadence {
  return typeof value === 'string' && (TRACK_CADENCES as readonly string[]).includes(value);
}

/** Coerce a stored/raw value to a valid track cadence, else the default. */
export function coerceTrackCadence(value: unknown): TrackCadence {
  return isTrackCadence(value) ? value : DEFAULT_TRACK_CADENCE;
}

/** The live-recompute interval (minutes) the cron's age check reads. `Off` →
 *  null = no auto recompute (matches a NULL `refresh_cadence_min`). */
export function trackToRefreshMinutes(track: TrackCadence): number | null {
  if (track === 'Off') return null;
  return Math.round(CADENCE_MS[track] / 60_000);
}

/** The capture cadence the snapshot bucket math reads. `Off` → null = capture
 *  idle (callers leave the stored cadence untouched / gate eligibility on it). */
export function trackToSnapshotCadence(track: TrackCadence): SnapshotCadence | null {
  return track === 'Off' ? null : track;
}

/** Cost-safe map of a recompute interval → track cadence: the finest cadence
 *  whose bucket width is >= the interval, so the derived cadence never fires
 *  MORE often than the old one. NULL interval → `Off`; anything past daily caps
 *  at `daily`. Mirrors the CASE ladder in migration 065. */
export function refreshMinutesToTrack(min: number | null | undefined): TrackCadence {
  if (min == null) return 'Off';
  const wantMs = min * 60_000;
  for (const c of SNAPSHOT_CADENCES) {
    if (CADENCE_MS[c] >= wantMs) return c;
  }
  return 'daily';
}

/** Reference implementation of the cost-safe collapse of the two legacy columns
 *  into one track cadence: capture cadence wins for snapshot-eligible segments;
 *  otherwise derive from the recompute interval. The 065 SQL backfill follows the
 *  same shape, but its eligibility test is a BROADER, display-only proxy
 *  (`predicate + game` only — it omits the job's cube_query_json / schema checks
 *  that this `snapshotEligible` arg would carry). The difference is harmless: the
 *  migration sets only the display column, never the cost-driving cadences. */
export function deriveTrackFromLegacy(args: {
  snapshotEligible: boolean;
  snapshotCadence: unknown;
  refreshCadenceMin: number | null | undefined;
}): TrackCadence {
  if (args.snapshotEligible) return coerceCadence(args.snapshotCadence);
  return refreshMinutesToTrack(args.refreshCadenceMin);
}
