import { describe, expect, it } from 'vitest';
import type { CatalogCube } from '../../use-catalog-meta';
import { buildJoinGraph, clusterOf, cubeBaseName, parseKeyLabel } from '../build-join-graph';
import { viewComposition } from '../view-composition';

function cube(name: string, overrides: Partial<CatalogCube> = {}): CatalogCube {
  return { name, title: name, type: 'cube', measures: [], dimensions: [], ...overrides };
}

function join(name: string, sql: string, relationship = 'belongsTo') {
  return { name, sql, relationship };
}

/** Fixture mirroring cfm's local (bare-name) model shapes. */
function cfmFixture(): CatalogCube[] {
  return [
    cube('mf_users'),
    cube('user_roles', {
      joins: [join('mf_users', '`${CUBE}.user_id = ${mf_users}.user_id`')],
    }),
    cube('etl_login', {
      joins: [join('mf_users', '`${CUBE}.vopenid = ${mf_users}.user_id`')],
    }),
    cube('etl_game_detail', {
      joins: [join('user_roles', '`${CUBE}.vroleid = ${user_roles}.role_id`')],
    }),
    cube('user_recharge_daily', {
      joins: [join('mf_users', '`${CUBE}.user_id = ${mf_users}.user_id`', 'hasMany')],
    }),
    // No joins in either direction → isolated lint.
    cube('game_key_metrics'),
    // Join to a cube absent from the set → missingTarget lint.
    cube('etl_prop_flow', {
      joins: [join('std_ghost_bridge', '`${CUBE}.uid = ${std_ghost_bridge}.uid`')],
    }),
    {
      ...cube('user_360', { type: 'view' }),
      dimensions: [
        { name: 'user_360.user_id', aliasMember: 'mf_users.user_id' },
        { name: 'user_360.role_id', aliasMember: 'user_roles.role_id' },
      ],
      measures: [{ name: 'user_360.recharge', aliasMember: 'user_recharge_daily.total_amount' }],
    },
  ];
}

/** Same model under a prod prefix workspace (`cfm_vn_` single-underscore names). */
function prefixedFixture(): CatalogCube[] {
  const prefix = (n: string) => `cfm_vn_${n}`;
  return cfmFixture().map((c) => ({
    ...c,
    name: prefix(c.name),
    joins: c.joins?.map((j) => ({ ...j, name: prefix(j.name) })),
  }));
}

describe('cubeBaseName', () => {
  it('strips a single-underscore game prefix', () => {
    expect(cubeBaseName('cfm_vn_mf_users', 'cfm_vn')).toBe('mf_users');
  });

  it('strips a legacy double-underscore tenant prefix', () => {
    expect(cubeBaseName('cfm_vn__mf_users')).toBe('mf_users');
  });

  it('is a no-op for bare names without a prefix arg', () => {
    expect(cubeBaseName('mf_users')).toBe('mf_users');
    // Without the prefix arg, single-underscore names are NOT guessed at.
    expect(cubeBaseName('cfm_vn_mf_users')).toBe('cfm_vn_mf_users');
  });
});

describe('clusterOf', () => {
  it('assigns hub/bridge by exact base name', () => {
    expect(clusterOf('mf_users', [])).toBe('hub');
    expect(clusterOf('user_roles', ['mf_users'])).toBe('bridge');
  });

  it('splits etl_ cubes into session (direct mf_users join) vs behavior', () => {
    expect(clusterOf('etl_login', ['mf_users'])).toBe('session');
    expect(clusterOf('etl_game_detail', ['user_roles'])).toBe('behavior');
  });

  it('buckets non-event cubes by name keyword', () => {
    expect(clusterOf('user_recharge_daily', [])).toBe('recharge');
    expect(clusterOf('active_performance_daily', [])).toBe('activity');
    expect(clusterOf('device_map', [])).toBe('mapping');
    expect(clusterOf('map_provider_master', [])).toBe('profile');
    expect(clusterOf('game_key_metrics', [])).toBe('other');
  });

  it('clusters prefixed names identically when given the game prefix', () => {
    expect(clusterOf('cfm_vn_mf_users', [], 'cfm_vn')).toBe('hub');
    expect(clusterOf('cfm_vn_etl_login', ['cfm_vn_mf_users'], 'cfm_vn')).toBe('session');
    expect(clusterOf('cfm_vn_etl_game_detail', ['cfm_vn_user_roles'], 'cfm_vn')).toBe('behavior');
  });
});

