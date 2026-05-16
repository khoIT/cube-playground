import { describe, it, expect } from 'vitest';
import { diffEquality } from '../diff-equality';
import type { CdpMetricPayload } from '../types';

const base: CdpMetricPayload = {
  game_id: 'bal_vn',
  metric_name: 'user_count',
  metric_codename: 'user_count',
  source: 'iceberg.ballistar_vn.mf_users',
  expression: 'COUNT(*)',
  dimensions: ['country', 'signup_source'],
  filter: '',
};

describe('diffEquality()', () => {
  it('identical payload + response → empty diff', () => {
    expect(diffEquality(base, { ...base })).toEqual([]);
  });

  it('different expression → 1-element diff', () => {
    const diff = diffEquality(base, { ...base, expression: 'SUM(x)' });
    expect(diff).toEqual([{ field: 'expression', expected: 'COUNT(*)', actual: 'SUM(x)' }]);
  });

  it('expression whitespace differences → no diff', () => {
    const diff = diffEquality(base, { ...base, expression: '  COUNT(*)  ' });
    expect(diff).toEqual([]);
  });

  it('filter null vs "" → no diff', () => {
    const diff = diffEquality({ ...base, filter: '' }, { ...base, filter: null as unknown as string });
    expect(diff).toEqual([]);
  });

  it('dimensions order-independent → no diff', () => {
    const diff = diffEquality(
      { ...base, dimensions: ['country', 'signup_source'] },
      { ...base, dimensions: ['signup_source', 'country'] },
    );
    expect(diff).toEqual([]);
  });

  it('dimensions differ in content → diff', () => {
    const diff = diffEquality(
      { ...base, dimensions: ['country'] },
      { ...base, dimensions: ['country', 'extra'] },
    );
    expect(diff.length).toBe(1);
    expect(diff[0].field).toBe('dimensions');
  });

  it('ignored fields (materialize, schedule, created_at, updated_at) → no diff', () => {
    const diff = diffEquality(base, {
      ...base,
      materialize: true,
      schedule: 'daily',
      created_at: '2020-01-01',
      updated_at: '2020-01-02',
    } as unknown as CdpMetricPayload);
    expect(diff).toEqual([]);
  });

  it('multiple differences yield multiple entries', () => {
    const diff = diffEquality(base, { ...base, expression: 'X', filter: '(y=1)' });
    expect(diff.map((d) => d.field).sort()).toEqual(['expression', 'filter']);
  });

  it('source / metric_codename differences detected', () => {
    const diff = diffEquality(
      { ...base, source: 's1', metric_codename: 'a' },
      { ...base, source: 's2', metric_codename: 'b' },
    );
    expect(diff.map((d) => d.field).sort()).toEqual(['metric_codename', 'source']);
  });
});
