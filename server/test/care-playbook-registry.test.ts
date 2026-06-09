/**
 * Phase-0 contract: threshold-rule compilation, per-game availability gating,
 * /meta member extraction, and seed ⊕ override merge. All pure — no network, no DB.
 */

import { describe, it, expect } from 'vitest';
import { compileRule, ruleMembers, type ThresholdRule } from '../src/care/threshold-rule.js';
import {
  resolveAvailability,
  extractLogicalMembers,
} from '../src/care/availability.js';
import { SEED_PLAYBOOKS, getSeedPlaybook, type Playbook } from '../src/care/playbook-registry.js';
import { mergePlaybooks } from '../src/care/playbook-merge.js';
import type { CarePlaybookOverride } from '../src/care/care-playbooks-store.js';

describe('threshold-rule compiler', () => {
  it('abs → a single gte/lte leaf, membership', () => {
    const r: ThresholdRule = { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 50_000_000 };
    const c = compileRule(r);
    expect(c.evalMode).toBe('membership');
    expect(c.predicate).toMatchObject({ kind: 'leaf', member: 'mf_users.ltv_total_vnd', op: 'gte', values: [50_000_000] });
  });

  it('tierStep → gte the lowest band', () => {
    const r: ThresholdRule = {
      kind: 'tierStep',
      member: 'mf_users.ltv_total_vnd',
      bands: [{ label: 'b3', min: 50_000_000 }, { label: 'b1', min: 5_000_000 }, { label: 'b2', min: 20_000_000 }],
    };
    const c = compileRule(r);
    expect(c.predicate).toMatchObject({ kind: 'leaf', op: 'gte', values: [5_000_000] });
  });

  it('event → inDateRange leaf with the window string', () => {
    const r: ThresholdRule = { kind: 'event', member: 'mf_users.first_recharge_date', window: 'last 24 hours' };
    const c = compileRule(r);
    expect(c.predicate).toMatchObject({ kind: 'leaf', op: 'inDateRange', values: ['last 24 hours'] });
  });

  it('event op "notIn" → notInDateRange leaf (event fell OUTSIDE the window)', () => {
    const r: ThresholdRule = { kind: 'event', member: 'mf_users.first_recharge_date', window: 'last 24 hours', op: 'notIn' };
    const c = compileRule(r);
    expect(c.predicate).toMatchObject({ kind: 'leaf', op: 'notInDateRange', values: ['last 24 hours'] });
    expect(c.evalMode).toBe('membership');
  });

  it('percentile is fail-closed until calibrated, then compiles to a cutoff leaf', () => {
    const r: ThresholdRule = { kind: 'percentile', of: 'mf_users.ltv_total_vnd', p: 90 };
    const uncal = compileRule(r);
    expect(uncal.predicate).toBeNull();
    expect(uncal.evalMode).toBe('membership');
    expect(uncal.reason).toMatch(/calibrat/i);

    const cal = compileRule(r, { cutoff: 12_345_678 });
    expect(cal.predicate).toMatchObject({ kind: 'leaf', op: 'gte', values: [12_345_678] });
  });

  it('percentile op "lte" compiles the calibrated cutoff to a bottom-Pn leaf', () => {
    const r: ThresholdRule = { kind: 'percentile', of: 'mf_users.ltv_total_vnd', p: 10, op: 'lte' };
    const cal = compileRule(r, { cutoff: 1_000_000 });
    expect(cal.predicate).toMatchObject({ kind: 'leaf', op: 'lte', values: [1_000_000] });
  });

  it('ratio is per-member (trigger), never a cohort predicate', () => {
    const r: ThresholdRule = { kind: 'ratio', member: 'a.7d', vs: 'a.30d_avg', value: 0.3, op: 'lt' };
    const c = compileRule(r);
    expect(c.predicate).toBeNull();
    expect(c.evalMode).toBe('trigger');
  });

  it('ruleMembers reports the members a rule reads', () => {
    expect(ruleMembers({ kind: 'ratio', member: 'a.x', vs: 'a.y', value: 1, op: 'lt' })).toEqual(['a.x', 'a.y']);
    expect(ruleMembers({ kind: 'percentile', of: 'a.x', p: 90, gate: 'a.g' })).toEqual(['a.x', 'a.g']);
  });
});

