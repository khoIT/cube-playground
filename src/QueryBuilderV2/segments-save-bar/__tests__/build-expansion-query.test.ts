/**
 * Tests for the expansion query builder. The expansion query is what runs
 * at segment-push time when the user has selected aggregated cohort rows
 * and wants Cube to materialize the actual user_ids matching those cohorts.
 */

import { describe, it, expect } from 'vitest';
import {
  buildExpansionQuery,
  buildRowAndGroup,
  getNonIdentityDimensions,
  UID_HARD_CAP,
} from '../build-expansion-query';

describe('getNonIdentityDimensions', () => {
  it('returns empty when input is undefined', () => {
    expect(getNonIdentityDimensions(undefined, 'mf_users.user_id')).toEqual([]);
  });
  it('filters out the identity dim', () => {
    expect(
      getNonIdentityDimensions(
        ['mf_users.user_id', 'mf_users.first_login_month'],
        'mf_users.user_id',
      ),
    ).toEqual(['mf_users.first_login_month']);
  });
});

describe('buildRowAndGroup', () => {
  it('builds an AND clause covering every constrained dim', () => {
    const out = buildRowAndGroup(
      { 'mf_users.first_login_month': '2025-05-01', 'mf_users.country': 'VN' },
      ['mf_users.first_login_month', 'mf_users.country'],
    );
    expect(out).toEqual({
      and: [
        { member: 'mf_users.first_login_month', operator: 'equals', values: ['2025-05-01'] },
        { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      ],
    });
  });
  it('returns null when the row has no values for any constrained dim', () => {
    expect(buildRowAndGroup({}, ['mf_users.country'])).toBeNull();
  });
});

describe('buildExpansionQuery', () => {
  const original = {
    dimensions: ['mf_users.first_login_month'],
    measures: ['mf_users.arpu_vnd'],
    timeDimensions: [
      { dimension: 'active_daily.log_date', dateRange: 'this week', granularity: 'week' },
    ] as any,
    filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
  };

  it('replaces dims with [identityField] and drops measures', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id');
    expect(q.dimensions).toEqual(['mf_users.user_id']);
    expect(q.measures).toEqual([]);
  });

  it('drops time granularity but preserves dateRange so it acts as a filter', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id');
    expect(q.timeDimensions).toEqual([
      { dimension: 'active_daily.log_date', dateRange: 'this week' },
    ]);
  });

  it('preserves original filters', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id');
    expect(q.filters).toEqual([
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
    ]);
  });

  it('adds OR-of-AND-groups across selected rows on non-identity dimensions only', () => {
    const rows = [
      { 'mf_users.first_login_month': '2025-05-01' },
      { 'mf_users.first_login_month': '2025-06-01' },
    ];
    const q = buildExpansionQuery(original, rows, 'mf_users.user_id');
    expect(q.filters).toEqual([
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      {
        or: [
          {
            and: [
              {
                member: 'mf_users.first_login_month',
                operator: 'equals',
                values: ['2025-05-01'],
              },
            ],
          },
          {
            and: [
              {
                member: 'mf_users.first_login_month',
                operator: 'equals',
                values: ['2025-06-01'],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('handles multi-dim rows (precise OR-of-AND)', () => {
    const multiDim = {
      ...original,
      dimensions: ['mf_users.first_login_month', 'mf_users.country'],
    };
    const rows = [
      { 'mf_users.first_login_month': '2025-05', 'mf_users.country': 'VN' },
      { 'mf_users.first_login_month': '2025-06', 'mf_users.country': 'ID' },
    ];
    const q = buildExpansionQuery(multiDim, rows, 'mf_users.user_id');
    const orClause = (q.filters as any[]).find((f: any) => f.or);
    expect(orClause.or).toHaveLength(2);
    expect(orClause.or[0].and).toHaveLength(2);
    expect(orClause.or[1].and).toHaveLength(2);
  });

  it('caps result via limit (default UID_HARD_CAP)', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id');
    expect(q.limit).toBe(UID_HARD_CAP);
  });

  it('honors a custom limit override', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id', 100);
    expect(q.limit).toBe(100);
  });
});
