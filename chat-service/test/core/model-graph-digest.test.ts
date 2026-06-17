/**
 * Unit + snapshot tests for the model-graph digest (P1).
 * Pure functions only — no /meta fetch, no memo resolver (covered by the
 * turn-path wiring). Fixture mirrors a cfm_vn-shaped meta: user hub + bridge,
 * recharge/activity clusters, an etl session/behavior split, an isolated mart.
 */

import { describe, it, expect } from 'vitest';
import { buildDigest, renderDigest, detectGamePrefix } from '../../src/core/model-graph-digest.js';

interface FixtureCube {
  name: string;
  type?: string;
  title?: string;
  description?: string;
  dimensions?: Array<{ name: string; primaryKey?: boolean }>;
  joins?: Array<{ name: string; relationship?: string; sql?: string }>;
}

function cfmFixture(prefix = ''): FixtureCube[] {
  const p = (n: string) => `${prefix}${n}`;
  return [
    {
      name: p('mf_users'),
      title: 'Users',
      dimensions: [{ name: `${p('mf_users')}.user_id`, primaryKey: true }],
    },
    {
      name: p('user_roles'),
      joins: [{ name: p('mf_users'), relationship: 'belongsTo', sql: `\${CUBE}.user_id = \${${p('mf_users')}}.user_id` }],
    },
    {
      name: p('user_recharge_daily'),
      joins: [{ name: p('mf_users'), relationship: 'belongsTo', sql: `\${CUBE}.user_id = \${${p('mf_users')}}.user_id` }],
    },
    {
      name: p('active_performance_daily'),
      joins: [{ name: p('mf_users'), relationship: 'belongsTo', sql: `\${CUBE}.user_id = \${${p('mf_users')}}.user_id` }],
    },
    {
      name: p('etl_login'),
      joins: [{ name: p('mf_users'), relationship: 'belongsTo', sql: `\${CUBE}.vopenid = \${${p('mf_users')}}.user_id` }],
    },
    {
      name: p('etl_game_detail'),
      joins: [{ name: p('user_roles'), relationship: 'belongsTo', sql: `\${CUBE}.role_id = \${${p('user_roles')}}.role_id` }],
    },
    { name: p('game_key_metrics') },
    { name: p('users_view'), type: 'view' },
  ];
}

describe('detectGamePrefix', () => {
  it('returns undefined for a bare game_id layout', () => {
    expect(detectGamePrefix(['mf_users', 'user_roles'])).toBeUndefined();
  });

  it('derives the prefix from a prefixed hub cube', () => {
    expect(detectGamePrefix(['cfm_vn_user_roles', 'cfm_vn_mf_users'])).toBe('cfm_vn');
  });

  it('returns undefined when no hub-like cube is present', () => {
    expect(detectGamePrefix(['game_key_metrics', 'marketing_cost'])).toBeUndefined();
  });
});

describe('buildDigest', () => {
  it('identifies the hub + its primary key', () => {
    const d = buildDigest(cfmFixture());
    expect(d.hub).toEqual({ cube: 'mf_users', pk: 'user_id' });
  });

  it('lists the cubes that join N:1 into the hub', () => {
    const d = buildDigest(cfmFixture());
    const inbound = d.hubInbound.map((e) => e.cube);
    expect(inbound).toContain('user_roles');
    expect(inbound).toContain('user_recharge_daily');
    expect(inbound).toContain('active_performance_daily');
    expect(inbound).toContain('etl_login');
    // etl_game_detail reaches the user via the role bridge, not directly.
    expect(inbound).not.toContain('etl_game_detail');
  });

  it('preserves the real hub key label for non-user_id foreign keys', () => {
    const d = buildDigest(cfmFixture());
    const login = d.hubInbound.find((e) => e.cube === 'etl_login');
    expect(login?.keyLabel).toBe('vopenid → user_id');
  });

  it('clusters non-hub cubes and excludes the hub itself', () => {
    const d = buildDigest(cfmFixture());
    expect(d.clusters.hub).toBeUndefined();
    expect(d.clusters.recharge).toContain('user_recharge_daily');
    expect(d.clusters.activity).toContain('active_performance_daily');
    expect(d.clusters.bridge).toContain('user_roles');
    expect(d.clusters.session).toContain('etl_login');
    expect(d.clusters.behavior).toContain('etl_game_detail');
  });

  it('flags cubes with no join to the user as isolated', () => {
    const d = buildDigest(cfmFixture());
    expect(d.isolated).toContain('game_key_metrics');
    expect(d.isolated).not.toContain('user_recharge_daily');
  });

  it('excludes views from the cube count', () => {
    const d = buildDigest(cfmFixture());
    expect(d.cubeCount).toBe(7); // 8 cubes minus the one view
  });

  it('produces identical base-name topology on prefixed and bare layouts', () => {
    const bare = buildDigest(cfmFixture());
    const prefixed = buildDigest(cfmFixture('cfm_vn_'), 'cfm_vn');
    expect(prefixed.hub).toEqual(bare.hub);
    expect(prefixed.hubInbound.map((e) => e.cube).sort()).toEqual(
      bare.hubInbound.map((e) => e.cube).sort(),
    );
    expect(prefixed.isolated).toEqual(bare.isolated);
  });
});

describe('renderDigest', () => {
  it('renders a terse, prompt-sized block', () => {
    const text = renderDigest(buildDigest(cfmFixture()), 'cfm_vn');
    expect(text).toMatchSnapshot();
  });

  it('stays under ~400 tokens (rough char ceiling)', () => {
    const text = renderDigest(buildDigest(cfmFixture()), 'cfm_vn');
    // ~4 chars/token → 400 tokens ≈ 1600 chars. Small fixture, ample headroom.
    expect(text.length).toBeLessThan(1600);
  });

  it('returns empty string for an empty model (no hub, no clusters)', () => {
    expect(renderDigest(buildDigest([]))).toBe('');
  });

  it('names the hub and its key in the rendered text', () => {
    const text = renderDigest(buildDigest(cfmFixture()), 'cfm_vn');
    expect(text).toContain('Hub: mf_users (pk user_id)');
    expect(text).toContain('Isolated');
  });
});
