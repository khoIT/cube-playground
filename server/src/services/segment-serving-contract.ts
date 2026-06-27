/**
 * Serving-contract compute for published ("served") segments.
 *
 * Turns the raw lifecycle/cadence/snapshot state into the contract a downstream
 * consumer relies on: when the next snapshot will be ready to pull, which keys are
 * entitled to read it, and whether snapshotting can run at all. Kept pure (no DB,
 * no clock except the injected `nowMs`) so the next-ready math is unit-testable —
 * it's the whole reason the contract exists: never advertise "ready" before a
 * snapshot can actually land.
 *
 * Time math is GMT+7 (Asia/Saigon, fixed +7, no DST), matching the snapshot job's
 * wall-clock buckets. The snapshot cron only fires in [08:00, 24:00) GMT+7, so a
 * cadence bucket that falls in [00:00, 08:00) is clamped FORWARD to that day's
 * 08:00 — otherwise a daily segment whose bucket is 00:00 would claim to be ready
 * eight hours early.
 */

import {
  CADENCE_MS,
  coerceTrackCadence,
  floorToCadenceBucket,
  type SnapshotCadence,
  type TrackCadence,
} from './snapshot-cadence.js';

const TZ_OFFSET_MS = 7 * 3_600_000; // GMT+7
const WINDOW_START_HOUR = 8; // snapshot cron attempt window [08:00, 24:00) GMT+7

/** Read at call-time (not module load) so dev `.env.local` toggles it without a
 *  rebuild — mirrors the snapshot job's own window switch. */
function ignoreWindow(): boolean {
  return (process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW ?? 'false').toLowerCase() === 'true';
}

/** Parse a GMT+7 wall-clock bucket string 'YYYY-MM-DD HH:MM:SS' to epoch ms. */
function bucketStrToMs(bucket: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(bucket);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - TZ_OFFSET_MS;
}

/** Clamp a target time into the [08:00, 24:00) GMT+7 snapshot window. A time
 *  before 08:00 moves forward to that GMT+7 day's 08:00; times already in-window
 *  pass through. No upper clamp: buckets never produce hour >= 24. */
function clampToWindow(ms: number): number {
  if (ignoreWindow()) return ms;
  const local = new Date(ms + TZ_OFFSET_MS);
  if (local.getUTCHours() < WINDOW_START_HOUR) {
    const dayMidnightMs =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0) - TZ_OFFSET_MS;
    return dayMidnightMs + WINDOW_START_HOUR * 3_600_000;
  }
  return ms;
}

/**
 * Next time a fresh snapshot will be ready to pull, as a UTC ISO string (FE
 * renders the countdown in GMT+7). Returns null when the cadence is 'Off' (no
 * scheduled capture — on-demand only).
 *
 * @param cadenceRaw      the segment's track_cadence (coerced; 'Off' → null)
 * @param lastSnapshotAtMs epoch ms of the last successful snapshot run, or null
 * @param nowMs            current epoch ms (injected for testability)
 */
export function computeNextReadyAt(
  cadenceRaw: unknown,
  lastSnapshotAtMs: number | null,
  nowMs: number,
): string | null {
  const track = coerceTrackCadence(cadenceRaw);
  if (track === 'Off') return null;
  const cadence = track as SnapshotCadence;

  const currentBucketStr = floorToCadenceBucket(nowMs, cadence);
  const currentBucketMs = bucketStrToMs(currentBucketStr);

  // Due = the current bucket has not been captured yet (never snapshotted, or the
  // last run's bucket precedes the current one). Due → the current bucket is the
  // next to land; otherwise the next bucket after it.
  const lastBucketStr =
    lastSnapshotAtMs == null ? null : floorToCadenceBucket(lastSnapshotAtMs, cadence);
  const due = lastBucketStr == null || lastBucketStr < currentBucketStr;
  const targetMs = due ? currentBucketMs : currentBucketMs + CADENCE_MS[cadence];

  return new Date(clampToWindow(targetMs)).toISOString();
}

/** A key entitled to read this segment (active, in-scope). Display groups by
 *  key; `appliesVia` distinguishes an explicit segment grant from a wildcard. */
export interface EntitledKey {
  id: string;
  label: string;
  appliesVia: 'segment' | 'all-segments';
  lastUsedAt: string | null;
}

export interface ServingContractInput {
  lifecycle: string;
  servedAt: string | null;
  servedBy: string | null;
  /** Raw track_cadence from the segment row. */
  trackCadence: unknown;
  /** Last successful snapshot run time (UTC 'YYYY-MM-DD HH:MM:SS' or ISO), or null. */
  lastSnapshotAt: string | null;
  snapshotEnabled: boolean;
  entitledKeys: EntitledKey[];
  nowMs: number;
}

export interface ServingContract {
  lifecycle: string;
  servedAt: string | null;
  servedBy: string | null;
  cadence: TrackCadence;
  lastSnapshotAt: string | null;
  nextReadyAt: string | null;
  snapshotEnabled: boolean;
  /** Keys ENTITLED by scope. The headline consumer count is audit-derived
   *  (who actually pulled) and added by the consumption rollup, not here. */
  entitledCount: number;
  entitled: EntitledKey[];
}

/** Parse the snapshot log's `ts` ('YYYY-MM-DD HH:MM:SS', UTC) or an ISO string. */
function snapshotTsToMs(ts: string | null): number | null {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function computeContract(input: ServingContractInput): ServingContract {
  const cadence = coerceTrackCadence(input.trackCadence);
  const lastMs = snapshotTsToMs(input.lastSnapshotAt);
  return {
    lifecycle: input.lifecycle,
    servedAt: input.servedAt,
    servedBy: input.servedBy,
    cadence,
    lastSnapshotAt: input.lastSnapshotAt,
    nextReadyAt: computeNextReadyAt(cadence, lastMs, input.nowMs),
    snapshotEnabled: input.snapshotEnabled,
    entitledCount: input.entitledKeys.length,
    entitled: input.entitledKeys,
  };
}
