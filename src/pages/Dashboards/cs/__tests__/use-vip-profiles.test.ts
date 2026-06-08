/**
 * Pure merge/derive logic for VIP-queue profile enrichment: profile rows (one
 * per uid) + role rows (many per uid) → one VipProfile map, with churn-pay days
 * derived from last_recharge_date and the display name taken from the player's
 * highest-level character.
 */

import { describe, it, expect } from 'vitest';
import { mergeVipProfiles, daysSince, toNum } from '../use-vip-profiles';

// Fixed clock so derived day counts are deterministic.
const NOW = Date.parse('2026-06-09T00:00:00Z');

describe('daysSince', () => {
  it('returns whole days between a date and now', () => {
    expect(daysSince('2026-06-02T00:00:00Z', NOW)).toBe(7);
  });
  it('clamps future dates to 0 and rejects unparseable / null', () => {
    expect(daysSince('2026-06-20T00:00:00Z', NOW)).toBe(0);
    expect(daysSince('not-a-date', NOW)).toBeNull();
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('toNum', () => {
  it('coerces numeric strings and rejects junk', () => {
    expect(toNum('1500000')).toBe(1_500_000);
    expect(toNum(42)).toBe(42);
    expect(toNum('abc')).toBeNull();
    expect(toNum(null)).toBeNull();
  });
});

describe('mergeVipProfiles', () => {
  it('maps profile fields and derives churn-pay days', () => {
    const map = mergeVipProfiles(
      [
        {
          'user_profile.user_id': 'vip1',
          'user_profile.ltv_vnd': '944000000',
          'user_profile.max_vip_level': '8',
          'user_profile.lifecycle_stage': 'active',
          'user_profile.days_since_last_active': '12',
          'user_profile.last_recharge_date': '2026-05-26T00:00:00Z',
        },
      ],
      [],
      NOW,
    );
    const p = map.get('vip1')!;
    expect(p.ltvVnd).toBe(944_000_000);
    expect(p.vipLevel).toBe(8);
    expect(p.status).toBe('active');
    expect(p.churnPlayDays).toBe(12);
    expect(p.churnPayDays).toBe(14); // May 26 → Jun 9
    expect(p.name).toBeNull(); // no role rows
  });

  it('picks the highest-level character as the display name', () => {
    const map = mergeVipProfiles(
      [{ 'user_profile.user_id': 'vip1', 'user_profile.ltv_vnd': '1000' }],
      [
        { 'user_roles_panel.user_id': 'vip1', 'user_roles_panel.last_role_name': 'Alt', 'user_roles_panel.max_role_level': '30' },
        { 'user_roles_panel.user_id': 'vip1', 'user_roles_panel.last_role_name': 'Main', 'user_roles_panel.max_role_level': '88' },
      ],
      NOW,
    );
    expect(map.get('vip1')!.name).toBe('Main');
  });

  it('breaks equal-level name ties deterministically (lexically smaller wins, order-independent)', () => {
    const rowsA = [
      { 'user_roles_panel.user_id': 'u', 'user_roles_panel.last_role_name': 'Zeta', 'user_roles_panel.max_role_level': '50' },
      { 'user_roles_panel.user_id': 'u', 'user_roles_panel.last_role_name': 'Alpha', 'user_roles_panel.max_role_level': '50' },
    ];
    const a = mergeVipProfiles([], rowsA, NOW).get('u')!.name;
    const b = mergeVipProfiles([], [...rowsA].reverse(), NOW).get('u')!.name;
    expect(a).toBe('Alpha');
    expect(b).toBe('Alpha'); // same result regardless of row order
  });

  it('keeps a role-only uid (name without profile row) with null metrics', () => {
    const map = mergeVipProfiles(
      [],
      [{ 'user_roles_panel.user_id': 'ghost', 'user_roles_panel.last_role_name': 'Solo', 'user_roles_panel.max_role_level': '5' }],
      NOW,
    );
    const p = map.get('ghost')!;
    expect(p.name).toBe('Solo');
    expect(p.ltvVnd).toBeNull();
    expect(p.churnPayDays).toBeNull();
  });

  it('null last_recharge_date → null churn-pay (never recharged)', () => {
    const map = mergeVipProfiles(
      [{ 'user_profile.user_id': 'u', 'user_profile.last_recharge_date': null }],
      [],
      NOW,
    );
    expect(map.get('u')!.churnPayDays).toBeNull();
  });
});