describe('extractLogicalMembers', () => {
  it('collects cube.field and strips the game prefix on prefix workspaces', () => {
    const meta = {
      cubes: [
        { name: 'cfm_mf_users', dimensions: [{ name: 'cfm_mf_users.ltv_total_vnd' }], measures: [{ name: 'cfm_mf_users.count' }] },
      ],
    };
    const set = extractLogicalMembers(meta, 'cfm');
    expect(set.has('mf_users.ltv_total_vnd')).toBe(true);
    expect(set.has('mf_users.count')).toBe(true);
  });

  it('is a no-op on game_id workspaces (null prefix)', () => {
    const meta = { cubes: [{ name: 'mf_users', dimensions: [{ name: 'mf_users.first_active_date' }] }] };
    const set = extractLogicalMembers(meta, null);
    expect(set.has('mf_users.first_active_date')).toBe(true);
  });

  it('scopes to ONE game on a prefix workspace — never unions other games cubes', () => {
    // Game-less /meta on prod returns BOTH games' cubes. Requesting jus must NOT
    // inherit cfm's gameplay cube (the per-game availability bug, C1).
    const meta = {
      cubes: [
        { name: 'jus_mf_users', dimensions: [{ name: 'jus_mf_users.ltv_total_vnd' }] },
        { name: 'cfm_user_gameplay_daily', dimensions: [{ name: 'cfm_user_gameplay_daily.ladder_rank' }] },
      ],
    };
    const jus = extractLogicalMembers(meta, 'jus');
    expect(jus.has('mf_users.ltv_total_vnd')).toBe(true);
    expect(jus.has('user_gameplay_daily.ladder_rank')).toBe(false); // cfm's cube excluded
    const cfm = extractLogicalMembers(meta, 'cfm');
    expect(cfm.has('user_gameplay_daily.ladder_rank')).toBe(true);
    expect(cfm.has('mf_users.ltv_total_vnd')).toBe(false); // jus's cube excluded
  });
});

// jus-like: payment + activity modeled, NO gameplay/event-table cubes.
const JUS_MEMBERS = new Set<string>([
  'mf_users.first_recharge_date',
  'mf_users.ltv_total_vnd',
  'mf_users.days_since_last_active',
  'mf_users.first_active_date',
  'user_recharge_daily.revenue_vnd',
  'user_recharge_daily.log_date',
  'active_daily.online_time_sec',
  'active_daily.log_date',
]);

describe('availability resolver (per game × playbook)', () => {
  const pb = (id: string) => getSeedPlaybook(id) as Playbook;

  it('jus: payment/churn/anniversary available; NHÓM 2 unavailable', () => {
    expect(resolveAvailability(pb('02'), JUS_MEMBERS)).toBe('available'); // VIP tier
    expect(resolveAvailability(pb('14'), JUS_MEMBERS)).toBe('available'); // no-login
    expect(resolveAvailability(pb('18'), JUS_MEMBERS)).toBe('available'); // anniversary
    expect(resolveAvailability(pb('06'), JUS_MEMBERS)).toBe('unavailable'); // leaderboard
    expect(resolveAvailability(pb('12'), JUS_MEMBERS)).toBe('unavailable'); // gacha
  });

  it('spend/session playbooks need their rolling marts — available with them, unavailable without', () => {
    // 03/04/15 now read the materialized rolling ratios (user_recharge_rolling /
    // user_active_rolling). jus has no rolling marts → unavailable (fail-closed).
    expect(resolveAvailability(pb('03'), JUS_MEMBERS)).toBe('unavailable'); // spend spike
    expect(resolveAvailability(pb('04'), JUS_MEMBERS)).toBe('unavailable'); // spend drop
    expect(resolveAvailability(pb('15'), JUS_MEMBERS)).toBe('unavailable'); // session-time drop

    // With the rolling-mart members present (cfm post-mart) they flip to available
    // — cohort-queryable ratios, not raw etl_.
    const withRolling = new Set([
      ...JUS_MEMBERS,
      'user_recharge_rolling.spike_ratio',
      'user_recharge_rolling.qualified_drop_ratio',
      'user_active_rolling.qualified_session_ratio',
    ]);
    expect(resolveAvailability(pb('03'), withRolling)).toBe('available');
    expect(resolveAvailability(pb('04'), withRolling)).toBe('available');
    expect(resolveAvailability(pb('15'), withRolling)).toBe('available');
  });

  it('blocked playbooks are always unavailable; ops-driven are partial', () => {
    expect(resolveAvailability(pb('05'), JUS_MEMBERS)).toBe('unavailable'); // payment failure (blocked)
    expect(resolveAvailability(pb('13'), JUS_MEMBERS)).toBe('unavailable'); // sentiment (blocked)
    expect(resolveAvailability(pb('19'), JUS_MEMBERS)).toBe('partial'); // pre-patch (ops)
    expect(resolveAvailability(pb('20'), JUS_MEMBERS)).toBe('partial'); // new content (ops)
  });

  it('cfm post-mart: gameplay flips to available; raw etl_* stays partial', () => {
    const cfm = new Set([
      ...JUS_MEMBERS,
      'user_gameplay_daily.ladder_rank',
      'user_gameplay_daily.ladder_rank_drop_48h',
      'user_gameplay_daily.clan_switched_recent',
      'user_gameplay_daily.clan_left_recent',
      'etl_prop_flow.prop_id',
      'etl_prop_flow.acquired_at',
      'user_gameplay_daily.limited_set_owned_count',
    ]);
    expect(resolveAvailability(pb('06'), cfm)).toBe('available'); // leaderboard, mart member present
    expect(resolveAvailability(pb('08'), cfm)).toBe('available'); // rank drop
    expect(resolveAvailability(pb('09'), cfm)).toBe('available'); // major achievement (rank == 1)
    expect(resolveAvailability(pb('10'), cfm)).toBe('available'); // guild instability — clan-switch flag
    expect(resolveAvailability(pb('17'), cfm)).toBe('available'); // clan left — clan-left flag
    expect(resolveAvailability(pb('07'), cfm)).toBe('partial'); // raw etl_prop_flow → per-member only
    expect(resolveAvailability(pb('11'), cfm)).toBe('partial'); // requires etl_prop_flow

    // The clan playbooks gate on a 1/0 flag (abs =1), not an event-window on a
    // timestamp — so they resolve as a cohort-queryable membership rule.
    expect(resolveAvailability(pb('10'), JUS_MEMBERS)).toBe('unavailable'); // no gameplay mart
    expect(resolveAvailability(pb('17'), JUS_MEMBERS)).toBe('unavailable');
    const merged = mergePlaybooks('cfm_vn', cfm, []);
    expect(merged.find((p) => p.id === '10')!.evalMode).toBe('membership');
    expect(merged.find((p) => p.id === '17')!.evalMode).toBe('membership');
  });
});

