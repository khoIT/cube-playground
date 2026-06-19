/**
 * Snapshot cron attempt window + the SEGMENT_SNAPSHOT_IGNORE_WINDOW override.
 *
 * Default: the cron only attempts runs in GMT+7 [08:00, 24:00). Local dev sets
 * the override so the 15m tick fires whenever the process is up (the machine
 * isn't online on a predictable daytime schedule, so sub-daily cadences would
 * otherwise never accrue viewable history).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { isWithinSnapshotWindow } from '../src/jobs/snapshot-segment-membership.js';

// 03:00 GMT+7 (= 20:00 UTC the previous day) — outside the [08,24) window.
const OUTSIDE = Date.UTC(2026, 5, 18, 20, 0, 0);
// 10:00 GMT+7 (= 03:00 UTC) — inside the window.
const INSIDE = Date.UTC(2026, 5, 19, 3, 0, 0);

describe('isWithinSnapshotWindow', () => {
  const prev = process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW;
  afterEach(() => {
    if (prev === undefined) delete process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW;
    else process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW = prev;
  });

  it('honors the GMT+7 [08,24) window by default', () => {
    delete process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW;
    expect(isWithinSnapshotWindow(INSIDE)).toBe(true);
    expect(isWithinSnapshotWindow(OUTSIDE)).toBe(false);
  });

  it('always returns true when SEGMENT_SNAPSHOT_IGNORE_WINDOW=true', () => {
    process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW = 'true';
    expect(isWithinSnapshotWindow(OUTSIDE)).toBe(true);
    expect(isWithinSnapshotWindow(INSIDE)).toBe(true);
  });

  it('treats any non-"true" value as window-enabled', () => {
    process.env.SEGMENT_SNAPSHOT_IGNORE_WINDOW = 'false';
    expect(isWithinSnapshotWindow(OUTSIDE)).toBe(false);
  });
});
