/**
 * The lakehouse snapshot cron only ATTEMPTS its daily run during waking hours
 * [08:00, 24:00) GMT+7. Verifies the hour mapping + window guard so a 03:00
 * tick is a no-op while an 08:00–23:00 tick is allowed. (Manual trigger bypasses
 * the window — that path is covered by its own bypass-by-construction.)
 */

import { describe, expect, it } from 'vitest';
import { gmt7Hour, isWithinSnapshotWindow } from '../src/jobs/snapshot-segment-membership.js';

/** ms for a UTC wall-clock hour on a fixed date — GMT+7 hour = (utcHour + 7) % 24. */
const atUtcHour = (utcHour: number) => Date.UTC(2026, 5, 16, utcHour, 0, 0);

describe('gmt7Hour', () => {
  it('shifts UTC by +7', () => {
    expect(gmt7Hour(atUtcHour(1))).toBe(8); // 01:00Z → 08:00 GMT+7
    expect(gmt7Hour(atUtcHour(17))).toBe(0); // 17:00Z → 00:00 GMT+7 (midnight)
    expect(gmt7Hour(atUtcHour(20))).toBe(3); // 20:00Z → 03:00 GMT+7
  });
});

describe('isWithinSnapshotWindow', () => {
  it('runs inside [08:00, 24:00) GMT+7', () => {
    expect(isWithinSnapshotWindow(atUtcHour(1))).toBe(true); // 08:00
    expect(isWithinSnapshotWindow(atUtcHour(9))).toBe(true); // 16:00
    expect(isWithinSnapshotWindow(atUtcHour(16))).toBe(true); // 23:00
  });

  it('skips outside the window (00:00–07:59 GMT+7)', () => {
    expect(isWithinSnapshotWindow(atUtcHour(17))).toBe(false); // 00:00 (midnight)
    expect(isWithinSnapshotWindow(atUtcHour(20))).toBe(false); // 03:00
    expect(isWithinSnapshotWindow(atUtcHour(0))).toBe(false); // 07:00
  });
});
