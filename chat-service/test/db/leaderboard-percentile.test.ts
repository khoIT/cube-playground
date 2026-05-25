/**
 * Unit tests for percentileSorted helper in leaderboard-store.
 * Covers edge cases: empty, 1-element, 2-element, 3-element, even-count.
 */

import { describe, it, expect } from 'vitest';
import { percentileSorted } from '../../src/db/leaderboard-store.js';

describe('percentileSorted', () => {
  it('returns null for empty array', () => {
    expect(percentileSorted([], 0.5)).toBeNull();
    expect(percentileSorted([], 0.95)).toBeNull();
  });

  it('returns the sole element for 1-element array', () => {
    expect(percentileSorted([42], 0.5)).toBe(42);
    expect(percentileSorted([42], 0.95)).toBe(42);
    expect(percentileSorted([42], 0)).toBe(42);
    expect(percentileSorted([42], 1)).toBe(42);
  });

  it('p50 on 2-element array returns lower element (floor-based)', () => {
    // floor((2-1) * 0.5) = floor(0.5) = 0 → first element
    expect(percentileSorted([10, 20], 0.5)).toBe(10);
  });

  it('p95 on 2-element array returns second element', () => {
    // floor((2-1) * 0.95) = floor(0.95) = 0 → first element
    expect(percentileSorted([10, 20], 0.95)).toBe(10);
  });

  it('p95 on 3-element array returns last element', () => {
    // floor((3-1) * 0.95) = floor(1.9) = 1 → index 1
    expect(percentileSorted([10, 50, 100], 0.95)).toBe(50);
  });

  it('p50 on 4-element array returns index 1 (floor-based median)', () => {
    // floor((4-1) * 0.5) = floor(1.5) = 1
    expect(percentileSorted([10, 20, 30, 40], 0.5)).toBe(20);
  });

  it('p95 on 20-element array', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i + 1); // [1..20]
    // floor((20-1) * 0.95) = floor(18.05) = 18 → value 19
    expect(percentileSorted(arr, 0.95)).toBe(19);
  });

  it('p0 always returns first element', () => {
    expect(percentileSorted([5, 10, 15], 0)).toBe(5);
  });

  it('p1 always returns last element', () => {
    expect(percentileSorted([5, 10, 15], 1)).toBe(15);
  });

  it('handles equal values', () => {
    expect(percentileSorted([100, 100, 100], 0.5)).toBe(100);
    expect(percentileSorted([100, 100, 100], 0.95)).toBe(100);
  });
});
