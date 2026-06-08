/**
 * Tests for the inline data-readiness gate logic used in PlaybookBuilderPage.
 *
 * The gate derives which Cube members are picked by the current ThresholdRule,
 * then checks them against the set of members that are confirmed available for
 * the active game (derived from the registry: any member that appears in at
 * least one non-unavailable playbook's dataRequirements is considered available).
 *
 * We test the pure helper functions extracted from the builder so there is no
 * React rendering dependency. The acceptance criteria are:
 *
 *   1. ruleMembers returns the correct member list for each ThresholdRule kind.
 *   2. Members present in at least one live/partial playbook → available.
 *   3. Members absent from all registry playbooks → not available → gate blocks.
 *   4. An empty members list → no block (no condition yet).
 *   5. ratio rules expose both 'member' and 'vs' for the availability check.
 */

import { describe, it, expect } from 'vitest';
import type { ThresholdRule } from '../../../../types/threshold-rule';
import type { ResolvedPlaybook } from '../use-care-playbooks';

// ── Pure helpers (mirrors the builder's inline logic) ─────────────────────────

/** Members a ThresholdRule reads — mirrors playbook-builder.tsx ruleMembers(). */
function ruleMembers(rule: ThresholdRule): string[] {
  switch (rule.kind) {
    case 'abs':
    case 'event':
    case 'tierStep':
      return rule.member ? [rule.member] : [];
    case 'percentile':
      return rule.gate
        ? [rule.of, rule.gate].filter(Boolean)
        : rule.of
        ? [rule.of]
        : [];
    case 'ratio':
      return [rule.member, rule.vs].filter(Boolean);
  }
}

/** Build the set of confirmed-available members from the registry. */
function buildAvailableSet(playbooks: ResolvedPlaybook[]): Set<string> {
  const available = new Set<string>();
  for (const pb of playbooks) {
    if (pb.availability !== 'unavailable') {
      for (const m of pb.dataRequirements) available.add(m);
    }
  }
  return available;
}

