/**
 * Unit tests for computeSegmentSize — the dry-run cohort count behind the chat
 * propose card's pre-confirm size. Cube/Trino are injected so these are pure.
 */

import { describe, it, expect, vi } from 'vitest';
import { computeSegmentSize, SegmentSizeError } from '../src/services/compute-segment-size.js';
import type { PredicateNode } from '../src/types/predicate-tree.js';

const dimTree: PredicateNode = {
  kind: 'group',
  id: 'g1',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
  ],
};

const identityOk = vi.fn(async () => ({ field: 'mf_users.user_id', reason: null as null }));

describe('computeSegmentSize', () => {
  it('returns the Cube total and projects identity dim + total:true', async () => {
    const loadFn = vi.fn(async () => ({ total: 1234 }));
    const res = await computeSegmentSize(
      { cube: 'mf_users', gameId: 'cfm_vn', predicateTree: dimTree, tokenOverride: 'tok' },
      { loadFn, resolveIdentity: identityOk as never },
    );
    expect(res.count).toBe(1234);
    expect(res.identityField).toBe('mf_users.user_id');
    const query = loadFn.mock.calls[0][0] as Record<string, unknown>;
    expect(query.total).toBe(true);
    expect(query.dimensions).toEqual(['mf_users.user_id']);
    expect(Array.isArray(query.filters)).toBe(true);
  });

  it('reads the results[0].total fallback shape', async () => {
    const loadFn = vi.fn(async () => ({ results: [{ total: 88 }] }));
    const res = await computeSegmentSize(
      { cube: 'mf_users', gameId: 'cfm_vn', predicateTree: dimTree },
      { loadFn, resolveIdentity: identityOk as never },
    );
    expect(res.count).toBe(88);
  });

  it('resolves percentile cutoffs before translating when a percentile leaf is present', async () => {
    const pctTree: PredicateNode = {
      kind: 'group',
      id: 'g2',
      op: 'AND',
      children: [
        {
          kind: 'leaf',
          id: 'p1',
          member: 'mf_users.ltv_vnd',
          type: 'number',
          op: 'percentileGte',
          values: [{ p: 75, over: { table: 't', column: 'ltv_vnd' } }],
        } as never,
      ],
    };
    const loadFn = vi.fn(async () => ({ total: 10 }));
    const resolveCutoffs = vi.fn(async () => new Map([['p1', 500000]]));
    await computeSegmentSize(
      { cube: 'mf_users', gameId: 'cfm_vn', predicateTree: pctTree },
      { loadFn, resolveIdentity: identityOk as never, resolveCutoffs: resolveCutoffs as never },
    );
    expect(resolveCutoffs).toHaveBeenCalledOnce();
  });

  it('does NOT resolve cutoffs for a plain dimension tree', async () => {
    const loadFn = vi.fn(async () => ({ total: 1 }));
    const resolveCutoffs = vi.fn(async () => new Map());
    await computeSegmentSize(
      { cube: 'mf_users', gameId: 'cfm_vn', predicateTree: dimTree },
      { loadFn, resolveIdentity: identityOk as never, resolveCutoffs: resolveCutoffs as never },
    );
    expect(resolveCutoffs).not.toHaveBeenCalled();
  });

  it('throws SegmentSizeError(uncohortable) when the cube has no identity field', async () => {
    const loadFn = vi.fn();
    const resolveIdentity = vi.fn(async () => ({ field: null, reason: 'no-uid-dim' as const }));
    await expect(
      computeSegmentSize(
        { cube: 'weird_cube', gameId: 'cfm_vn', predicateTree: dimTree },
        { loadFn, resolveIdentity: resolveIdentity as never },
      ),
    ).rejects.toMatchObject({ name: 'SegmentSizeError', kind: 'uncohortable' });
    expect(loadFn).not.toHaveBeenCalled();
  });

  it('throws SegmentSizeError(introspection-failed) on a transient introspection miss', async () => {
    const resolveIdentity = vi.fn(async () => ({ field: null, reason: 'introspection-failed' as const }));
    await expect(
      computeSegmentSize(
        { cube: 'mf_users', gameId: 'cfm_vn', predicateTree: dimTree },
        { loadFn: vi.fn(), resolveIdentity: resolveIdentity as never },
      ),
    ).rejects.toBeInstanceOf(SegmentSizeError);
  });
});
