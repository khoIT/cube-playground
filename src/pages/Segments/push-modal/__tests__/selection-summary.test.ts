import { describe, it, expect } from 'vitest';
import { summarizeSelection } from '../selection-summary';

describe('summarizeSelection', () => {
  it('returns zero summary for empty rows', () => {
    expect(summarizeSelection([])).toEqual({ total: 0, categoricals: [], numeric: null });
  });

  it('counts top values per categorical column', () => {
    const rows = [
      { country: 'VN', tier: 'whale', spend: 100 },
      { country: 'VN', tier: 'whale', spend: 200 },
      { country: 'TH', tier: 'whale', spend: 50 },
      { country: 'TH', tier: 'dolphin', spend: 25 },
      { country: 'JP', tier: 'minnow', spend: 5 },
    ];
    const out = summarizeSelection(rows, { maxCategoricals: 2, maxTopValues: 2 });
    expect(out.total).toBe(5);
    expect(out.categoricals).toHaveLength(2);
    const country = out.categoricals.find((c) => c.column === 'country')!;
    expect(country.topValues).toEqual([
      { value: 'VN', count: 2 },
      { value: 'TH', count: 2 },
    ]);
  });

  it('computes avg/min/max for first numeric column', () => {
    const rows = [
      { country: 'VN', spend: 100 },
      { country: 'VN', spend: 200 },
      { country: 'TH', spend: 50 },
    ];
    const out = summarizeSelection(rows);
    expect(out.numeric?.column).toBe('spend');
    expect(out.numeric?.avg).toBeCloseTo(350 / 3);
    expect(out.numeric?.min).toBe(50);
    expect(out.numeric?.max).toBe(200);
  });

  it('skips columns with all-null values', () => {
    const rows = [
      { country: 'VN', spend: 100 },
      { country: null, spend: 200 },
    ];
    const out = summarizeSelection(rows);
    const country = out.categoricals.find((c) => c.column === 'country')!;
    expect(country.topValues).toEqual([{ value: 'VN', count: 1 }]);
  });
});
