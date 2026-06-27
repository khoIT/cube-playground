/**
 * Next-ready clamp is the whole reason the serving contract exists: never tell a
 * consumer a snapshot is ready before it can land. The snapshot cron only fires in
 * [08:00, 24:00) GMT+7, so any cadence bucket in [00:00, 08:00) must clamp forward
 * to 08:00 that day.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { computeNextReadyAt } from '../src/services/segment-serving-contract.js';

const TZ = 7 * 3_600_000; // GMT+7
/** Epoch ms for a GMT+7 wall-clock time. */
const gmt7 = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi, 0) - TZ;

describe('computeNextReadyAt — GMT+7 window clamp', () => {
  afterEach(() => {
    delete process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW;
  });

  it('daily bucket at 00:00 clamps forward to 08:00 (never 8h early)', () => {
    // now 10:00, never snapshotted → current daily bucket is today 00:00 → clamp 08:00.
    const got = computeNextReadyAt('daily', null, gmt7(2026, 6, 28, 10));
    expect(got).toBe(new Date(gmt7(2026, 6, 28, 8)).toISOString());
  });

  it('captured daily → next day, still clamped to 08:00', () => {
    const last = gmt7(2026, 6, 28, 0); // today 00:00 bucket already captured
    const got = computeNextReadyAt('daily', last, gmt7(2026, 6, 28, 10));
    expect(got).toBe(new Date(gmt7(2026, 6, 29, 8)).toISOString());
  });

  it('sub-daily bucket inside [00:00,08:00) clamps to 08:00', () => {
    // 3h cadence at 05:00 floors to the 03:00 bucket → before the window → 08:00.
    const got = computeNextReadyAt('3h', null, gmt7(2026, 6, 28, 5));
    expect(got).toBe(new Date(gmt7(2026, 6, 28, 8)).toISOString());
  });

  it('sub-daily bucket inside the window is not clamped', () => {
    // 3h cadence at 13:00 floors to the 12:00 bucket → already in window → unchanged.
    const got = computeNextReadyAt('3h', null, gmt7(2026, 6, 28, 13));
    expect(got).toBe(new Date(gmt7(2026, 6, 28, 12)).toISOString());
  });

  it("cadence 'Off' has no scheduled next-ready", () => {
    expect(computeNextReadyAt('Off', null, gmt7(2026, 6, 28, 10))).toBeNull();
  });

  it('IGNORE_WINDOW (dev) disables the clamp', () => {
    process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW = 'true';
    const got = computeNextReadyAt('daily', null, gmt7(2026, 6, 28, 10));
    expect(got).toBe(new Date(gmt7(2026, 6, 28, 0)).toISOString());
  });
});
