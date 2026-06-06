/**
 * Join-probe identity inheritance: anchor ranking, probe query shape, and the
 * suggester's pass-2 integration (etl_* cubes inheriting mf_users.user_id
 * when the Cube /sql dry compile proves a join path exists).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlHolder: { fail: boolean; calls: unknown[] } = { fail: false, calls: [] };

vi.mock('../src/services/cube-client.js', () => ({
  getMeta: vi.fn(async () => metaHolder.meta),
  getMetaWithCtx: vi.fn(async () => metaHolder.meta),
  sql: vi.fn(async (q: unknown) => {
    sqlHolder.calls.push(q);
    if (sqlHolder.fail) throw new Error("Can't find join path to join 'mf_users', 'etl_x'");
    return { sql: { sql: ['SELECT 1'] } };
  }),
  sqlWithCtx: vi.fn(async (q: unknown) => {
    sqlHolder.calls.push(q);
    if (sqlHolder.fail) throw new Error("Can't find join path to join 'mf_users', 'etl_x'");
    return { sql: { sql: ['SELECT 1'] } };
  }),
}));

const metaHolder: { meta: unknown } = { meta: null };

import {
  rankAnchors,
  buildProbeQuery,
  clearJoinProbeCache,
} from '../src/services/identity-join-probe.js';
import { suggestIdentities } from '../src/services/identity-suggester.js';

beforeEach(() => {
  clearJoinProbeCache();
  sqlHolder.fail = false;
  sqlHolder.calls = [];
});

describe('rankAnchors', () => {
  const anchors = [
    { cube: 'ballistar_mf_users', identityField: 'ballistar_mf_users.user_id', confidence: 0.95 },
    { cube: 'cfm_mf_users', identityField: 'cfm_mf_users.user_id', confidence: 0.95 },
    { cube: 'cfm_user_recharge_daily', identityField: 'cfm_user_recharge_daily.user_id', confidence: 0.95 },
  ];

  it('prefers the anchor sharing the game prefix, mf_users first', () => {
    const ranked = rankAnchors('cfm_etl_game_detail', anchors);
    expect(ranked[0].cube).toBe('cfm_mf_users');
    expect(ranked[1].cube).toBe('cfm_user_recharge_daily');
  });

  it('boosts mf_users when no prefix distinguishes (local bare names)', () => {
    const local = [
      { cube: 'user_recharge_daily', identityField: 'user_recharge_daily.user_id', confidence: 0.95 },
      { cube: 'mf_users', identityField: 'mf_users.user_id', confidence: 0.95 },
    ];
    expect(rankAnchors('etl_game_detail', local)[0].cube).toBe('mf_users');
  });
});

describe('buildProbeQuery', () => {
  it('bounds the cube time dimension to satisfy compile-time guards', () => {
    const q = buildProbeQuery(
      { name: 'etl_x', dimensions: [{ name: 'etl_x.dteventtime', type: 'time' }, { name: 'etl_x.mode' }] },
      'mf_users.user_id',
    ) as { dimensions: string[]; timeDimensions: Array<{ dimension: string; dateRange: string }> };
    expect(q.dimensions).toEqual(['mf_users.user_id']);
    expect(q.timeDimensions[0].dimension).toBe('etl_x.dteventtime');
    expect(q.timeDimensions[0].dateRange).toBe('last 7 days');
  });

  it('falls back to a plain dimension pair when the cube has no time dim', () => {
    const q = buildProbeQuery(
      { name: 'user_roles', dimensions: [{ name: 'user_roles.role_id' }] },
      'mf_users.user_id',
    ) as { dimensions: string[] };
    expect(q.dimensions).toEqual(['mf_users.user_id', 'user_roles.role_id']);
  });

  it('returns null for a dimension-less cube', () => {
    expect(buildProbeQuery({ name: 'x', dimensions: [] }, 'mf_users.user_id')).toBeNull();
  });
});

describe('suggestIdentities join-probe pass', () => {
  const meta = {
    cubes: [
      {
        name: 'mf_users',
        dimensions: [{ name: 'mf_users.user_id' }],
      },
      {
        name: 'etl_x',
        dimensions: [{ name: 'etl_x.dteventtime', type: 'time' }, { name: 'etl_x.playerid' }],
      },
    ],
  };

  it('identity-less cube inherits the anchor identity when the join compiles', async () => {
    metaHolder.meta = meta;
    const out = await suggestIdentities();
    const etl = out.find((s) => s.cube === 'etl_x')!;
    expect(etl.identity_field).toBe('mf_users.user_id');
    expect(etl.confidence).toBe(0.7);
    expect(etl.matched_pattern).toBe('join→mf_users');
  });

  it('stays unmapped when the compile reports no join path', async () => {
    metaHolder.meta = meta;
    sqlHolder.fail = true;
    const out = await suggestIdentities();
    const etl = out.find((s) => s.cube === 'etl_x')!;
    expect(etl.identity_field).toBeNull();
    expect(etl.confidence).toBe(0);
  });

  it('caches the probe result — second call issues no new /sql', async () => {
    metaHolder.meta = meta;
    await suggestIdentities();
    const callsAfterFirst = sqlHolder.calls.length;
    await suggestIdentities();
    expect(sqlHolder.calls.length).toBe(callsAfterFirst);
  });
});