/** Returns true when all picked members are in the available set (or list is empty). */
function allMembersAvailable(members: string[], available: Set<string>): boolean {
  if (members.length === 0) return true;
  return members.every((m) => !m || available.has(m));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlaybook(
  overrides: Partial<ResolvedPlaybook> & { dataRequirements?: string[] },
): ResolvedPlaybook {
  return {
    id: 'pb-01',
    nhom: 1,
    group: 'payment',
    name: 'Test PB',
    priority: 'cao',
    dataRequirements: [],
    condition: { kind: 'abs', member: 'mf_users.ltv_vnd', op: 'gte', value: 0 } as unknown,
    watchedMetric: { member: 'mf_users.ltv_vnd', label: 'LTV' },
    action: { text: 'Contact', channels: ['in_game'] },
    source: 'seed',
    enabled: true,
    availability: 'available',
    evalMode: 'membership',
    predicate: null,
    calibrated: true,
    ...overrides,
  } as ResolvedPlaybook;
}

// ── ruleMembers ────────────────────────────────────────────────────────────────

describe('ruleMembers', () => {
  it('abs: returns [member] when member is set', () => {
    const rule: ThresholdRule = {
      kind: 'abs',
      member: 'mf_users.ltv_vnd',
      op: 'gte',
      value: 50_000_000,
    };
    expect(ruleMembers(rule)).toEqual(['mf_users.ltv_vnd']);
  });

  it('abs: returns [] when member is empty string', () => {
    const rule: ThresholdRule = { kind: 'abs', member: '', op: 'gte', value: 0 };
    expect(ruleMembers(rule)).toEqual([]);
  });

  it('tierStep: returns [member]', () => {
    const rule: ThresholdRule = {
      kind: 'tierStep',
      member: 'mf_users.vip_tier',
      bands: [{ label: 'Silver', min: 1 }],
    };
    expect(ruleMembers(rule)).toEqual(['mf_users.vip_tier']);
  });

  it('event: returns [member]', () => {
    const rule: ThresholdRule = {
      kind: 'event',
      member: 'mf_users.first_deposit_at',
      window: 'last 7 days',
    };
    expect(ruleMembers(rule)).toEqual(['mf_users.first_deposit_at']);
  });

  it('percentile: returns [of] when no gate', () => {
    const rule: ThresholdRule = { kind: 'percentile', of: 'mf_users.ltv_vnd', p: 90 };
    expect(ruleMembers(rule)).toEqual(['mf_users.ltv_vnd']);
  });

  it('percentile: returns [of, gate] when gate is set', () => {
    const rule: ThresholdRule = {
      kind: 'percentile',
      of: 'mf_users.ltv_vnd',
      p: 90,
      gate: 'mf_users.vip_tier',
    };
    expect(ruleMembers(rule)).toEqual(['mf_users.ltv_vnd', 'mf_users.vip_tier']);
  });

  it('ratio: returns both member and vs', () => {
    const rule: ThresholdRule = {
      kind: 'ratio',
      member: 'user_recharge_daily.revenue_7d',
      vs: 'user_recharge_daily.revenue_30d_avg',
      value: 0.5,
      op: 'lt',
    };
    expect(ruleMembers(rule)).toEqual([
      'user_recharge_daily.revenue_7d',
      'user_recharge_daily.revenue_30d_avg',
    ]);
  });

  it('ratio: filters out empty strings', () => {
    const rule: ThresholdRule = {
      kind: 'ratio',
      member: '',
      vs: 'user_recharge_daily.revenue_30d_avg',
      value: 0.5,
      op: 'lt',
    };
    // Empty member filtered; only vs is returned.
    expect(ruleMembers(rule)).toEqual(['user_recharge_daily.revenue_30d_avg']);
  });
});

// ── Availability gate ─────────────────────────────────────────────────────────

describe('allMembersAvailable (readiness gate)', () => {
  it('returns true when members list is empty (no condition yet)', () => {
    const available = buildAvailableSet([]);
    expect(allMembersAvailable([], available)).toBe(true);
  });

  it('member present in a live playbook dataRequirements → available', () => {
    const pb = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ltv_vnd'],
    });
    const available = buildAvailableSet([pb]);
    expect(allMembersAvailable(['mf_users.ltv_vnd'], available)).toBe(true);
  });

  it('member present in a partial playbook dataRequirements → available', () => {
    const pb = makePlaybook({
      availability: 'partial',
      dataRequirements: ['mf_users.ltv_vnd'],
    });
    const available = buildAvailableSet([pb]);
    expect(allMembersAvailable(['mf_users.ltv_vnd'], available)).toBe(true);
  });

  it('member absent from ALL playbooks → not available → gate returns false', () => {
    const pb = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ltv_vnd'],
    });
    const available = buildAvailableSet([pb]);
    // 'mf_users.ingame_score' is not in any playbook's dataRequirements.
    expect(allMembersAvailable(['mf_users.ingame_score'], available)).toBe(false);
  });

  it('member from an unavailable playbook only → not in available set → gate blocks', () => {
    // The only playbook that uses this member is itself unavailable.
    const pb = makePlaybook({
      availability: 'unavailable',
      dataRequirements: ['mf_users.blocked_member'],
    });
    const available = buildAvailableSet([pb]);
    expect(allMembersAvailable(['mf_users.blocked_member'], available)).toBe(false);
  });

  it('multiple members: all available → gate passes', () => {
    const pb = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ltv_vnd', 'user_recharge_daily.revenue_7d'],
    });
    const available = buildAvailableSet([pb]);
    expect(
      allMembersAvailable(['mf_users.ltv_vnd', 'user_recharge_daily.revenue_7d'], available),
    ).toBe(true);
  });

  it('multiple members: one missing → gate blocks', () => {
    const pb = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ltv_vnd'],
    });
    const available = buildAvailableSet([pb]);
    // Second member 'mf_users.ingame_score' missing.
    expect(
      allMembersAvailable(['mf_users.ltv_vnd', 'mf_users.ingame_score'], available),
    ).toBe(false);
  });

  it('empty-string member is treated as available (not yet filled in)', () => {
    const available = buildAvailableSet([]);
    // Empty string in list → treated as "no member picked" → passes gate.
    expect(allMembersAvailable([''], available)).toBe(true);
  });

  it('picking a member absent for jus_vn but present for cfm_vn blocks jus_vn only', () => {
    // cfm_vn playbooks cover 'mf_users.ltv_vnd'; jus_vn playbooks do not.
    const cfmPlaybook = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ltv_vnd'],
    });
    const jusPlaybook = makePlaybook({
      availability: 'available',
      dataRequirements: ['mf_users.ingame_score'], // different members
    });

    const cfmAvailable = buildAvailableSet([cfmPlaybook]);
    const jusAvailable = buildAvailableSet([jusPlaybook]);

    expect(allMembersAvailable(['mf_users.ltv_vnd'], cfmAvailable)).toBe(true);
    expect(allMembersAvailable(['mf_users.ltv_vnd'], jusAvailable)).toBe(false);
  });
});
