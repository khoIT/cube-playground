import { describe, it, expect } from 'vitest';
import { getPresetByHubCube, resolvePivotPreset } from '../registry';
import { etlGameDetailPreset } from '../etl-game-detail';
import { mfUsersHubPreset } from '../mf-users-hub';

describe('etl_game_detail curated preset', () => {
  it('resolves from the registry by hub cube', () => {
    expect(getPresetByHubCube('etl_game_detail')).toBe(etlGameDetailPreset);
  });

  it('uses the cross-cube mf_users identity (event playerid is a role id, not a user id)', () => {
    expect(etlGameDetailPreset.identityDim).toBe('mf_users.user_id');
  });

  it('keeps the insights sub-tab ids the pill bar renders', () => {
    expect(etlGameDetailPreset.tabs.map((tab) => tab.id)).toEqual([
      'overview',
      'engagement',
      'monetization',
      'retention',
    ]);
  });

  it('mixes grains: event measures in overview, user-master measures in monetization', () => {
    const overview = etlGameDetailPreset.tabs.find((tab) => tab.id === 'overview')!;
    const monetization = etlGameDetailPreset.tabs.find((tab) => tab.id === 'monetization')!;
    expect(overview.cards.every((c) => c.measure.startsWith('etl_game_detail.'))).toBe(true);
    expect(monetization.cards.every((c) => c.measure.startsWith('mf_users.'))).toBe(true);
  });
});

describe('resolvePivotPreset — identity-anchor pivot', () => {
  it('pivots a curated-preset-less cube to its identity anchor preset', () => {
    const pivoted = resolvePivotPreset('etl_money_flow', 'mf_users.user_id');
    expect(pivoted).not.toBeNull();
    expect(pivoted!.id).toBe(mfUsersHubPreset.id);
    expect(pivoted!.pivotedFromCube).toBe('etl_money_flow');
  });

  it('does not pivot when the identity lives on the segment cube itself', () => {
    expect(resolvePivotPreset('mf_users', 'mf_users.user_id')).toBeNull();
  });

  it('does not pivot when the anchor cube has no curated preset', () => {
    expect(resolvePivotPreset('etl_money_flow', 'std_bridge.vopenid')).toBeNull();
  });

  it('returns null for missing inputs', () => {
    expect(resolvePivotPreset(null, 'mf_users.user_id')).toBeNull();
    expect(resolvePivotPreset('etl_money_flow', null)).toBeNull();
    expect(resolvePivotPreset('etl_money_flow', 'not-a-member')).toBeNull();
  });

  it('never mutates the registry preset (clone carries the pivot flag)', () => {
    resolvePivotPreset('etl_money_flow', 'mf_users.user_id');
    expect(
      (mfUsersHubPreset as { pivotedFromCube?: string }).pivotedFromCube,
    ).toBeUndefined();
  });
});
