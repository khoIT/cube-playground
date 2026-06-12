import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPlaygroundDeeplink,
  buildDefinitionDeeplink,
  mergeUidFilter,
  readDeeplinkFromStorage,
  readEditContextFromStorage,
  clearDeeplinkStorage,
} from '../playground-deeplink';
import type { DefinitionDeeplinkInput } from '../playground-deeplink';
import type { PredicateNode } from '../../types/segment-api';

beforeEach(() => {
  sessionStorage.clear();
});

// ── legacy helpers ────────────────────────────────────────────────────────

describe('mergeUidFilter', () => {
  it('appends an IN filter on top of an existing query', () => {
    const out = mergeUidFilter(
      { measures: ['mf_users.count'] },
      'mf_users.user_id',
      ['u1', 'u2'],
    );
    expect(out.filters).toEqual([
      { member: 'mf_users.user_id', operator: 'in', values: ['u1', 'u2'] },
    ]);
    expect(out.measures).toEqual(['mf_users.count']);
  });
});

describe('buildPlaygroundDeeplink', () => {
  it('inlines small uid lists in the URL', () => {
    const out = buildPlaygroundDeeplink({
      segmentId: 'seg1',
      segmentName: 'tiny',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids: ['u1', 'u2', 'u3'],
    });
    expect(out.via).toBe('inline');
    expect(out.url).toContain('#/build?query=');
  });

  it('falls back to sessionStorage handoff for huge uid lists', () => {
    const uids = Array.from({ length: 1500 }, (_, i) => `uid_${i}`);
    const out = buildPlaygroundDeeplink({
      segmentId: 'seg-big',
      segmentName: 'huge',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids,
    });
    expect(out.via).toBe('session-storage');
    expect(out.url).toContain('from-segment=seg-big');

    const restored = readDeeplinkFromStorage('seg-big');
    expect(restored).not.toBeNull();
    expect(((restored as { filters: Array<{ values: string[] }> }).filters[0].values)).toHaveLength(1500);
  });

  it('clearDeeplinkStorage removes the persisted entry', () => {
    sessionStorage.setItem('gds-cube:pending-deeplink:seg-x', 'whatever');
    clearDeeplinkStorage('seg-x');
    expect(sessionStorage.getItem('gds-cube:pending-deeplink:seg-x')).toBeNull();
  });
});

// ── buildDefinitionDeeplink ───────────────────────────────────────────────

function makeInput(
  overrides: Partial<DefinitionDeeplinkInput> & {
    segmentOverrides?: Partial<DefinitionDeeplinkInput['segment']>;
  } = {},
): DefinitionDeeplinkInput {
  const tree: PredicateNode = {
    kind: 'group',
    id: 'root',
    op: 'AND',
    children: [
      {
        kind: 'leaf',
        id: 'l1',
        member: 'mf_users.os_platform',
        type: 'string',
        op: 'equals',
        values: ['pc'],
      },
    ],
  };
  const { segmentOverrides, ...rest } = overrides;
  return {
    segment: {
      id: 'seg-abc',
      name: 'PC players',
      type: 'predicate',
      cube: 'mf_users',
      predicate_tree: tree,
      cube_query_json: JSON.stringify({ segments: ['mf_users.last_30d'] }),
      uid_list: [],
      game_id: 'jus_vn',
      ...segmentOverrides,
    },
    identityDim: 'mf_users.user_id',
    cubeSegments: ['mf_users.last_30d'],
    gameId: 'jus_vn',
    ...rest,
  };
}

