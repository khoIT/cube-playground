/**
 * Prior-cube anchored metric resolution — the session 3542a7c1 vocabulary
 * gap: "user count" must reach `distinct_players` on the anchor cube even
 * though the two share zero raw tokens (user→player, count→distinct via the
 * anchor-scoped token-equivalence classes).
 */

import { describe, it, expect } from 'vitest';
import { resolveAgainstAnchorCube } from '../../src/nl-to-query/cube-anchored-metric-fallback.js';
import { searchMembers } from '../../src/nl-to-query/member-resolution.js';

const META = {
  cubes: [
    {
      name: 'etl_game_detail',
      measures: [
        { name: 'etl_game_detail.matches', type: 'count' },
        { name: 'etl_game_detail.distinct_players', type: 'count_distinct_approx' },
        { name: 'etl_game_detail.distinct_rooms', type: 'count_distinct_approx' },
        { name: 'etl_game_detail.total_kills', type: 'sum' },
      ],
      dimensions: [
        { name: 'etl_game_detail.dteventtime', type: 'time' },
        { name: 'etl_game_detail.game_mode_label', type: 'string' },
      ],
    },
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.dau', type: 'count_distinct' }],
      dimensions: [{ name: 'mf_users.log_date', type: 'time' }],
    },
  ],
};

describe('resolveAgainstAnchorCube', () => {
  it('bridges "user count" → distinct_players via token equivalence (the 3542a7c1 case)', () => {
    const { candidates } = resolveAgainstAnchorCube('user count', 'etl_game_detail', META);
    expect(candidates[0]?.member).toBe('etl_game_detail.distinct_players');
    // 0.88 full-coverage name match — clears the 0.8 autoroute threshold.
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('strips "per day" granularity noise so the match stays auto-confident', () => {
    const { candidates } = resolveAgainstAnchorCube('user count per day', 'etl_game_detail', META);
    expect(candidates[0]?.member).toBe('etl_game_detail.distinct_players');
    // Same score as the bare phrase — time-grain tokens must not dilute it.
    expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('never escapes the anchor cube (mf_users.dau is invisible)', () => {
    const { candidates } = resolveAgainstAnchorCube('dau', 'etl_game_detail', META);
    expect(candidates.every((c) => c.cube === 'etl_game_detail')).toBe(true);
  });

  it('only returns measures, never dimensions', () => {
    const { candidates } = resolveAgainstAnchorCube('game mode', 'etl_game_detail', META);
    expect(candidates.find((c) => c.member === 'etl_game_detail.game_mode_label')).toBeUndefined();
  });

  it('returns empty for blank phrase or unknown cube', () => {
    expect(resolveAgainstAnchorCube('', 'etl_game_detail', META).candidates).toEqual([]);
    expect(resolveAgainstAnchorCube('user count', 'nope', META).candidates).toEqual([]);
  });

  it('kills phrase still finds total_kills (plain token path unaffected by equiv)', () => {
    const { candidates } = resolveAgainstAnchorCube('total kills', 'etl_game_detail', META);
    expect(candidates[0]?.member).toBe('etl_game_detail.total_kills');
  });
});

describe('searchMembers token-equivalence stays opt-in', () => {
  it('global search (no opts) does NOT map user→player', () => {
    const global = searchMembers(META, 'user count', 3);
    // Without equivalence the only hits are weak title/partial matches that
    // never include distinct_players at full-coverage strength.
    const dp = global.find((m) => m.member === 'etl_game_detail.distinct_players');
    expect(dp).toBeUndefined();
  });
});
