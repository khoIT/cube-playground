import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveDrift } from '../src/services/drift-resolver.js';
import * as metaCache from '../src/services/meta-cache.js';
import * as cubeClient from '../src/services/cube-client.js';

const tree = {
  kind: 'group',
  id: 'g',
  op: 'AND',
  children: [
    { kind: 'leaf', id: 'l1', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] },
    { kind: 'leaf', id: 'l2', member: 'mf_users.total_spend', type: 'number', op: 'gte', values: [100] },
  ],
};

describe('resolveDrift', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns drifted=false when meta version matches', async () => {
    vi.spyOn(metaCache, 'getVersion').mockResolvedValue({ hash: 'abc', fetchedAt: Date.now() });
    const out = await resolveDrift({
      predicate_tree_json: JSON.stringify(tree),
      predicate_meta_version: 'abc',
    });
    expect(out.drifted).toBe(false);
  });

  it('rehydrates when meta drifted but all members still exist', async () => {
    vi.spyOn(metaCache, 'getVersion').mockResolvedValue({ hash: 'new', fetchedAt: Date.now() });
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue({
      cubes: [{
        name: 'mf_users',
        dimensions: [
          { name: 'mf_users.country' },
          { name: 'mf_users.total_spend' },
        ],
      }],
    } as never);
    const out = await resolveDrift({
      predicate_tree_json: JSON.stringify(tree),
      predicate_meta_version: 'old',
    });
    expect(out.drifted).toBe(true);
    if (out.drifted && out.rehydrated) {
      expect(out.newCubeQuery.filters).toHaveLength(2);
      expect(out.newMetaVersion).toBe('new');
    } else {
      throw new Error('expected rehydrated=true');
    }
  });

  it('returns broken=true when a referenced member disappeared', async () => {
    vi.spyOn(metaCache, 'getVersion').mockResolvedValue({ hash: 'new', fetchedAt: Date.now() });
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue({
      cubes: [{
        name: 'mf_users',
        dimensions: [{ name: 'mf_users.country' }],
      }],
    } as never);
    const out = await resolveDrift({
      predicate_tree_json: JSON.stringify(tree),
      predicate_meta_version: 'old',
    });
    expect(out.drifted).toBe(true);
    if (out.drifted && !out.rehydrated) {
      expect(out.missingMembers).toContain('mf_users.total_spend');
    } else {
      throw new Error('expected rehydrated=false');
    }
  });
});