describe('buildDefinitionDeeplink — predicate segment inline', () => {
  it('inlines the definition query for a small predicate segment', () => {
    const result = buildDefinitionDeeplink(makeInput());
    if ('disabled' in result) throw new Error('Expected deeplink result');

    expect(result.via).toBe('inline');
    expect(result.url).toContain('#/build?query=');
    expect(result.url).toContain('edit-segment=seg-abc');
  });

  it('decoded query contains dimensions (identityDim), filters, segments, limit — and NO guessed measure', () => {
    const result = buildDefinitionDeeplink(makeInput());
    if ('disabled' in result) throw new Error('Expected deeplink result');

    const queryMatch = result.url.match(/\?query=([^&]+)/);
    expect(queryMatch).not.toBeNull();
    const q = JSON.parse(decodeURIComponent(queryMatch![1])) as Record<string, unknown>;

    // Count-measure names vary per cube model (rows/events/transactions);
    // a synthesized `<cube>.count` would error at playground boot.
    expect(q.measures).toEqual([]);
    expect((q.dimensions as string[]).includes('mf_users.user_id')).toBe(true);
    expect(q.segments).toEqual(['mf_users.last_30d']);
    expect(q.limit).toBe(100);
    // Filter from the tree leaf
    expect((q.filters as Array<{ member: string }>).some((f) => f.member === 'mf_users.os_platform')).toBe(true);
  });

  it('preserves relative date literals from the tree (not expanded tuples)', () => {
    const treeWithDate: PredicateNode = {
      kind: 'group',
      id: 'root',
      op: 'AND',
      children: [
        {
          kind: 'leaf',
          id: 'tl',
          member: 'active_daily.event_date',
          type: 'time',
          op: 'inDateRange',
          values: ['last 30 days'],
        },
      ],
    };
    const result = buildDefinitionDeeplink(
      makeInput({ segmentOverrides: { predicate_tree: treeWithDate } }),
    );
    if ('disabled' in result) throw new Error('Expected deeplink result');

    const queryMatch = result.url.match(/\?query=([^&]+)/);
    const q = JSON.parse(decodeURIComponent(queryMatch![1])) as Record<string, unknown>;
    const tds = q.timeDimensions as Array<{ dimension: string; dateRange: string }>;
    expect(tds[0].dateRange).toBe('last 30 days');
  });

  it('editContext records gameId and echoFilters with game-scoping entry', () => {
    const result = buildDefinitionDeeplink(makeInput());
    if ('disabled' in result) throw new Error('Expected deeplink result');

    expect(result.editContext.segmentId).toBe('seg-abc');
    expect(result.editContext.segmentName).toBe('PC players');
    expect(result.editContext.gameId).toBe('jus_vn');
    expect(result.editContext.returnedFrom).toBe('segment-detail');
    // Echo filter for game-scoping injection — at least the primary cube
    const gameEcho = result.editContext.echoFilters.find(
      (f) => f.member === 'mf_users.gameId',
    );
    expect(gameEcho).toBeDefined();
    expect(gameEcho?.values).toEqual(['jus_vn']);
  });

  it('editContext is always written to sessionStorage on the inline path', () => {
    // buildDefinitionDeeplink now always persists the edit context so
    // QueryBuilderContainer reads the full context (not a minimal stub).
    sessionStorage.clear();
    const result = buildDefinitionDeeplink(makeInput());
    if ('disabled' in result) throw new Error('Expected deeplink result');
    expect(result.via).toBe('inline');

    const stored = readEditContextFromStorage('seg-abc');
    expect(stored).not.toBeNull();
    expect(stored?.segmentId).toBe('seg-abc');
    expect(stored?.gameId).toBe('jus_vn');
    // Echo filters are recorded so save-back can strip game-scoping injections
    expect(stored?.echoFilters.length).toBeGreaterThan(0);
  });

  it('echoFilters covers every cube referenced in the definition query (multi-cube guard)', () => {
    // When identityDim is on a different cube than the segment cube, both cubes
    // get a gameId echo so applyGameFilter injections from both are stripped.
    const treeWithActiveDailyTimeDim: PredicateNode = {
      kind: 'group', id: 'root', op: 'AND',
      children: [{
        kind: 'leaf', id: 'tl',
        member: 'active_daily.event_date', type: 'time',
        op: 'inDateRange', values: ['last 30 days'],
      }],
    };
    const result = buildDefinitionDeeplink(makeInput({
      identityDim: 'mf_users.user_id',        // identityDim cube: mf_users
      segmentOverrides: {
        cube: 'active_daily',                   // segment cube: active_daily
        predicate_tree: treeWithActiveDailyTimeDim,
      },
    }));
    if ('disabled' in result) throw new Error('Expected deeplink result');

    const echoMembers = result.editContext.echoFilters.map((f) => f.member);
    // Both cubes referenced in the query must have a gameId echo recorded
    expect(echoMembers).toContain('mf_users.gameId');
    expect(echoMembers).toContain('active_daily.gameId');
  });
});

