import { describe, it, expect } from 'vitest';
import { scopeQueryToSegment, segmentSliceFilters } from '../use-segment-cube-query';
import type { Segment } from '../../../../types/segment-api';

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

  it('prepends slice filters so measures reflect the slice, then the identity filter', () => {
    const out = scopeQueryToSegment(
      { measures: ['recharge.revenue_vnd'] },
      'recharge.user_id',
      ['u1'],
      [{ member: 'recharge.os_platform', operator: 'equals' as never, values: ['iOS'] }],
    );
    expect(out.filters).toEqual([
      { member: 'recharge.os_platform', operator: 'equals', values: ['iOS'] },
      { member: 'recharge.user_id', operator: 'equals', values: ['u1'] },
    ]);
  });

  it('applies slice filters even when the uid list is empty', () => {
    const out = scopeQueryToSegment(
      { measures: ['recharge.revenue_vnd'] },
      'recharge.user_id',
      [],
      [{ member: 'recharge.os_platform', operator: 'equals' as never, values: ['iOS'] }],
    );
    expect(out.filters).toHaveLength(1);
  });
});

describe('segmentSliceFilters', () => {
  it('parses filters out of cube_query_json', () => {
    const seg = {
      cube_query_json: JSON.stringify({
        filters: [{ member: 'recharge.os_platform', operator: 'equals', values: ['iOS'] }],
      }),
    } as Segment;
    expect(segmentSliceFilters(seg)).toEqual([
      { member: 'recharge.os_platform', operator: 'equals', values: ['iOS'] },
    ]);
  });

  it('returns [] for manual segments (no cube_query_json) or malformed json', () => {
    expect(segmentSliceFilters({ cube_query_json: null } as Segment)).toEqual([]);
    expect(segmentSliceFilters({ cube_query_json: 'not json' } as Segment)).toEqual([]);
    expect(segmentSliceFilters(null)).toEqual([]);
  });
});
