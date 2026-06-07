import { describe, it, expect } from 'vitest';
import {
  scopeQueryToSegment,
  scopeQueryToCohort,
  predicateFiltersForSegment,
} from '../use-segment-cube-query';
import type { Segment } from '../../../../types/segment-api';

function makeSegment(overrides: Partial<Segment>): Segment {
  return {
    id: 's1',
    name: 'seg',
    type: 'predicate',
    owner: 'me',
    status: 'fresh',
    cube: 'mf_users',
    predicate_tree: null,
    cube_query_json: null,
    sql_preview: null,
    uid_count: 0,
    uid_list: [],
    tags: [],
    refresh_cadence_min: null,
    last_refreshed_at: null,
    broken_reason: null,
    created_at: '',
    updated_at: '',
    game_id: 'g1',
    activations: [],
    funnel_json: null,
    ...overrides,
  } as Segment;
}

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

describe('predicateFiltersForSegment', () => {
  it('parses filters out of cube_query_json', () => {
    const seg = makeSegment({
      cube_query_json: JSON.stringify({
        filters: [{ member: 'recharge.os_platform', operator: 'equals', values: ['iOS'] }],
      }),
    });
    expect(predicateFiltersForSegment(seg)).toEqual([
      { member: 'recharge.os_platform', operator: 'equals', values: ['iOS'] },
    ]);
  });

  it('returns [] for manual segments (no cube_query_json) or malformed json', () => {
    expect(predicateFiltersForSegment(makeSegment({ cube_query_json: null }))).toEqual([]);
    expect(predicateFiltersForSegment(makeSegment({ cube_query_json: 'not json' }))).toEqual([]);
  });
});

