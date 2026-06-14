/**
 * Ops Console display formatters — money/compact/delta rendering.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { formatVnd, formatInt, formatCompact, formatDeltaPct, formatPct, toNum } from '../pages/OpsConsole/ops-format';

describe('ops-format', () => {
  it('formatVnd scales to B/M/K', () => {
    expect(formatVnd(43_960_000_000)).toBe('₫43.96B');
    expect(formatVnd(2_880_000_000)).toBe('₫2.88B');
    expect(formatVnd(1_731)).toBe('₫1,731');
  });

  it('formatInt groups thousands', () => {
    expect(formatInt(166_732)).toBe('166,732');
  });

  it('formatCompact uses k/M for large counts', () => {
    expect(formatCompact(50_400)).toBe('50.4k');
    expect(formatCompact(1_200_000)).toBe('1.2M');
    expect(formatCompact(842)).toBe('842');
  });

  it('formatDeltaPct signs and nulls', () => {
    expect(formatDeltaPct(0.12)).toBe('+12%');
    expect(formatDeltaPct(-0.04)).toBe('-4%');
    expect(formatDeltaPct(null)).toBe('—');
  });

  it('formatPct + toNum', () => {
    expect(formatPct(0.66)).toBe('66%');
    expect(formatPct(0.0028, 2)).toBe('0.28%');
    expect(formatPct(null)).toBe('—');
    expect(toNum('123.5')).toBe(123.5);
    expect(toNum(null)).toBe(0);
  });
});
