/**
 * Tests for the expansion query builder. The expansion query is what runs
 * at segment-push time when the user has selected aggregated cohort rows
 * and wants Cube to materialize the actual user_ids matching those cohorts.
 */

import { describe, it, expect } from 'vitest';
import {
  buildExpansionQuery,
  buildRowAndGroup,
  getCohortTimeDimensions,
  getNonIdentityDimensions,
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

  it('omits limit when no uidLimit override is given', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id');
    expect(q.limit).toBeUndefined();
  });

  it('honors a custom limit override', () => {
    const q = buildExpansionQuery(original, [], 'mf_users.user_id', 100);
    expect(q.limit).toBe(100);
  });

  it('constrains cohort rows by per-row time-bucket inDateRange (no plain dims)', () => {
    const cohortQuery = {
      measures: ['mf_users.arpu_vnd', 'mf_users.user_count'],
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: 'this month', granularity: 'week' },
        { dimension: 'mf_users.first_login_date', granularity: 'week' },
      ] as any,
    };
    const rows = [
      {
        'active_daily.log_date.week': '2026-05-04',
        'mf_users.first_login_date.week': '2026-03-02',
      },
      {
        'active_daily.log_date.week': '2026-05-04',
        'mf_users.first_login_date.week': '2026-04-13',
      },
    ];
    const q = buildExpansionQuery(cohortQuery, rows, 'mf_users.user_id');
    const orClause = (q.filters as any[]).find((f: any) => f.or);
    expect(orClause.or).toHaveLength(2);
    expect(orClause.or[0].and).toEqual([
      {
        member: 'active_daily.log_date',
        operator: 'inDateRange',
        values: ['2026-05-04', '2026-05-10'],
      },
      {
        member: 'mf_users.first_login_date',
        operator: 'inDateRange',
        values: ['2026-03-02', '2026-03-08'],
      },
    ]);
    expect(orClause.or[1].and[1].values).toEqual(['2026-04-13', '2026-04-19']);
  });

  it('emits inDateRange values as a flat [start, end] tuple (Cube schema)', () => {
    const cohortQuery = {
      timeDimensions: [
        { dimension: 'active_daily.log_date', granularity: 'week' },
      ] as any,
    };
    const rows = [{ 'active_daily.log_date.week': '2026-05-18' }];
    const q = buildExpansionQuery(cohortQuery, rows, 'mf_users.user_id');
    const orClause = (q.filters as any[]).find((f: any) => f.or);
    const td = orClause.or[0].and[0];
    expect(Array.isArray(td.values)).toBe(true);
    expect(td.values).toHaveLength(2);
    expect(td.values.every((v: unknown) => typeof v === 'string')).toBe(true);
  });

  it('combines plain-dim equals + time-bucket inDateRange in one AND clause', () => {
    const mixed = {
      dimensions: ['mf_users.country'],
      timeDimensions: [
        { dimension: 'mf_users.first_login_date', granularity: 'month' },
      ] as any,
    };
    const rows = [
      {
        'mf_users.country': 'VN',
        'mf_users.first_login_date.month': '2026-03-01',
      },
    ];
    const q = buildExpansionQuery(mixed, rows, 'mf_users.user_id');
    const orClause = (q.filters as any[]).find((f: any) => f.or);
    expect(orClause.or[0].and).toEqual([
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
      {
        member: 'mf_users.first_login_date',
        operator: 'inDateRange',
        values: ['2026-03-01', '2026-03-31'],
      },
    ]);
  });
});

describe('getCohortTimeDimensions', () => {
  it('returns row-key + member for each bucketed time dim, excluding the identity field', () => {
    const out = getCohortTimeDimensions(
      [
        { dimension: 'active_daily.log_date', granularity: 'week' },
        { dimension: 'mf_users.first_login_date', granularity: 'month' },
        { dimension: 'mf_users.user_id' as any, granularity: 'day' },
        { dimension: 'mf_users.signup_at' } as any, // no granularity → skip
      ],
      'mf_users.user_id',
    );
    expect(out).toEqual([
      { member: 'active_daily.log_date', rowKey: 'active_daily.log_date.week', granularity: 'week' },
      {
        member: 'mf_users.first_login_date',
        rowKey: 'mf_users.first_login_date.month',
        granularity: 'month',
      },
    ]);
  });
});
