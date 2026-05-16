import { describe, it, expect } from 'vitest';
import {
  emptyTree,
  makeLeaf,
  makeGroup,
  addLeaf,
  removeNode,
  setGroupOp,
  updateLeaf,
  countLeaves,
  isEmpty,
} from '../builders';

describe('builders', () => {
  it('emptyTree returns an AND group with no children', () => {
    const t = emptyTree();
    expect(t.kind).toBe('group');
    expect(t.op).toBe('AND');
    expect(t.children).toEqual([]);
    expect(isEmpty(t)).toBe(true);
  });

  it('addLeaf appends a leaf to the given parent', () => {
    const t = emptyTree();
    const l = makeLeaf('mf_users.tier', 'string', '=', ['premium']);
    const t2 = addLeaf(t, t.id, l);
    expect(t2.children).toHaveLength(1);
    expect(t2.children[0]).toEqual(expect.objectContaining({ kind: 'leaf' }));
    expect(t).not.toBe(t2); // immutable
  });

  it('removeNode drops the matching leaf', () => {
    const t = emptyTree();
    const l = makeLeaf('mf_users.tier', 'string', '=', ['premium']);
    const t2 = addLeaf(t, t.id, l);
    const t3 = removeNode(t2, l.id);
    expect(t3.children).toHaveLength(0);
  });

  it('setGroupOp flips AND <-> OR', () => {
    const t = emptyTree();
    const t2 = setGroupOp(t, t.id, 'OR');
    expect(t2.op).toBe('OR');
  });

  it('updateLeaf patches op and values', () => {
    const t = emptyTree();
    const l = makeLeaf('mf_users.tier', 'string', '=', ['premium']);
    const t2 = addLeaf(t, t.id, l);
    const t3 = updateLeaf(t2, l.id, { op: 'IN', values: ['premium', 'whale'] });
    const updated = t3.children[0] as any;
    expect(updated.op).toBe('IN');
    expect(updated.values).toEqual(['premium', 'whale']);
  });

  it('countLeaves counts across nested groups', () => {
    const inner = makeGroup('OR', [
      makeLeaf('mf_users.country', 'string', '=', ['VN']),
      makeLeaf('mf_users.country', 'string', '=', ['TH']),
    ]);
    const root = makeGroup('AND', [
      makeLeaf('mf_users.tier', 'string', '=', ['premium']),
      inner,
    ]);
    expect(countLeaves(root)).toBe(3);
  });
});
