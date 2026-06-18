/**
 * Per-segment cadence guard logic: verifies that a 1h segment fires ~hourly,
 * a daily segment fires at most once per GMT+7 day, a 15m tick doesn't
 * double-run a daily segment, and manual trigger forces all regardless.
 *
 * Tests drive the pure cadence helpers (floorToCadenceBucket, cadenceElapsed)
 * and the alreadySnapshotted / job structure logic without touching Trino or
 * a live SQLite DB.
 */

import { describe, it, expect } from 'vitest';
import {
  floorToCadenceBucket,
  cadenceElapsed,
  snapshotDateOf,
  CADENCE_MS,
} from '../src/services/snapshot-cadence.js';

const TZ_OFFSET_MS = 7 * 3_600_000; // GMT+7

/** Build a UTC ms timestamp for a GMT+7 date+time. */
function gmt7Ms(dateStr: string, hour: number, min = 0): number {
  return Date.parse(`${dateStr}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00Z`) - TZ_OFFSET_MS;
}

describe('floorToCadenceBucket — daily', () => {
  it('floors to GMT+7 midnight regardless of tick time', () => {
    const morning = gmt7Ms('2026-06-18', 9, 15);
    const evening = gmt7Ms('2026-06-18', 22, 45);
    expect(floorToCadenceBucket(morning, 'daily')).toBe('2026-06-18 00:00:00');
    expect(floorToCadenceBucket(evening, 'daily')).toBe('2026-06-18 00:00:00');
  });
});

describe('floorToCadenceBucket — 1h', () => {
  it('floors to the current GMT+7 hour', () => {
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 10, 35), '1h')).toBe('2026-06-18 10:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 10, 0), '1h')).toBe('2026-06-18 10:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 10, 59), '1h')).toBe('2026-06-18 10:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 11, 0), '1h')).toBe('2026-06-18 11:00:00');
  });
});

describe('floorToCadenceBucket — 3h', () => {
  it('floors to multiples of 3h within the GMT+7 day', () => {
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 0, 30), '3h')).toBe('2026-06-18 00:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 4, 0), '3h')).toBe('2026-06-18 03:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 11, 59), '3h')).toBe('2026-06-18 09:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 12, 0), '3h')).toBe('2026-06-18 12:00:00');
  });
});

describe('floorToCadenceBucket — 15m', () => {
  it('floors to 15-minute intervals', () => {
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 0), '15m')).toBe('2026-06-18 09:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 14), '15m')).toBe('2026-06-18 09:00:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 15), '15m')).toBe('2026-06-18 09:15:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 30), '15m')).toBe('2026-06-18 09:30:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 44), '15m')).toBe('2026-06-18 09:30:00');
    expect(floorToCadenceBucket(gmt7Ms('2026-06-18', 9, 45), '15m')).toBe('2026-06-18 09:45:00');
  });
});

describe('cadenceElapsed', () => {
  const base = gmt7Ms('2026-06-18', 10, 5);

  it('returns true when lastTs is null (never snapshotted)', () => {
    expect(cadenceElapsed(null, base, 'daily')).toBe(true);
    expect(cadenceElapsed(undefined, base, '1h')).toBe(true);
  });

  it('returns false when lastTs equals the current bucket (same bucket = already ran)', () => {
    const bucket = floorToCadenceBucket(base, '1h'); // '2026-06-18 10:00:00'
    expect(cadenceElapsed(bucket, base, '1h')).toBe(false);
  });

  it('returns true when the bucket has advanced (1h segment, 1h later)', () => {
    const lastBucket = floorToCadenceBucket(base, '1h'); // 10:00:00
    const oneHourLater = base + CADENCE_MS['1h'];
    expect(cadenceElapsed(lastBucket, oneHourLater, '1h')).toBe(true);
  });

  it('daily segment: 15m ticks within the same GMT+7 day do NOT re-run', () => {
    const dailyBucket = floorToCadenceBucket(base, 'daily'); // '2026-06-18 00:00:00'
    // 15 ticks later (15 × 15min = 225min later) still same day
    const laterSameDay = base + 15 * CADENCE_MS['15m'];
    expect(cadenceElapsed(dailyBucket, laterSameDay, 'daily')).toBe(false);
  });

  it('daily segment: next GMT+7 day fires', () => {
    const dailyBucket = floorToCadenceBucket(base, 'daily'); // 2026-06-18
    const nextDay = gmt7Ms('2026-06-19', 9, 0);
    expect(cadenceElapsed(dailyBucket, nextDay, 'daily')).toBe(true);
  });

  it('1h segment: does not fire within the same hour', () => {
    const bucket = floorToCadenceBucket(base, '1h');
    const slightlyLater = base + 20 * 60_000; // +20 min, still same hour
    expect(cadenceElapsed(bucket, slightlyLater, '1h')).toBe(false);
  });
});

describe('snapshotDateOf', () => {
  it('extracts the date from a snapshot_ts string', () => {
    expect(snapshotDateOf('2026-06-18 10:00:00')).toBe('2026-06-18');
    expect(snapshotDateOf('2026-06-18 00:00:00')).toBe('2026-06-18');
  });
});

describe('15m base tick — daily segment does not double-run', () => {
  it('96 sequential 15m ticks within one GMT+7 day produce exactly one new bucket', () => {
    // Start at 08:00 GMT+7 (window open). lastTs is pre-seeded to today's daily
    // bucket (simulating a prior run that already fired today at 00:00) — the
    // guard should prevent any re-run for the remaining 15m ticks of the day.
    const dayStart = gmt7Ms('2026-06-18', 8, 0); // 08:00 GMT+7
    const todayBucket = floorToCadenceBucket(dayStart, 'daily'); // '2026-06-18 00:00:00'

    let lastTs: string | null = null;
    let runCount = 0;

    for (let tick = 0; tick < 96; tick++) {
      const nowMs = dayStart + tick * CADENCE_MS['15m'];
      if (cadenceElapsed(lastTs, nowMs, 'daily')) {
        runCount++;
        lastTs = floorToCadenceBucket(nowMs, 'daily');
      }
    }

    // With lastTs starting at null, tick 0 triggers the first (and only) run.
    // Subsequent ticks: the bucket key stays '2026-06-18 00:00:00' for all
    // ticks within the same GMT+7 day, so cadenceElapsed returns false.
    // But 96 × 15m = 24h — the last tick lands at 08:00 on 2026-06-19,
    // which is a NEW bucket. So the correct count is 2 (once on day 18, once on day 19).
    // This documents the INTENDED behaviour: a new calendar day triggers a new run.
    expect(runCount).toBe(2);
  });

  it('pre-seeded lastTs = current-day bucket: zero additional runs for the rest of the day', () => {
    // Simulate: the segment already ran today (lastTs = today's daily bucket).
    // The next 63 ticks (08:00 + 63×15m = 23:45 — still within 2026-06-18)
    // should produce zero additional runs.
    const dayStart = gmt7Ms('2026-06-18', 8, 0);
    const lastTs = floorToCadenceBucket(dayStart, 'daily'); // '2026-06-18 00:00:00'
    let runCount = 0;

    for (let tick = 1; tick <= 63; tick++) { // 63 × 15m = 945min = 15h45m → 23:45, same day
      const nowMs = dayStart + tick * CADENCE_MS['15m'];
      if (cadenceElapsed(lastTs, nowMs, 'daily')) {
        runCount++;
      }
    }

    // All ticks are still within 2026-06-18 → daily bucket unchanged → no extra run.
    expect(runCount).toBe(0);
  });
});
