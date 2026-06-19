/**
 * Pure-logic tests for grain-availability.ts — three-state view-grain
 * availability derived from the capture-coverage timeline.
 *
 * Invariants:
 *  - daily is always full (universal floor), even with no capture eras.
 *  - a grain captured across the WHOLE window is full; across SOME of it,
 *    partial; never, unavailable.
 *  - a finer-than-requested era counts as covering the coarser grain.
 *  - finestFullGrain returns the finest grain that is full (>= daily).
 */

import { describe, it, expect } from 'vitest';
import {
  computeGrainAvailability,
  isGrainSelectable,
  finestFullGrain,
} from '../grain-availability';
import type { CaptureEra } from '../../../../../../api/segment-movement-client';

describe('computeGrainAvailability', () => {
  it('treats daily as the universal floor when there are no eras', () => {
    const a = computeGrainAvailability([]);
    expect(a.daily.state).toBe('full');
    expect(a['15m'].state).toBe('unavailable');
    expect(a['1h'].state).toBe('unavailable');
  });

  it('all-daily window → daily full, everything finer unavailable', () => {
    const eras: CaptureEra[] = [
      { from: '2026-05-20 00:00:00', to: '2026-06-18 00:00:00', cadence: 'daily' },
    ];
    const a = computeGrainAvailability(eras);
    expect(a.daily.state).toBe('full');
    expect(a['15m'].state).toBe('unavailable');
  });

  it('15m only for the recent era → 15m partial, daily full', () => {
    // 28 daily days + 2 fine days (the user-reported shape).
    const eras: CaptureEra[] = [
      { from: '2026-05-20 00:00:00', to: '2026-06-16 00:00:00', cadence: 'daily' }, // 28d
      { from: '2026-06-17 00:00:00', to: '2026-06-18 09:15:00', cadence: '15m' }, // 2d
    ];
    const a = computeGrainAvailability(eras);
    expect(a.daily.state).toBe('full');
    expect(a['15m'].state).toBe('partial');
    expect(a['15m'].coveredFraction).toBeGreaterThan(0);
    expect(a['15m'].coveredFraction).toBeLessThan(1);
    // The covered sub-range for 15m points at the fine era.
    expect(a['15m'].range).toEqual({ from: '2026-06-17 00:00:00', to: '2026-06-18 09:15:00' });
  });

  it('a finer era covers coarser grains in full', () => {
    // Whole window captured at 15m → every grain (15m..daily) is full.
    const eras: CaptureEra[] = [
      { from: '2026-06-10 00:00:00', to: '2026-06-18 23:45:00', cadence: '15m' },
    ];
    const a = computeGrainAvailability(eras);
    expect(a['15m'].state).toBe('full');
    expect(a['1h'].state).toBe('full');
    expect(a.daily.state).toBe('full');
  });

  it('1h captured everywhere makes 1h full but 15m unavailable', () => {
    const eras: CaptureEra[] = [
      { from: '2026-06-10 01:00:00', to: '2026-06-18 23:00:00', cadence: '1h' },
    ];
    const a = computeGrainAvailability(eras);
    expect(a['1h'].state).toBe('full');
    expect(a['15m'].state).toBe('unavailable');
    expect(a.daily.state).toBe('full');
  });
});

describe('isGrainSelectable', () => {
  it('full and partial are selectable; unavailable is not', () => {
    expect(isGrainSelectable({ state: 'full', coveredFraction: 1, range: null })).toBe(true);
    expect(isGrainSelectable({ state: 'partial', coveredFraction: 0.3, range: null })).toBe(true);
    expect(isGrainSelectable({ state: 'unavailable', coveredFraction: 0, range: null })).toBe(false);
    expect(isGrainSelectable(undefined)).toBe(false);
  });
});

describe('finestFullGrain', () => {
  it('returns daily when only daily is full', () => {
    const a = computeGrainAvailability([
      { from: '2026-05-20 00:00:00', to: '2026-06-16 00:00:00', cadence: 'daily' },
      { from: '2026-06-17 00:00:00', to: '2026-06-18 09:15:00', cadence: '15m' },
    ]);
    expect(finestFullGrain(a)).toBe('daily');
  });

  it('returns 15m when the whole window is fine-captured', () => {
    const a = computeGrainAvailability([
      { from: '2026-06-10 00:00:00', to: '2026-06-18 23:45:00', cadence: '15m' },
    ]);
    expect(finestFullGrain(a)).toBe('15m');
  });
});
