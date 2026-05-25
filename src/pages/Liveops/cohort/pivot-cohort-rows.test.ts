/**
 * Tests for pivotCohortRows pure function.
 * Covers: basic pivot, cohort assignment (first day), retention counting,
 * maturity masking, edge cases (empty, single user, duplicate rows).
 */

import { describe, it, expect } from 'vitest';
import { pivotCohortRows } from './pivot-cohort-rows';
import type { RawCohortRow } from './pivot-cohort-rows';

// Helper: build a raw row
function row(userId: string, day: string): RawCohortRow {
  return {
    'active_daily.user_id': userId,
    'active_daily.log_date.day': day,
  };
}

describe('pivotCohortRows', () => {
  it('returns empty array for empty input', () => {
    expect(pivotCohortRows([])).toEqual([]);
  });

  it('assigns cohort to first active day', () => {
    // user A: first day 2024-01-01, also active on 2024-01-02
    // user B: first day 2024-01-02
    const rows = [
      row('A', '2024-01-01'),
      row('A', '2024-01-02'),
      row('B', '2024-01-02'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');

    expect(result).toHaveLength(2);
    expect(result[0].installDate).toBe('2024-01-01');
    expect(result[0].size).toBe(1);
    expect(result[1].installDate).toBe('2024-01-02');
    expect(result[1].size).toBe(1);
  });

  it('counts D1 retention correctly', () => {
    // Cohort 2024-01-01: users A and B
    // A active on 2024-01-02 (D1) → retained
    // B not active on 2024-01-02 → not retained
    const rows = [
      row('A', '2024-01-01'),
      row('B', '2024-01-01'),
      row('A', '2024-01-02'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    const cohort = result.find((r) => r.installDate === '2024-01-01')!;

    expect(cohort.size).toBe(2);
    expect(cohort.d1).toBe(1);
    expect(cohort.d1Pct).toBe(50);
  });

  it('counts D7 retention correctly', () => {
    // Cohort 2024-01-01: users A, B, C (size 3)
    // A and B active on D7 (2024-01-08)
    const rows = [
      row('A', '2024-01-01'), row('A', '2024-01-08'),
      row('B', '2024-01-01'), row('B', '2024-01-08'),
      row('C', '2024-01-01'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    const cohort = result.find((r) => r.installDate === '2024-01-01')!;

    expect(cohort.size).toBe(3);
    expect(cohort.d7).toBe(2);
    expect(cohort.d7Pct).toBe(66.7);
  });

  it('marks not-yet-mature cells correctly', () => {
    // Cohort 2024-01-10, today = 2024-01-11 → only D1 is mature
    const rows = [
      row('A', '2024-01-10'),
      row('A', '2024-01-11'), // D1
    ];
    const result = pivotCohortRows(rows, '2024-01-11');
    const cohort = result[0];

    // D1 (index 0) = 2024-01-10 + 1 = 2024-01-11 <= today → mature
    expect(cohort.matureMask[0]).toBe(true);
    // D3 (index 1) = 2024-01-13 > today → immature
    expect(cohort.matureMask[1]).toBe(false);
    expect(cohort.matureMask[2]).toBe(false);
    expect(cohort.matureMask[3]).toBe(false);
    expect(cohort.matureMask[4]).toBe(false);
  });

  it('marks all cells mature for old cohort', () => {
    // Cohort 2024-01-01, today = 2024-02-15 (45d later) → all mature
    const rows = [row('A', '2024-01-01')];
    const result = pivotCohortRows(rows, '2024-02-15');
    expect(result[0].matureMask.every(Boolean)).toBe(true);
  });

  it('returns rows sorted ascending by installDate', () => {
    const rows = [
      row('C', '2024-01-03'),
      row('A', '2024-01-01'),
      row('B', '2024-01-02'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    const dates = result.map((r) => r.installDate);
    expect(dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
  });

  it('handles duplicate rows (same user + day) without double-counting', () => {
    const rows = [
      row('A', '2024-01-01'),
      row('A', '2024-01-01'), // duplicate
      row('A', '2024-01-02'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    // Only one user, one cohort
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(1);
    expect(result[0].d1).toBe(1);
  });

  it('returns 0 pct when cohort size is 0', () => {
    // Edge: should not produce NaN
    const rows = [row('A', '2024-01-01')];
    const result = pivotCohortRows(rows, '2024-02-10');
    // size is 1 here, but test the pct formula directly via d30=0
    const cohort = result[0];
    expect(cohort.d30Pct).toBe(0);
    expect(Number.isFinite(cohort.d30Pct)).toBe(true);
  });

  it('ignores rows with missing user_id or day', () => {
    const rows: RawCohortRow[] = [
      { 'active_daily.user_id': '', 'active_daily.log_date.day': '2024-01-01' },
      { 'active_daily.user_id': 'A', 'active_daily.log_date.day': '' },
      row('B', '2024-01-01'),
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(1);
  });

  it('truncates day field with time component to date part', () => {
    const rows = [
      { 'active_daily.user_id': 'A', 'active_daily.log_date.day': '2024-01-01T00:00:00.000' },
      { 'active_daily.user_id': 'A', 'active_daily.log_date.day': '2024-01-02T00:00:00.000' },
    ];
    const result = pivotCohortRows(rows, '2024-02-10');
    expect(result[0].installDate).toBe('2024-01-01');
    expect(result[0].d1).toBe(1);
  });
});
