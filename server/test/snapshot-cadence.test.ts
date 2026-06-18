/**
 * Pure-logic tests for snapshot cadence bucket math: floorToCadenceBucket
 * (GMT+7 alignment for daily / N-hour / 15m) and cadenceElapsed (fire-once-per
 * -bucket; 15m tick never re-runs a daily segment within its day).
 */

import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_CADENCES,
  DEFAULT_CADENCE,
  isSnapshotCadence,
  coerceCadence,
  floorToCadenceBucket,
  cadenceElapsed,
  snapshotDateOf,
} from '../src/services/snapshot-cadence.js';

// 2026-06-18 09:37:12 GMT+7  →  UTC 2026-06-18T02:37:12Z.
const T = Date.UTC(2026, 5, 18, 2, 37, 12);

describe('cadence vocabulary', () => {
  it('default is daily and is a known cadence', () => {
    expect(DEFAULT_CADENCE).toBe('daily');
    expect(isSnapshotCadence('daily')).toBe(true);
    expect(isSnapshotCadence('15m')).toBe(true);
    expect(isSnapshotCadence('7m')).toBe(false);
    expect(isSnapshotCadence(null)).toBe(false);
  });

  it('coerceCadence falls back to default for junk', () => {
    expect(coerceCadence('1h')).toBe('1h');
    expect(coerceCadence('nonsense')).toBe('daily');
    expect(coerceCadence(undefined)).toBe('daily');
  });
});

describe('floorToCadenceBucket (GMT+7)', () => {
  it('daily → GMT+7 midnight of that wall-clock day', () => {
    expect(floorToCadenceBucket(T, 'daily')).toBe('2026-06-18 00:00:00');
  });

  it('hour-aligned cadences floor to a multiple of N within the GMT+7 day', () => {
    // 09:37 GMT+7
    expect(floorToCadenceBucket(T, '1h')).toBe('2026-06-18 09:00:00');
    expect(floorToCadenceBucket(T, '3h')).toBe('2026-06-18 09:00:00'); // 9 = 3*3
    expect(floorToCadenceBucket(T, '6h')).toBe('2026-06-18 06:00:00'); // floor(9/6)*6=6
    expect(floorToCadenceBucket(T, '12h')).toBe('2026-06-18 00:00:00'); // floor(9/12)*12=0
  });

  it('15m floors the minute to a multiple of 15', () => {
    expect(floorToCadenceBucket(T, '15m')).toBe('2026-06-18 09:30:00'); // 37 → 30
  });

  it('every cadence yields the fixed YYYY-MM-DD HH:MM:00 shape', () => {
    for (const c of SNAPSHOT_CADENCES) {
      expect(floorToCadenceBucket(T, c)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/);
    }
  });
});

describe('cadenceElapsed', () => {
  it('null last → always due', () => {
    expect(cadenceElapsed(null, T, 'daily')).toBe(true);
    expect(cadenceElapsed(undefined, T, '1h')).toBe(true);
  });

  it('same bucket → not due (idempotent within bucket)', () => {
    const bucket = floorToCadenceBucket(T, '1h');
    expect(cadenceElapsed(bucket, T, '1h')).toBe(false);
  });

  it('15m base tick does NOT re-run a daily segment within its day', () => {
    const dailyBucket = floorToCadenceBucket(T, 'daily');
    // A later tick the same GMT+7 day (15 min later) — daily bucket unchanged.
    const later = T + 15 * 60_000;
    expect(cadenceElapsed(dailyBucket, later, 'daily')).toBe(false);
    // But a 15m segment IS due 15 min later (new 15m bucket).
    const m15 = floorToCadenceBucket(T, '15m');
    expect(cadenceElapsed(m15, later, '15m')).toBe(true);
  });

  it('next GMT+7 day → daily segment due again', () => {
    const dailyBucket = floorToCadenceBucket(T, 'daily');
    const nextDay = T + 24 * 60 * 60_000;
    expect(cadenceElapsed(dailyBucket, nextDay, 'daily')).toBe(true);
  });
});

describe('snapshotDateOf', () => {
  it('extracts the partition date from a snapshot_ts', () => {
    expect(snapshotDateOf('2026-06-18 09:30:00')).toBe('2026-06-18');
  });
});
