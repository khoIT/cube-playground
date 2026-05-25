/**
 * Tests for StepWindow window-preset → milliseconds contract.
 * Pure logic — no rendering needed.
 */

import { describe, it, expect } from 'vitest';
import { WINDOW_PRESETS } from '../step-window';

describe('WINDOW_PRESETS', () => {
  it('has exactly 4 presets', () => {
    expect(WINDOW_PRESETS).toHaveLength(4);
  });

  it('1h preset is 3 600 000 ms', () => {
    const h1 = WINDOW_PRESETS.find((p) => p.label === '1 hour');
    expect(h1?.ms).toBe(3_600_000);
  });

  it('24h preset is 86 400 000 ms', () => {
    const h24 = WINDOW_PRESETS.find((p) => p.label === '24 hours');
    expect(h24?.ms).toBe(86_400_000);
  });

  it('7d preset is 604 800 000 ms', () => {
    const d7 = WINDOW_PRESETS.find((p) => p.label === '7 days');
    expect(d7?.ms).toBe(7 * 24 * 3_600_000);
  });

  it('30d preset is 2 592 000 000 ms', () => {
    const d30 = WINDOW_PRESETS.find((p) => p.label === '30 days');
    expect(d30?.ms).toBe(30 * 24 * 3_600_000);
  });

  it('all presets have positive ms values', () => {
    for (const p of WINDOW_PRESETS) {
      expect(p.ms).toBeGreaterThan(0);
    }
  });

  it('presets are ordered ascending by ms', () => {
    const msList = WINDOW_PRESETS.map((p) => p.ms);
    const sorted = [...msList].sort((a, b) => a - b);
    expect(msList).toEqual(sorted);
  });
});

describe('window custom days conversion', () => {
  // Mirrors the calculation in StepWindow component
  function daysToMs(days: number): number {
    return days * 24 * 60 * 60 * 1000;
  }

  it('1 day converts to 86 400 000 ms', () => {
    expect(daysToMs(1)).toBe(86_400_000);
  });

  it('custom 3 days is distinct from any preset', () => {
    const ms = daysToMs(3);
    expect(WINDOW_PRESETS.map((p) => p.ms)).not.toContain(ms);
  });

  it('365 days is the max allowed custom value', () => {
    // Clamp logic: Math.max(1, Math.min(365, value))
    const clamped = (raw: number) => Math.max(1, Math.min(365, raw));
    expect(clamped(0)).toBe(1);
    expect(clamped(366)).toBe(365);
    expect(clamped(30)).toBe(30);
  });
});
