import { describe, it, expect } from 'vitest';
import { primaryCubeOf, formatAsOf, distinctAsOf } from '../data-freshness-format';

describe('primaryCubeOf', () => {
  it('takes the cube of the first data requirement', () => {
    expect(primaryCubeOf(['user_gameplay_daily.clan_switched_recent', 'mf_users.ltv_total_vnd'])).toBe(
      'user_gameplay_daily',
    );
  });
  it('returns null for no requirements', () => {
    expect(primaryCubeOf([])).toBeNull();
  });
});

describe('formatAsOf', () => {
  it('formats YYYY-MM-DD to D MMM YYYY', () => {
    expect(formatAsOf('2026-05-01')).toBe('1 May 2026');
    expect(formatAsOf('2026-06-09')).toBe('9 Jun 2026');
  });
  it('passes through an unparseable value', () => {
    expect(formatAsOf('not-a-date')).toBe('not-a-date');
  });
});

describe('distinctAsOf', () => {
  const asOfByCube = {
    user_gameplay_daily: '2026-05-01',
    mf_users: '2026-06-09',
    user_recharge_rolling: '2026-06-09',
  };

  it('collects distinct ascending dates over queryable playbooks', () => {
    const playbooks = [
      { availability: 'available', dataRequirements: ['user_gameplay_daily.x'] },
      { availability: 'available', dataRequirements: ['mf_users.y'] },
      { availability: 'partial', dataRequirements: ['user_recharge_rolling.z'] },
    ];
    expect(distinctAsOf(playbooks, asOfByCube)).toEqual(['2026-05-01', '2026-06-09']);
  });

  it('skips unavailable playbooks (they query nothing)', () => {
    const playbooks = [
      { availability: 'unavailable', dataRequirements: ['user_gameplay_daily.x'] },
      { availability: 'available', dataRequirements: ['mf_users.y'] },
    ];
    expect(distinctAsOf(playbooks, asOfByCube)).toEqual(['2026-06-09']);
  });

  it('omits cubes with no known as-of date', () => {
    const playbooks = [{ availability: 'available', dataRequirements: ['unknown_cube.x'] }];
    expect(distinctAsOf(playbooks, asOfByCube)).toEqual([]);
  });
});
