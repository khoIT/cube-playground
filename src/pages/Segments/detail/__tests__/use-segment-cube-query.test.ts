import { describe, it, expect } from 'vitest';
import { scopeQueryToSegment } from '../use-segment-cube-query';

describe('scopeQueryToSegment', () => {
  it('appends an identity filter when uids are present', () => {
    const out = scopeQueryToSegment(
      { measures: ['mf_users.dau'] },
      'mf_users.user_id',
      ['u1', 'u2'],
    );
    expect(out.filters).toEqual([
      { member: 'mf_users.user_id', operator: 'equals', values: ['u1', 'u2'] },
    ]);
  });

  it('preserves existing filters', () => {
    const out = scopeQueryToSegment(
      {
        measures: ['mf_users.dau'],
        filters: [{ member: 'mf_users.country', operator: 'equals' as never, values: ['VN'] }],
      },
      'mf_users.user_id',
      ['u1'],
    );
    expect(out.filters).toHaveLength(2);
  });

  it('skips identity filter when uid list is empty', () => {
    const out = scopeQueryToSegment(
      { measures: ['mf_users.dau'] },
      'mf_users.user_id',
      [],
    );
    expect(out.filters).toBeUndefined();
  });
});
