import { describe, it, expect } from 'vitest';
import { cadenceShortLabel, cadenceOptionsFor, CADENCE_OPTIONS } from '../refresh-cadence';

describe('cadenceShortLabel', () => {
  it('renders minutes, hours, and days compactly', () => {
    expect(cadenceShortLabel(5)).toBe('5m');
    expect(cadenceShortLabel(15)).toBe('15m');
    expect(cadenceShortLabel(60)).toBe('1h');
    expect(cadenceShortLabel(360)).toBe('6h');
    expect(cadenceShortLabel(1440)).toBe('1d');
    expect(cadenceShortLabel(2880)).toBe('2d');
    expect(cadenceShortLabel(30)).toBe('30m'); // legacy non-standard value
  });
});

describe('cadenceOptionsFor', () => {
  it('returns the standard set when current is standard', () => {
    expect(cadenceOptionsFor(60)).toEqual(CADENCE_OPTIONS);
  });

  it('prepends a legacy current value so it stays selectable', () => {
    const opts = cadenceOptionsFor(45);
    expect(opts[0].value).toBe(45);
    expect(opts).toHaveLength(CADENCE_OPTIONS.length + 1);
  });
});