describe('mergePlaybooks (seed ⊕ override)', () => {
  it('returns all 21 seeds with resolved availability + compiled predicate', () => {
    const merged = mergePlaybooks('jus_vn', JUS_MEMBERS, []);
    expect(merged).toHaveLength(SEED_PLAYBOOKS.length);
    const p02 = merged.find((p) => p.id === '02')!;
    expect(p02.source).toBe('seed');
    expect(p02.availability).toBe('available');
    expect(p02.predicate).not.toBeNull();
    // 04 now reads the materialized rolling drop_ratio (abs) → membership with a
    // real cohort predicate (no longer a per-member trigger ratio).
    const p04 = merged.find((p) => p.id === '04')!;
    expect(p04.evalMode).toBe('membership');
    expect(p04.predicate).not.toBeNull();
  });

  it('override wins per field and flips source to override; disabled honored', () => {
    const ov: CarePlaybookOverride = {
      id: 'ov-1',
      gameId: 'jus_vn',
      baseId: '14',
      condition: { kind: 'abs', member: 'mf_users.days_since_last_active', op: 'gte', value: 5 },
      enabled: false,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const merged = mergePlaybooks('jus_vn', JUS_MEMBERS, [ov]);
    const p14 = merged.find((p) => p.id === '14')!;
    expect(p14.source).toBe('override');
    expect(p14.enabled).toBe(false);
    expect(p14.predicate).toMatchObject({ values: [5] });
  });

  it('net-new (base_id null) override is appended as a custom playbook', () => {
    const ov: CarePlaybookOverride = {
      id: 'ov-new',
      gameId: 'jus_vn',
      baseId: null,
      name: 'Custom whale watch',
      group: 'payment',
      priority: 'cao',
      dataRequirements: ['mf_users.ltv_total_vnd'],
      condition: { kind: 'abs', member: 'mf_users.ltv_total_vnd', op: 'gte', value: 200_000_000 },
      watchedMetric: { member: 'mf_users.ltv_total_vnd', label: 'LTV' },
      action: { text: 'watch', channels: ['call'] },
      enabled: true,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const merged = mergePlaybooks('jus_vn', JUS_MEMBERS, [ov]);
    expect(merged).toHaveLength(SEED_PLAYBOOKS.length + 1);
    const custom = merged.find((p) => p.overrideId === 'ov-new')!;
    expect(custom.source).toBe('custom');
    expect(custom.availability).toBe('available');
    expect(custom.name).toBe('Custom whale watch');
  });

  it('percentile calibration result flips calibrated flag + compiles cutoff', () => {
    // Inject a synthetic percentile playbook via a net-new override.
    const ov: CarePlaybookOverride = {
      id: 'ov-pct',
      gameId: 'jus_vn',
      baseId: null,
      name: 'P90 LTV',
      group: 'payment',
      priority: 'cao',
      dataRequirements: ['mf_users.ltv_total_vnd'],
      condition: { kind: 'percentile', of: 'mf_users.ltv_total_vnd', p: 90 },
      enabled: true,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const merged = mergePlaybooks('jus_vn', JUS_MEMBERS, [ov], {
      calibration: { 'ov-pct': { cutoff: 9_000_000 } },
    });
    const pct = merged.find((p) => p.overrideId === 'ov-pct')!;
    expect(pct.calibrated).toBe(true);
    expect(pct.predicate).toMatchObject({ op: 'gte', values: [9_000_000] });
  });
});
