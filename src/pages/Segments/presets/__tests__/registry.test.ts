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

  it('lists all curated presets', () => {
    expect(listPresets().length).toBeGreaterThanOrEqual(2);
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

  it('resolves recharge-events by id and by hubCube', () => {
    const byId = getPreset('recharge-events');
    expect(byId).not.toBeNull();
    expect(byId?.hubCube).toBe('recharge');
    expect(byId?.identityDim).toBe('recharge.user_id');

    const byHub = getPresetByHubCube('recharge');
    expect(byHub?.id).toBe('recharge-events');
  });

  it('recharge-events preset has 4 tabs + 4 headline KPIs', () => {
    const p = getPreset('recharge-events')!;
    expect(p.tabs.map((t) => t.id)).toEqual([
      'overview',
      'engagement',
      'monetization',
      'retention',
    ]);
    expect(p.headlineKpis).toHaveLength(4);
  });

  it('curated presets are not flagged as auto', () => {
    expect(getPreset('mf_users-hub')!.auto).toBeFalsy();
    expect(getPreset('recharge-events')!.auto).toBeFalsy();
  });

  it('recharge-events memberColumns mix measures and dimensions', () => {
    const cols = getPreset('recharge-events')!.memberColumns!;
    expect(cols).toHaveLength(4);
    const measures = cols.filter((c) => c.measure).map((c) => c.id);
    const dims = cols.filter((c) => c.dimension).map((c) => c.id);
    expect(measures).toEqual(['revenue', 'txns']);
    expect(dims).toEqual(['account', 'country']);
  });
});
