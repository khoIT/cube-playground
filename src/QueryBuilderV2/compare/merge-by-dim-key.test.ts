/**
 * Tests for merge-by-dim-key.ts
 *
 * Covers: single/multi dim keys, missing rows, NaN/Infinity guards,
 * zero-denominator Δ%, null propagation.
 */

import { describe, it, expect } from 'vitest';
import { mergeByDimKey } from './merge-by-dim-key';
import type { DataRow } from './merge-by-dim-key';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(dims: Record<string, string>, measures: Record<string, number | null>): DataRow {
  return { ...dims, ...measures };
}

// ---------------------------------------------------------------------------
// Basic delta computation
// ---------------------------------------------------------------------------

describe('mergeByDimKey – basic deltas', () => {
  it('computes Δ and Δ% for a single-dim key match', () => {
    const current: DataRow[] = [row({ country: 'VN' }, { revenue: 100 })];
    const comparison: DataRow[] = [row({ country: 'VN' }, { revenue: 80 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['country'],
      measures: ['revenue'],
    });

    expect(merged['revenue__cmp']).toBe(80);
    expect(merged['revenue__delta']).toBe(20);
    expect(merged['revenue__deltaPct']).toBeCloseTo(0.25);
  });

  it('handles negative delta (regression)', () => {
    const current: DataRow[] = [row({ day: '2026-05-01' }, { dau: 500 })];
    const comparison: DataRow[] = [row({ day: '2026-05-01' }, { dau: 600 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['day'],
      measures: ['dau'],
    });

    expect(merged['dau__delta']).toBe(-100);
    expect(merged['dau__deltaPct']).toBeCloseTo(-1 / 6);
  });

  it('handles multiple measures independently', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m1: 10, m2: 200 })];
    const comparison: DataRow[] = [row({ d: 'a' }, { m1: 5, m2: 100 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m1', 'm2'],
    });

    expect(merged['m1__delta']).toBe(5);
    expect(merged['m2__delta']).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Multi-dim composite key
// ---------------------------------------------------------------------------

describe('mergeByDimKey – multi-dim key', () => {
  it('joins on tuple of dimension values', () => {
    const current: DataRow[] = [
      row({ game: 'ptg', day: '2026-05-01' }, { dau: 1000 }),
      row({ game: 'ptg', day: '2026-05-02' }, { dau: 1100 }),
    ];
    const comparison: DataRow[] = [
      row({ game: 'ptg', day: '2026-05-02' }, { dau: 900 }),
      row({ game: 'ptg', day: '2026-05-01' }, { dau: 800 }),
    ];

    const merged = mergeByDimKey(current, comparison, {
      dimKeys: ['game', 'day'],
      measures: ['dau'],
    });

    expect(merged[0]['dau__delta']).toBe(200);  // 1000 - 800
    expect(merged[1]['dau__delta']).toBe(200);  // 1100 - 900
  });

  it('does not confuse rows with same value on one dim but different on another', () => {
    const current: DataRow[] = [
      row({ a: 'x', b: '1' }, { m: 10 }),
      row({ a: 'x', b: '2' }, { m: 20 }),
    ];
    const comparison: DataRow[] = [
      row({ a: 'x', b: '2' }, { m: 5 }),
      row({ a: 'x', b: '1' }, { m: 3 }),
    ];

    const merged = mergeByDimKey(current, comparison, {
      dimKeys: ['a', 'b'],
      measures: ['m'],
    });

    expect(merged[0]['m__delta']).toBe(7);   // 10 - 3
    expect(merged[1]['m__delta']).toBe(15);  // 20 - 5
  });
});

// ---------------------------------------------------------------------------
// Missing rows (left-join semantics)
// ---------------------------------------------------------------------------

describe('mergeByDimKey – missing rows', () => {
  it('keeps all current rows; sets delta columns to null for missing comparison', () => {
    const current: DataRow[] = [
      row({ day: '2026-05-01' }, { dau: 100 }),
      row({ day: '2026-05-02' }, { dau: 110 }),
      row({ day: '2026-05-03' }, { dau: 120 }), // no match in comparison
    ];
    const comparison: DataRow[] = [
      row({ day: '2026-05-01' }, { dau: 90 }),
      row({ day: '2026-05-02' }, { dau: 95 }),
    ];

    const merged = mergeByDimKey(current, comparison, {
      dimKeys: ['day'],
      measures: ['dau'],
    });

    expect(merged).toHaveLength(3);
    expect(merged[2]['dau__cmp']).toBeNull();
    expect(merged[2]['dau__delta']).toBeNull();
    expect(merged[2]['dau__deltaPct']).toBeNull();
  });

  it('comparison set larger than current — extra comparison rows are ignored', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: 10 })];
    const comparison: DataRow[] = [
      row({ d: 'a' }, { m: 8 }),
      row({ d: 'b' }, { m: 5 }),  // no match in current
    ];

    const merged = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]['m__delta']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Case-insensitive key matching (cross-game dimension drift)
// ---------------------------------------------------------------------------

describe('mergeByDimKey – case-insensitive dim values', () => {
  it("aligns 'IOS' with 'ios' across games", () => {
    const current: DataRow[] = [row({ os: 'IOS' }, { rev: 500 })];
    const comparison: DataRow[] = [row({ os: 'ios' }, { rev: 200 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['os'],
      measures: ['rev'],
    });

    expect(merged['rev__cmp']).toBe(200);
    expect(merged['rev__delta']).toBe(300);
  });

  it('trims surrounding whitespace when matching keys', () => {
    const current: DataRow[] = [row({ os: 'Android' }, { rev: 100 })];
    const comparison: DataRow[] = [row({ os: ' android ' }, { rev: 60 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['os'],
      measures: ['rev'],
    });

    expect(merged['rev__delta']).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// NaN / Infinity / null guards
// ---------------------------------------------------------------------------

describe('mergeByDimKey – NaN / Infinity / null guards', () => {
  it('treats NaN measure as null in delta', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: NaN as any })];
    const comparison: DataRow[] = [row({ d: 'a' }, { m: 50 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged['m__delta']).toBeNull();
    expect(merged['m__deltaPct']).toBeNull();
  });

  it('zero denominator → Δ% is null (not Infinity)', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: 10 })];
    const comparison: DataRow[] = [row({ d: 'a' }, { m: 0 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged['m__delta']).toBe(10);
    expect(merged['m__deltaPct']).toBeNull();
  });

  it('null current value → delta is null', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: null as any })];
    const comparison: DataRow[] = [row({ d: 'a' }, { m: 50 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged['m__delta']).toBeNull();
  });

  it('Infinity current value → treated as null', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: Infinity as any })];
    const comparison: DataRow[] = [row({ d: 'a' }, { m: 50 })];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged['m__delta']).toBeNull();
  });

  it('string measure values are parsed numerically', () => {
    const current: DataRow[] = [{ d: 'a', m: '150' }];
    const comparison: DataRow[] = [{ d: 'a', m: '100' }];

    const [merged] = mergeByDimKey(current, comparison, {
      dimKeys: ['d'],
      measures: ['m'],
    });

    expect(merged['m__delta']).toBe(50);
    expect(merged['m__deltaPct']).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Empty inputs
// ---------------------------------------------------------------------------

describe('mergeByDimKey – empty inputs', () => {
  it('returns empty array when current is empty', () => {
    const result = mergeByDimKey([], [row({ d: 'a' }, { m: 10 })], {
      dimKeys: ['d'],
      measures: ['m'],
    });
    expect(result).toHaveLength(0);
  });

  it('returns current rows with null deltas when comparison is empty', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: 10 })];
    const [merged] = mergeByDimKey(current, [], {
      dimKeys: ['d'],
      measures: ['m'],
    });
    expect(merged['m__delta']).toBeNull();
    expect(merged['m__cmp']).toBeNull();
  });

  it('no measures — returns current rows unmodified', () => {
    const current: DataRow[] = [row({ d: 'a' }, { m: 10 })];
    const [merged] = mergeByDimKey(current, [], { dimKeys: ['d'], measures: [] });
    expect(merged).toMatchObject({ d: 'a', m: 10 });
  });
});
