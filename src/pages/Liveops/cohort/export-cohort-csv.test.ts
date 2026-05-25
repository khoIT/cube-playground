/**
 * Tests for cohortRowsToCsv pure function.
 * Covers: header format, counts mode, percent mode, CSV escaping, empty input.
 * (downloadCohortCsv is browser-side; not unit-tested here.)
 */

import { describe, it, expect } from 'vitest';
import { cohortRowsToCsv } from './export-cohort-csv';
import type { CohortRow } from './pivot-cohort-rows';

function makeRow(overrides: Partial<CohortRow> = {}): CohortRow {
  return {
    installDate: '2024-01-01',
    size: 100,
    d1: 70, d3: 60, d7: 50, d14: 40, d30: 30,
    d1Pct: 70, d3Pct: 60, d7Pct: 50, d14Pct: 40, d30Pct: 30,
    matureMask: [true, true, true, true, true],
    ...overrides,
  };
}

describe('cohortRowsToCsv', () => {
  it('returns empty string for empty rows', () => {
    expect(cohortRowsToCsv([], 'counts')).toBe('');
    expect(cohortRowsToCsv([], 'percent')).toBe('');
  });

  it('counts mode: correct header', () => {
    const csv = cohortRowsToCsv([makeRow()], 'counts');
    const [header] = csv.split('\n');
    expect(header).toBe('installDate,cohortSize,d1,d3,d7,d14,d30');
  });

  it('percent mode: correct header', () => {
    const csv = cohortRowsToCsv([makeRow()], 'percent');
    const [header] = csv.split('\n');
    expect(header).toBe('installDate,cohortSize,d1Pct,d3Pct,d7Pct,d14Pct,d30Pct');
  });

  it('counts mode: data row contains raw counts', () => {
    const csv = cohortRowsToCsv([makeRow()], 'counts');
    const [, dataRow] = csv.split('\n');
    expect(dataRow).toBe('2024-01-01,100,70,60,50,40,30');
  });

  it('percent mode: data row contains percentages', () => {
    const csv = cohortRowsToCsv([makeRow()], 'percent');
    const [, dataRow] = csv.split('\n');
    expect(dataRow).toBe('2024-01-01,100,70,60,50,40,30');
  });

  it('multiple rows produce correct line count', () => {
    const rows = [makeRow({ installDate: '2024-01-01' }), makeRow({ installDate: '2024-01-02' })];
    const csv = cohortRowsToCsv(rows, 'counts');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // 1 header + 2 data
  });

  it('escapes values containing commas', () => {
    // Force a value with a comma via a custom toString — in practice dates never
    // have commas, but the escaping contract must hold.
    const row = makeRow({ installDate: '2024,01,01' });
    const csv = cohortRowsToCsv([row], 'counts');
    const [, dataRow] = csv.split('\n');
    expect(dataRow.startsWith('"2024,01,01"')).toBe(true);
  });

  it('escapes values containing double-quotes', () => {
    const row = makeRow({ installDate: '2024"01"01' });
    const csv = cohortRowsToCsv([row], 'counts');
    const [, dataRow] = csv.split('\n');
    expect(dataRow.startsWith('"2024""01""01"')).toBe(true);
  });

  it('percent mode uses pct fields, not count fields', () => {
    const row = makeRow({ d1: 70, d1Pct: 70.5 });
    const csv = cohortRowsToCsv([row], 'percent');
    const [, dataRow] = csv.split('\n');
    const fields = dataRow.split(',');
    // d1Pct is the 3rd data field (index 2, 0-based after installDate, size)
    expect(fields[2]).toBe('70.5');
  });

  it('counts mode uses count fields, not pct fields', () => {
    const row = makeRow({ d1: 70, d1Pct: 70.5 });
    const csv = cohortRowsToCsv([row], 'counts');
    const [, dataRow] = csv.split('\n');
    const fields = dataRow.split(',');
    expect(fields[2]).toBe('70');
  });
});
