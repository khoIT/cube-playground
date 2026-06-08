/**
 * Unit tests for the Member 360 view scaffolder — pure registry → draft YAML.
 * Guards: core-360 games map to the canonical base cubes, the YAML carries the
 * members the panels read, and unconfigured games scaffold nothing.
 */

import { describe, it, expect } from 'vitest';

import { scaffoldMember360View } from '../src/services/member360-view-scaffolder.js';

describe('scaffoldMember360View', () => {
  it('scaffolds the 4 core views for a core-360 game (jus_vn), all base cubes known', () => {
    const r = scaffoldMember360View('jus_vn');
    expect(r.views.map((v) => v.name)).toEqual([
      'user_profile',
      'user_activity_timeline',
      'user_recharge_timeline',
      'user_transactions',
    ]);
    expect(r.unknownViews).toEqual([]);
    const byName = new Map(r.views.map((v) => [v.name, v]));
    expect(byName.get('user_profile')?.baseCube).toBe('mf_users');
    expect(byName.get('user_recharge_timeline')?.baseCube).toBe('user_recharge_daily');
    expect(byName.get('user_transactions')?.baseCube).toBe('recharge');
  });

  it('includes are bare base-cube fields (no view prefix) and deduped', () => {
    const r = scaffoldMember360View('jus_vn');
    const profile = r.views.find((v) => v.name === 'user_profile')!;
    expect(profile.includes).toContain('user_id');
    expect(profile.includes).toContain('ltv_vnd');
    // no `view.` prefixes leaked into includes
    expect(profile.includes.every((f) => !f.includes('.'))).toBe(true);
    // dedup: each field appears once
    expect(new Set(profile.includes).size).toBe(profile.includes.length);
  });

  it('emits valid-looking YAML with the DRAFT header + join_path + members', () => {
    const r = scaffoldMember360View('jus_vn');
    expect(r.yaml).toContain('# DRAFT');
    expect(r.yaml).toContain('views/jus_vn/user_360.yml');
    expect(r.yaml).toContain('join_path: mf_users');
    expect(r.yaml).toContain('- user_id');
  });

  it('scaffolds the extended CFM panel set with its base cubes', () => {
    const r = scaffoldMember360View('cfm_vn');
    const byName = new Map(r.views.map((v) => [v.name, v.baseCube]));
    expect(byName.get('user_roles_panel')).toBe('user_roles');
    expect(byName.get('user_devices_panel')).toBe('user_devices');
    expect(byName.get('user_activity_monthly')).toBe('user_active_monthly');
    expect(r.unknownViews).toEqual([]);
  });

  it('returns no views for a game with no 360 config', () => {
    const r = scaffoldMember360View('gunpow');
    expect(r.views).toEqual([]);
  });
});
