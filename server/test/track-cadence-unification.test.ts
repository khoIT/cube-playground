/**
 * Unit tests for the unified track-cadence vocabulary + converters that collapse
 * the two legacy schedules (refresh_cadence_min recompute + snapshot_cadence
 * capture) into one operator knob.
 *
 * Key invariants:
 *  - 30m is a first-class bucket (minute floored to a multiple of 30, GMT+7).
 *  - track ↔ legacy conversions are cost-safe: a derived recompute interval never
 *    fires MORE often than the cadence implies, and `Off` means no auto recompute.
 *  - deriveTrackFromLegacy mirrors the 065 migration backfill (capture wins for
 *    eligible segments; recompute interval drives the rest).
 */

import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_CADENCES,
  TRACK_CADENCES,
  CADENCE_MS,
  floorToCadenceBucket,
  cadenceElapsed,
  trackToRefreshMinutes,
  trackToSnapshotCadence,
  refreshMinutesToTrack,
  deriveTrackFromLegacy,
} from '../src/services/snapshot-cadence.js';

// A fixed GMT+7 wall-clock instant: 2026-06-19 09:47:00 (+07:00) = 02:47 UTC.
const AT_0947 = Date.UTC(2026, 5, 19, 2, 47, 0);

describe('vocabulary', () => {
  it('30m is a snapshot bucket between 15m and 1h', () => {
    expect(SNAPSHOT_CADENCES).toContain('30m');
    expect(CADENCE_MS['30m']).toBe(30 * 60_000);
  });

  it('TRACK_CADENCES = Off + the snapshot cadences', () => {
    expect(TRACK_CADENCES[0]).toBe('Off');
    expect([...TRACK_CADENCES]).toEqual(['Off', ...SNAPSHOT_CADENCES]);
  });
});

describe('floorToCadenceBucket — 30m', () => {
  it('floors the minute to a multiple of 30 in GMT+7', () => {
    expect(floorToCadenceBucket(AT_0947, '30m')).toBe('2026-06-19 09:30:00');
  });

  it('the half-hour boundary is its own bucket', () => {
    const at_0930 = Date.UTC(2026, 5, 19, 2, 30, 0);
    expect(floorToCadenceBucket(at_0930, '30m')).toBe('2026-06-19 09:30:00');
  });

  it('before the half hour floors to :00', () => {
    const at_0915 = Date.UTC(2026, 5, 19, 2, 15, 0);
    expect(floorToCadenceBucket(at_0915, '30m')).toBe('2026-06-19 09:00:00');
  });

  it('a new 30m bucket fires cadenceElapsed', () => {
    expect(cadenceElapsed('2026-06-19 09:00:00', AT_0947, '30m')).toBe(true);
    expect(cadenceElapsed('2026-06-19 09:30:00', AT_0947, '30m')).toBe(false);
  });
});

describe('trackToRefreshMinutes', () => {
  it('Off → null (no auto recompute)', () => {
    expect(trackToRefreshMinutes('Off')).toBeNull();
  });

  it('maps each cadence to its bucket width in minutes', () => {
    expect(trackToRefreshMinutes('15m')).toBe(15);
    expect(trackToRefreshMinutes('30m')).toBe(30);
    expect(trackToRefreshMinutes('1h')).toBe(60);
    expect(trackToRefreshMinutes('3h')).toBe(180);
    expect(trackToRefreshMinutes('6h')).toBe(360);
    expect(trackToRefreshMinutes('12h')).toBe(720);
    expect(trackToRefreshMinutes('daily')).toBe(1440);
  });
});

describe('trackToSnapshotCadence', () => {
  it('Off → null (capture idle)', () => {
    expect(trackToSnapshotCadence('Off')).toBeNull();
  });

  it('every other value maps to itself', () => {
    for (const c of SNAPSHOT_CADENCES) {
      expect(trackToSnapshotCadence(c)).toBe(c);
    }
  });
});

describe('refreshMinutesToTrack — cost-safe (never finer than the interval)', () => {
  it('null → Off', () => {
    expect(refreshMinutesToTrack(null)).toBe('Off');
    expect(refreshMinutesToTrack(undefined)).toBe('Off');
  });

  it('exact bucket widths round-trip', () => {
    expect(refreshMinutesToTrack(15)).toBe('15m');
    expect(refreshMinutesToTrack(30)).toBe('30m');
    expect(refreshMinutesToTrack(60)).toBe('1h');
    expect(refreshMinutesToTrack(180)).toBe('3h');
    expect(refreshMinutesToTrack(360)).toBe('6h');
    expect(refreshMinutesToTrack(720)).toBe('12h');
    expect(refreshMinutesToTrack(1440)).toBe('daily');
  });

  it('a value between buckets rounds UP to the coarser one (fires no more often)', () => {
    expect(refreshMinutesToTrack(20)).toBe('30m'); // every 20m → captured every 30m
    expect(refreshMinutesToTrack(45)).toBe('1h');
    expect(refreshMinutesToTrack(90)).toBe('3h');
  });

  it('sub-15m floors to the finest bucket; past daily caps at daily', () => {
    expect(refreshMinutesToTrack(5)).toBe('15m');
    expect(refreshMinutesToTrack(5000)).toBe('daily');
  });
});

describe('deriveTrackFromLegacy — mirrors the 065 backfill', () => {
  it('eligible (predicate+game): capture cadence wins', () => {
    expect(
      deriveTrackFromLegacy({ snapshotEligible: true, snapshotCadence: '1h', refreshCadenceMin: 60 }),
    ).toBe('1h');
    // daily snapshot + hourly refresh → daily (no snapshot-cost spike).
    expect(
      deriveTrackFromLegacy({ snapshotEligible: true, snapshotCadence: 'daily', refreshCadenceMin: 60 }),
    ).toBe('daily');
  });

  it('ineligible: derive from the recompute interval', () => {
    expect(
      deriveTrackFromLegacy({ snapshotEligible: false, snapshotCadence: 'daily', refreshCadenceMin: 60 }),
    ).toBe('1h');
    expect(
      deriveTrackFromLegacy({ snapshotEligible: false, snapshotCadence: 'daily', refreshCadenceMin: null }),
    ).toBe('Off');
  });

  it('a bad stored snapshot cadence on an eligible row coerces to daily', () => {
    expect(
      deriveTrackFromLegacy({ snapshotEligible: true, snapshotCadence: 'bogus', refreshCadenceMin: 60 }),
    ).toBe('daily');
  });
});
