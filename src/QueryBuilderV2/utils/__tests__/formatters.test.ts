import { describe, it, expect } from 'vitest';
import { formatDuration } from '../formatters';

describe('formatDuration()', () => {
  it('renders sub-second durations in ms (rounded)', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(7.4)).toBe('7ms');
    expect(formatDuration(123)).toBe('123ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('renders 1s..<60s with two-decimal seconds', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1234)).toBe('1.23s');
    expect(formatDuration(59_999)).toBe('60.00s');
  });

  it('renders ≥60s as minutes + seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(65_500)).toBe('1m 5s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });
});
