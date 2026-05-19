import { describe, it, expect } from 'vitest';
import { getPreset, getPresetByHubCube, listPresets } from '../registry';

describe('preset registry', () => {
  it('resolves mf_users-hub by id', () => {
    const p = getPreset('mf_users-hub');
    expect(p).not.toBeNull();
    expect(p?.hubCube).toBe('mf_users');
    expect(p?.identityDim).toBe('mf_users.user_id');
  });

  it('returns null for unknown id', () => {
    expect(getPreset('does-not-exist')).toBeNull();
    expect(getPreset(null)).toBeNull();
    expect(getPreset(undefined)).toBeNull();
  });

  it('resolves by hubCube', () => {
    expect(getPresetByHubCube('mf_users')?.id).toBe('mf_users-hub');
    expect(getPresetByHubCube('unknown_cube')).toBeNull();
  });

  it('lists all presets', () => {
    expect(listPresets()).toHaveLength(1);
  });

  it('mf_users-hub preset has overview + engagement + monetization + retention tabs', () => {
    const p = getPreset('mf_users-hub')!;
    const tabIds = p.tabs.map((t) => t.id);
    expect(tabIds).toEqual(['overview', 'engagement', 'monetization', 'retention']);
  });

  it('mf_users-hub preset has 4 headline KPIs', () => {
    const p = getPreset('mf_users-hub')!;
    expect(p.headlineKpis).toHaveLength(4);
  });
});
