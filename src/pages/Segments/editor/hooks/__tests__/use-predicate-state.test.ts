import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePredicateState, emptyRoot, emptyLeaf, isTreeValid } from '../use-predicate-state';

describe('usePredicateState', () => {
  it('starts with an empty AND root', () => {
    const { result } = renderHook(() => usePredicateState());
    expect(result.current.tree.kind).toBe('group');
    expect(result.current.tree).toMatchObject({ op: 'AND' });
  });

  it('adds a leaf at root', () => {
    const { result } = renderHook(() => usePredicateState());
    act(() => result.current.addLeaf([]));
    if (result.current.tree.kind !== 'group') throw new Error('expected group root');
    expect(result.current.tree.children).toHaveLength(1);
  });

  it('toggles AND ↔ OR', () => {
    const { result } = renderHook(() => usePredicateState());
    act(() => result.current.toggleConj([]));
    if (result.current.tree.kind !== 'group') throw new Error('expected group root');
    expect(result.current.tree.op).toBe('OR');
    act(() => result.current.toggleConj([]));
    if (result.current.tree.kind !== 'group') throw new Error('expected group root');
    expect(result.current.tree.op).toBe('AND');
  });

  it('sets leaf member, op, values immutably', () => {
    const { result } = renderHook(() => usePredicateState());
    act(() => result.current.addLeaf([]));
    act(() => result.current.setLeafMember([0], 'mf_users.country', 'string'));
    act(() => result.current.setLeafOp([0], 'equals'));
    act(() => result.current.setLeafValues([0], ['VN']));
    if (result.current.tree.kind !== 'group') throw new Error();
    const leaf = result.current.tree.children[0];
    if (leaf.kind !== 'leaf') throw new Error();
    expect(leaf).toMatchObject({
      member: 'mf_users.country',
      type: 'string',
      op: 'equals',
      values: ['VN'],
    });
  });

  it('removes a node by path', () => {
    const { result } = renderHook(() => usePredicateState());
    act(() => result.current.addLeaf([]));
    act(() => result.current.addLeaf([]));
    act(() => result.current.removeNode([0]));
    if (result.current.tree.kind !== 'group') throw new Error();
    expect(result.current.tree.children).toHaveLength(1);
  });

  it('adds nested groups', () => {
    const { result } = renderHook(() => usePredicateState());
    act(() => result.current.addGroup([]));
    if (result.current.tree.kind !== 'group') throw new Error();
    const child = result.current.tree.children[0];
    expect(child.kind).toBe('group');
  });
});

describe('isTreeValid', () => {
  it('rejects empty root group', () => {
    expect(isTreeValid(emptyRoot())).toBe(false);
  });
  it('rejects leaf with no member', () => {
    expect(isTreeValid({ kind: 'group', id: 'g', op: 'AND', children: [emptyLeaf()] })).toBe(false);
  });
  it('accepts leaf with set/notSet (no values needed)', () => {
    expect(isTreeValid({
      kind: 'group', id: 'g', op: 'AND',
      children: [{ kind: 'leaf', id: 'l', member: 'mf_users.country', type: 'string', op: 'set', values: [] }],
    })).toBe(true);
  });
  it('rejects leaf with empty values', () => {
    expect(isTreeValid({
      kind: 'group', id: 'g', op: 'AND',
      children: [{ kind: 'leaf', id: 'l', member: 'mf_users.country', type: 'string', op: 'equals', values: [] }],
    })).toBe(false);
  });
  it('accepts leaf with non-empty values', () => {
    expect(isTreeValid({
      kind: 'group', id: 'g', op: 'AND',
      children: [{ kind: 'leaf', id: 'l', member: 'mf_users.country', type: 'string', op: 'equals', values: ['VN'] }],
    })).toBe(true);
  });
});