describe('parseKeyLabel', () => {
  it('parses the backticked meta SQL shape', () => {
    expect(parseKeyLabel('`${CUBE}.user_id = ${mf_users}.user_id`', 'user_roles', 'mf_users')).toBe(
      'user_id → user_id',
    );
  });

  it('parses bare (unbackticked) template SQL', () => {
    expect(parseKeyLabel('${CUBE}.vopenid = ${mf_users}.user_id', 'etl_login', 'mf_users')).toBe(
      'vopenid → user_id',
    );
  });

  it('parses the raw-YAML {ref}.col shape', () => {
    expect(parseKeyLabel('{CUBE}.user_id = {mf_users}.user_id', 'user_roles', 'mf_users')).toBe(
      'user_id → user_id',
    );
  });

  it('falls back to declaration order when refs do not match names', () => {
    expect(parseKeyLabel('`${alias_a}.k1 = ${alias_b}.k2`', 'x', 'y')).toBe('k1 → k2');
  });

  it('falls back to squashed SQL (backticks trimmed) when no tokens parse', () => {
    expect(parseKeyLabel('`a.user_id  =\n  b.user_id`', 'a', 'b')).toBe('a.user_id = b.user_id');
  });

  it('returns empty string for missing SQL', () => {
    expect(parseKeyLabel(undefined, 'a', 'b')).toBe('');
  });
});

describe('buildJoinGraph', () => {
  it('builds nodes from non-view cubes only, with clusters', () => {
    const g = buildJoinGraph(cfmFixture());
    expect(g.nodes.map((n) => n.name)).not.toContain('user_360');
    const clusters = Object.fromEntries(g.nodes.map((n) => [n.name, n.cluster]));
    expect(clusters).toEqual({
      mf_users: 'hub',
      user_roles: 'bridge',
      etl_login: 'session',
      etl_game_detail: 'behavior',
      user_recharge_daily: 'recharge',
      game_key_metrics: 'other',
      etl_prop_flow: 'behavior',
    });
  });

  it('maps meta relationship vocabulary to cardinality glyphs', () => {
    const g = buildJoinGraph(cfmFixture());
    const byId = Object.fromEntries(g.edges.map((e) => [e.id, e]));
    expect(byId['user_roles->mf_users'].cardinality).toBe('N:1');
    expect(byId['user_recharge_daily->mf_users'].cardinality).toBe('1:N');
    const one = buildJoinGraph([
      cube('a', { joins: [join('b', '`${CUBE}.k = ${b}.k`', 'hasOne')] }),
      cube('b'),
    ]);
    expect(one.edges[0].cardinality).toBe('1:1');
    const unknown = buildJoinGraph([
      cube('a', { joins: [{ name: 'b', sql: '`${CUBE}.k = ${b}.k`' }] }),
      cube('b'),
    ]);
    expect(unknown.edges[0].cardinality).toBe('');
  });

  it('dedups edges per unordered pair, keeping the first direction', () => {
    const g = buildJoinGraph([
      cube('a', { joins: [join('b', '`${CUBE}.k = ${b}.k`')] }),
      cube('b', { joins: [join('a', '`${CUBE}.k = ${a}.k`', 'hasMany')] }),
    ]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].source).toBe('a');
    expect(g.edges[0].cardinality).toBe('N:1');
  });

  it('lints isolated cubes and missing join targets', () => {
    const g = buildJoinGraph(cfmFixture());
    expect(g.lints.isolated).toContain('game_key_metrics');
    // A join to an absent target does not count as connectivity.
    expect(g.lints.isolated).toContain('etl_prop_flow');
    expect(g.lints.isolated).not.toContain('mf_users');
    expect(g.lints.missingTarget).toEqual([
      { source: 'etl_prop_flow', target: 'std_ghost_bridge' },
    ]);
    const missingEdge = g.edges.find((e) => e.target === 'std_ghost_bridge');
    expect(missingEdge?.missingTarget).toBe(true);
  });

  it('produces identical clusters and lints on a prefix workspace', () => {
    const bare = buildJoinGraph(cfmFixture());
    const prefixed = buildJoinGraph(prefixedFixture(), 'cfm_vn');
    const strip = (n: string) => n.replace(/^cfm_vn_/, '');
    expect(
      Object.fromEntries(prefixed.nodes.map((n) => [strip(n.name), n.cluster])),
    ).toEqual(Object.fromEntries(bare.nodes.map((n) => [n.name, n.cluster])));
    expect(prefixed.lints.isolated.map(strip)).toEqual(bare.lints.isolated);
  });

  it('keeps key labels and edge count faithful to the fixture', () => {
    const g = buildJoinGraph(cfmFixture());
    expect(g.edges).toHaveLength(5);
    const login = g.edges.find((e) => e.source === 'etl_login');
    expect(login?.keyLabel).toBe('vopenid → user_id');
  });
});

describe('viewComposition', () => {
  it('derives composed cubes from distinct aliasMember prefixes', () => {
    const comp = viewComposition(cfmFixture());
    expect([...(comp.get('user_360') ?? [])].sort()).toEqual([
      'mf_users',
      'user_recharge_daily',
      'user_roles',
    ]);
  });

  it('ignores non-view cubes and members without aliasMember', () => {
    const comp = viewComposition([
      cube('mf_users'),
      { ...cube('empty_view', { type: 'view' }), dimensions: [{ name: 'empty_view.x' }] },
    ]);
    expect(comp.has('mf_users')).toBe(false);
    expect(comp.get('empty_view')?.size).toBe(0);
  });
});
