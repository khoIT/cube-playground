/**
 * Tests for echo-filter-stripper — deterministic removal of deeplink-injected
 * filters before a modified query is converted back to a predicate tree.
 */

import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import { stripEchoFilters } from '../echo-filter-stripper';
import type { SegmentEditContext } from '../../../utils/playground-deeplink';

const gameEcho: SegmentEditContext['echoFilters'][number] = {
  member: 'active_daily.gameId',
  operator: 'equals',
  values: ['jus_vn'],
};

describe('stripEchoFilters', () => {
  it('removes an exact-match echo filter', () => {
    const query: Query = {
      filters: [
        { member: 'active_daily.gameId', operator: 'equals', values: ['jus_vn'] },
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      ],
    };
    const result = stripEchoFilters(query, [gameEcho]);
    expect(result.filters).toHaveLength(1);
    expect((result.filters![0] as any).member).toBe('mf_users.country');
  });

  it('preserves a deliberate user-added filter on the same member with a different value', () => {
    const query: Query = {
      filters: [
        // Echo is jus_vn; user explicitly selected cfm_vn — different value → survives.
        { member: 'active_daily.gameId', operator: 'equals', values: ['cfm_vn'] },
      ],
    };
    const result = stripEchoFilters(query, [gameEcho]);
    expect(result.filters).toHaveLength(1);
    expect((result.filters![0] as any).values).toEqual(['cfm_vn']);
  });

  it('preserves a deliberate user-added filter on the same member with additional values', () => {
    const query: Query = {
      filters: [
        { member: 'active_daily.gameId', operator: 'equals', values: ['jus_vn', 'cfm_vn'] },
      ],
    };
    const result = stripEchoFilters(query, [gameEcho]);
    // Value arrays differ in length — not a match, filter survives.
    expect(result.filters).toHaveLength(1);
  });

  it('does not mutate the original query', () => {
    const original: Query = {
      filters: [
        { member: 'active_daily.gameId', operator: 'equals', values: ['jus_vn'] },
      ],
    };
    const copy = JSON.parse(JSON.stringify(original));
    stripEchoFilters(original, [gameEcho]);
    expect(original).toEqual(copy);
  });

  it('returns original query reference when there are no echo filters', () => {
    const query: Query = {
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
    };
    expect(stripEchoFilters(query, [])).toBe(query);
  });

  it('returns original query reference when query has no filters', () => {
    const query: Query = { measures: ['mf_users.count'] };
    expect(stripEchoFilters(query, [gameEcho])).toBe(query);
  });

  it('keeps logical (and/or) wrapper nodes untouched', () => {
    const query: Query = {
      filters: [
        {
          or: [
            { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
            { member: 'mf_users.country', operator: 'equals', values: ['ID'] },
          ],
        } as any,
      ],
    };
    const result = stripEchoFilters(query, [gameEcho]);
    // The logical group is NOT an echo filter — it is preserved.
    expect(result.filters).toHaveLength(1);
    expect((result.filters![0] as any).or).toBeDefined();
  });

  it('strips multiple echo filters in one pass', () => {
    const echoFilters: SegmentEditContext['echoFilters'] = [
      { member: 'active_daily.gameId', operator: 'equals', values: ['jus_vn'] },
      { member: 'mf_users.gameId', operator: 'equals', values: ['jus_vn'] },
    ];
    const query: Query = {
      filters: [
        { member: 'active_daily.gameId', operator: 'equals', values: ['jus_vn'] },
        { member: 'mf_users.gameId', operator: 'equals', values: ['jus_vn'] },
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      ],
    };
    const result = stripEchoFilters(query, echoFilters);
    expect(result.filters).toHaveLength(1);
    expect((result.filters![0] as any).member).toBe('mf_users.country');
  });

  it('matches operator in addition to member and values', () => {
    // Echo is 'equals'; user has 'notEquals' on the same member — different op → survives.
    const query: Query = {
      filters: [
        { member: 'active_daily.gameId', operator: 'notEquals', values: ['jus_vn'] },
      ],
    };
    const result = stripEchoFilters(query, [gameEcho]);
    expect(result.filters).toHaveLength(1);
  });
});
