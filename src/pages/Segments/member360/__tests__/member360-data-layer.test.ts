import { describe, it, expect } from 'vitest';
import { panelsForGame, hasMember360, type Member360Panel } from '../member360-panels';
import { buildPanelQuery, defaultBehaviorRange } from '../build-panel-query';
import { rangeForDays } from '../behavior-date-range';
import { formatCell } from '../format-cell';

// Mirror of cube.js BEHAVIOR_VIEWS — the guardrail's ≤31d-bounded view set.
// A behavior panel whose view is NOT here would be queried unbounded and
// rejected at runtime, so the config must stay a subset of this set.
const BEHAVIOR_VIEWS = new Set([
  'user_matches_panel',
  'user_team_starts_panel',
  'user_money_flow_panel',
  'user_lottery_panel',
  'user_tutorial_panel',
  'user_newbie_detail_panel',
  'user_game_detail_panel',
  'user_prop_flow_panel',
  'user_login_panel',
  'user_logout_panel',
  'user_register_panel',
]);
const MAX_RANGE_DAYS = 31;
const TIME_DIM_FIELDS = new Set(['log_date', 'dteventtime']);

describe('member360 panel registry', () => {
  it('enables configured games, disables unconfigured games', () => {
    expect(hasMember360('cfm')).toBe(true);
    expect(hasMember360('cfm_vn')).toBe(true);
    expect(hasMember360('ballistar')).toBe(true);
    expect(hasMember360('cros')).toBe(true);
    expect(hasMember360('tf')).toBe(true);
    expect(hasMember360('muaw')).toBe(true);
    expect(hasMember360('pubg')).toBe(true);
    // gunpow has no user_360 config → still disabled.
    expect(hasMember360('gunpow')).toBe(false);
    expect(hasMember360(null)).toBe(false);
  });

  it('has a single profile panel per game', () => {
    for (const g of ['cfm', 'ballistar']) {
      const profiles = panelsForGame(g).filter((p) => p.panelType === 'profile');
      expect(profiles).toHaveLength(1);
    }
  });

  it('every cfm behavior panel is in the cube.js guardrail set, lazy + needsDateRange', () => {
    const behavior = panelsForGame('cfm').filter((p) => p.section === 'behavior');
    expect(behavior.length).toBeGreaterThan(0);
    for (const p of behavior) {
      expect(BEHAVIOR_VIEWS.has(p.view)).toBe(true);
      expect(p.needsDateRange).toBe(true);
      expect(p.lazy).toBe(true);
      expect(p.timeDimension).toBe(`${p.view}.dteventtime`);
    }
  });

  it('ballistar has no behavior panels (core 360 only)', () => {
    expect(panelsForGame('ballistar').filter((p) => p.section === 'behavior')).toHaveLength(0);
  });

  it('login/logout key clientsdkuserid; other event panels key playerid', () => {
    const behavior = panelsForGame('cfm').filter((p) => p.section === 'behavior');
    for (const p of behavior) {
      const expected = p.view.includes('login') || p.view.includes('logout') ? 'clientsdkuserid' : 'playerid';
      expect(p.identityKey).toBe(expected);
    }
  });
});

describe('buildPanelQuery', () => {
  const cfm = panelsForGame('cfm');
  const profile = cfm.find((p) => p.id === 'profile') as Member360Panel;
  const activity = cfm.find((p) => p.id === 'activity_timeline') as Member360Panel;
  const devices = cfm.find((p) => p.id === 'devices') as Member360Panel;

  it('returns null with no identity values', () => {
    expect(buildPanelQuery(profile, [])).toBeNull();
  });

  it('profile: identity equals filter, dimensions only, no order/dateRange', () => {
    const q = buildPanelQuery(profile, ['u1'])!;
    expect(q.filters).toEqual([
      { member: 'user_profile.user_id', operator: 'equals', values: ['u1'] },
    ]);
    expect(q.measures).toBeUndefined();
    expect(q.order).toBeUndefined();
    expect(q.dimensions).toContain('user_profile.user_id');
  });

  it('detailTable with a measure splits dims vs measures', () => {
    const q = buildPanelQuery(devices, ['u1'])!;
    expect(q.measures).toContain('user_devices_panel.rows');
    expect(q.dimensions).not.toContain('user_devices_panel.rows');
  });

  it('timeline leads with the time column and orders it desc', () => {
    const q = buildPanelQuery(activity, ['u1'])!;
    expect(q.dimensions?.[0]).toBe('user_activity_timeline.log_date');
    expect(q.order).toEqual({ 'user_activity_timeline.log_date': 'desc' });
    expect(q.limit).toBe(90);
  });

  it('EVERY behavior panel query carries a ≤31d log_date bound (guardrail-safe)', () => {
    const behavior = panelsForGame('cfm').filter((p) => p.section === 'behavior');
    const range = rangeForDays(30);
    for (const p of behavior) {
      const q = buildPanelQuery(p, ['role1', 'role2'], range)!;
      const bound = (q.filters ?? []).find(
        (f) => 'member' in f && (f as { operator?: string }).operator === 'inDateRange',
      ) as { member: string; values: string[] } | undefined;
      expect(bound, `${p.view} must bound a time dim`).toBeTruthy();
      const field = bound!.member.split('.', 2)[1];
      expect(TIME_DIM_FIELDS.has(field)).toBe(true);
      const [from, to] = bound!.values;
      const days = Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    }
  });

  it('behavior panel falls back to a bounded default range when none passed', () => {
    const matches = cfm.find((p) => p.id === 'matches') as Member360Panel;
    const q = buildPanelQuery(matches, ['r1'])!;
    const bound = (q.filters ?? []).find(
      (f) => 'member' in f && (f as { operator?: string }).operator === 'inDateRange',
    );
    expect(bound).toBeTruthy();
  });
});

describe('date range helpers', () => {
  it('rangeForDays / defaultBehaviorRange produce inclusive ≤31d windows', () => {
    const today = new Date('2026-06-04T00:00:00Z');
    expect(rangeForDays(30, today)).toEqual(['2026-05-06', '2026-06-04']);
    expect(rangeForDays(7, today)).toEqual(['2026-05-29', '2026-06-04']);
    expect(defaultBehaviorRange(today)).toEqual(['2026-05-06', '2026-06-04']);
  });
});

describe('formatCell', () => {
  it('blank → em dash', () => {
    expect(formatCell(null)).toBe('—');
    expect(formatCell('')).toBe('—');
  });
  it('shortens ISO dates / timestamps', () => {
    expect(formatCell('2026-06-04T13:45:00.000Z')).toBe('2026-06-04 13:45');
    expect(formatCell('2026-06-04')).toBe('2026-06-04');
  });
  it('currency compacts at 1M+ (exact value reserved for the tooltip), full below', () => {
    expect(formatCell(1_000_000, 'currency')).toBe('₫1M');
    const sub = formatCell(750_000, 'currency');
    expect(sub).toMatch(/₫|VND/);
    expect(sub).toContain('750,000');
  });
  it('duration humanizes seconds', () => {
    expect(formatCell(45, 'duration')).toBe('45s');
    expect(formatCell(3700, 'duration')).toBe('1h 2m');
  });
  it('number adds grouping', () => {
    expect(formatCell(12345, 'number')).toBe((12345).toLocaleString());
  });
});