describe('buildDefinitionDeeplink — manual segment small uid list inlines', () => {
  it('inlines a small uid list for a manual segment', () => {
    const result = buildDefinitionDeeplink(
      makeInput({
        segmentOverrides: {
          type: 'manual',
          predicate_tree: null,
          uid_list: ['u1', 'u2', 'u3'],
        },
        cubeSegments: [],
      }),
    );
    if ('disabled' in result) throw new Error('Expected deeplink result');

    expect(result.via).toBe('inline');
    const queryMatch = result.url.match(/\?query=([^&]+)/);
    const q = JSON.parse(decodeURIComponent(queryMatch![1])) as Record<string, unknown>;
    const filters = q.filters as Array<{ member: string; operator: string; values: string[] }>;
    expect(filters[0].operator).toBe('in');
    expect(filters[0].values).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('buildDefinitionDeeplink — manual segment oversize → disabled', () => {
  it('returns {disabled, reason} when a manual segment uid list overflows the URL', () => {
    const uids = Array.from({ length: 2000 }, (_, i) => `uid_very_long_${i}`);
    const result = buildDefinitionDeeplink(
      makeInput({
        segmentOverrides: {
          type: 'manual',
          predicate_tree: null,
          uid_list: uids,
        },
        cubeSegments: [],
      }),
    );
    expect('disabled' in result).toBe(true);
    if (!('disabled' in result)) throw new Error('should be disabled');
    expect(result.disabled).toBe(true);
    expect(result.reason).toMatch(/convert to live/i);
  });
});

describe('buildDefinitionDeeplink — oversize predicate → sessionStorage', () => {
  it('stashes query and editContext in sessionStorage when URL exceeds 8000 chars', () => {
    // Create a predicate tree with enough leaves to overflow the URL
    const manyLeaves: PredicateNode[] = Array.from({ length: 120 }, (_, i) => ({
      kind: 'leaf' as const,
      id: `l${i}`,
      member: `mf_users.field_with_a_very_long_name_${i}`,
      type: 'string' as const,
      op: 'equals' as const,
      values: [`value_that_is_quite_long_${i}`],
    }));
    const bigTree: PredicateNode = { kind: 'group', id: 'root', op: 'AND', children: manyLeaves };

    const result = buildDefinitionDeeplink(
      makeInput({ segmentOverrides: { predicate_tree: bigTree } }),
    );
    if ('disabled' in result) throw new Error('Expected deeplink result');

    expect(result.via).toBe('session-storage');
    expect(result.url).toContain('from-segment=seg-abc');
    expect(result.url).toContain('edit-segment=seg-abc');

    // Query stashed
    const storedQuery = readDeeplinkFromStorage('seg-abc');
    expect(storedQuery).not.toBeNull();
    expect((storedQuery as any).filters).toHaveLength(120);

    // Edit context stashed
    const storedCtx = readEditContextFromStorage('seg-abc');
    expect(storedCtx).not.toBeNull();
    expect(storedCtx?.segmentId).toBe('seg-abc');
    expect(storedCtx?.gameId).toBe('jus_vn');
  });
});