describe('scopeQueryToCohort', () => {
  it('predicate segment: ANDs predicate filters, never inlines uids', () => {
    const seg = makeSegment({
      type: 'predicate',
      uid_list: ['u1', 'u2', 'u3'],
      cube_query_json: JSON.stringify({
        filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
      }),
    });
    const out = scopeQueryToCohort({ measures: ['mf_users.user_count'] }, seg, 'mf_users.user_id');
    expect(out.filters).toEqual([
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
    ]);
  });

  it('drops a trend card rolling window when the predicate pins the same time dimension', () => {
    // April cohort + "last 30 days" trend = empty chart by construction; the
    // predicate's own date range must bound the trend instead.
    const seg = makeSegment({
      type: 'predicate',
      cube_query_json: JSON.stringify({
        filters: [
          { member: 'etl_game_detail.dteventtime', operator: 'inDateRange', values: ['2026-04-01', '2026-04-30'] },
          { member: 'etl_game_detail.game_mode_label', operator: 'equals', values: ['dat_bom'] },
        ],
      }),
    });
    const out = scopeQueryToCohort(
      {
        measures: ['etl_game_detail.matches'],
        timeDimensions: [
          { dimension: 'etl_game_detail.dteventtime', granularity: 'day', dateRange: 'last 30 days' },
        ],
      },
      seg,
      'mf_users.user_id',
    );
    expect(out.timeDimensions).toEqual([
      { dimension: 'etl_game_detail.dteventtime', granularity: 'day', dateRange: undefined },
    ]);
    expect(out.filters).toHaveLength(2);
  });

  it('keeps the rolling window when the predicate pins a DIFFERENT time dimension', () => {
    const seg = makeSegment({
      type: 'predicate',
      cube_query_json: JSON.stringify({
        filters: [
          { member: 'etl_game_detail.dteventtime', operator: 'inDateRange', values: ['2026-04-01', '2026-04-30'] },
        ],
      }),
    });
    const out = scopeQueryToCohort(
      {
        measures: ['mf_users.user_count'],
        timeDimensions: [
          { dimension: 'mf_users.install_date', granularity: 'day', dateRange: 'last 30 days' },
        ],
      },
      seg,
      'mf_users.user_id',
    );
    expect(out.timeDimensions).toEqual([
      { dimension: 'mf_users.install_date', granularity: 'day', dateRange: 'last 30 days' },
    ]);
  });

  it('all-users predicate (empty filters) leaves query unscoped', () => {
    const seg = makeSegment({
      type: 'predicate',
      uid_list: ['u1', 'u2'],
      cube_query_json: JSON.stringify({ filters: [] }),
    });
    const out = scopeQueryToCohort({ measures: ['mf_users.user_count'] }, seg, 'mf_users.user_id');
    expect(out.filters).toBeUndefined();
  });

  it('carries boolean-group predicate filters through opaquely', () => {
    const orGroup = {
      or: [
        { member: 'mf_users.media_source', operator: 'equals', values: ['organic'] },
        { member: 'mf_users.media_source', operator: 'equals', values: ['referral'] },
      ],
    };
    const seg = makeSegment({
      type: 'predicate',
      cube_query_json: JSON.stringify({ filters: [orGroup] }),
    });
    const out = scopeQueryToCohort({ measures: ['mf_users.user_count'] }, seg, 'mf_users.user_id');
    expect(out.filters).toEqual([orGroup]);
  });

  it('uidsOverride wins: identity-IN over the explicit page set', () => {
    const seg = makeSegment({
      type: 'predicate',
      cube_query_json: JSON.stringify({ filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }] }),
    });
    const out = scopeQueryToCohort({ measures: ['mf_users.user_count'] }, seg, 'mf_users.user_id', ['p1', 'p2']);
    expect(out.filters).toEqual([
      { member: 'mf_users.user_id', operator: 'equals', values: ['p1', 'p2'] },
    ]);
  });

  it('manual segment (no predicate): identity-IN over uid_list', () => {
    const seg = makeSegment({
      type: 'manual',
      cube_query_json: null,
      uid_list: ['m1', 'm2'],
    });
    const out = scopeQueryToCohort({ measures: ['mf_users.user_count'] }, seg, 'mf_users.user_id');
    expect(out.filters).toEqual([
      { member: 'mf_users.user_id', operator: 'equals', values: ['m1', 'm2'] },
    ]);
  });

  it('manual segment WITH stored slice: identity-IN AND slice filters', () => {
    // Static push from the query builder stores its originating slice; cards
    // must report the cohort's defining window (matching a Live twin), not
    // the frozen users' lifetime activity.
    const seg = makeSegment({
      type: 'manual',
      uid_list: ['m1', 'm2'],
      cube_query_json: JSON.stringify({
        filters: [{ member: 'recharge.log_date', operator: 'inDateRange', values: ['2026-06-05', '2026-06-05'] }],
      }),
    });
    const out = scopeQueryToCohort({ measures: ['recharge.revenue'] }, seg, 'recharge.user_id');
    expect(out.filters).toEqual([
      { member: 'recharge.user_id', operator: 'equals', values: ['m1', 'm2'] },
      { member: 'recharge.log_date', operator: 'inDateRange', values: ['2026-06-05', '2026-06-05'] },
    ]);
  });

  it('manual segment WITH slice: drops a trend card rolling window pinned by the slice', () => {
    const seg = makeSegment({
      type: 'manual',
      uid_list: ['m1'],
      cube_query_json: JSON.stringify({
        filters: [{ member: 'recharge.log_date', operator: 'inDateRange', values: ['2026-06-05', '2026-06-05'] }],
      }),
    });
    const out = scopeQueryToCohort(
      {
        measures: ['recharge.revenue'],
        timeDimensions: [
          { dimension: 'recharge.log_date', granularity: 'day', dateRange: 'last 30 days' },
        ],
      },
      seg,
      'recharge.user_id',
    );
    expect(out.timeDimensions).toEqual([
      { dimension: 'recharge.log_date', granularity: 'day', dateRange: undefined },
    ]);
  });
});
