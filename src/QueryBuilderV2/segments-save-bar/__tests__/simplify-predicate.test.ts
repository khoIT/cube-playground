/**
 * Tests for simplify-predicate — collapses build-process redundancy in a
 * predicate tree into a concise, logically-equivalent form.
 */

import { describe, it, expect } from 'vitest';
import { simplifyPredicate } from '../simplify-predicate';
import type { GroupNode, LeafNode, PredicateNode } from '../../../types/segment-api';

function leaf(member: string, op: LeafNode['op'], values: unknown[]): LeafNode {
  return { kind: 'leaf', id: `${member}-${op}`, member, type: 'string', op, values };
}
function group(op: 'AND' | 'OR', children: PredicateNode[]): GroupNode {
  return { kind: 'group', id: `${op}-${children.length}`, op, children };
}

describe('simplifyPredicate', () => {
  it('collapses the query-builder slice shape into a flat AND', () => {
    // Mirrors the screenshot: an outer month dateRange AND-ed with a
    // single-row OR(AND(os_platform=iOS, recharge_date in W20)).
    const raw = group('AND', [
      leaf('recharge.recharge_date', 'inDateRange', [['2026-05-01', '2026-06-01']]),
      group('OR', [
        group('AND', [
          leaf('recharge.os_platform', 'equals', ['iOS']),
          leaf('recharge.recharge_date', 'inDateRange', [['2026-05-11', '2026-05-17']]),
        ]),
      ]),
    ]);
    const out = simplifyPredicate(raw);
    expect(out.op).toBe('AND');
    // OR(single) unwrapped, inner AND flattened, two recharge_date windows
    // intersected to the tighter W20 range → exactly two leaves.
    expect(out.children).toHaveLength(2);
    const platform = out.children.find(
      (c) => c.kind === 'leaf' && c.member === 'recharge.os_platform',
    ) as LeafNode;
    const date = out.children.find(
      (c) => c.kind === 'leaf' && c.member === 'recharge.recharge_date',
    ) as LeafNode;
    expect(platform.values).toEqual(['iOS']);
    expect(date.values).toEqual([['2026-05-11', '2026-05-17']]);
  });

  it('flattens nested same-op groups', () => {
    const raw = group('AND', [
      leaf('a', 'equals', ['1']),
      group('AND', [leaf('b', 'equals', ['2']), leaf('c', 'equals', ['3'])]),
    ]);
    const out = simplifyPredicate(raw);
    expect(out.children).toHaveLength(3);
  });

  it('dedupes structurally-identical sibling leaves', () => {
    const raw = group('AND', [
      leaf('a', 'equals', ['1']),
      leaf('a', 'equals', ['1']),
      leaf('b', 'equals', ['2']),
    ]);
    const out = simplifyPredicate(raw);
    expect(out.children).toHaveLength(2);
  });

  it('keeps disjoint date windows rather than producing an invalid range', () => {
    const raw = group('AND', [
      leaf('d', 'inDateRange', [['2026-01-01', '2026-01-31']]),
      leaf('d', 'inDateRange', [['2026-03-01', '2026-03-31']]),
    ]);
    const out = simplifyPredicate(raw);
    expect(out.children).toHaveLength(2);
  });

  it('does not merge relative date literals', () => {
    const raw = group('AND', [
      leaf('d', 'inDateRange', ['this week']),
      leaf('d', 'inDateRange', [['2026-05-11', '2026-05-17']]),
    ]);
    const out = simplifyPredicate(raw);
    expect(out.children).toHaveLength(2);
  });

  it('wraps a collapsed single leaf back into a root AND group', () => {
    const raw = group('AND', [group('OR', [leaf('a', 'equals', ['1'])])]);
    const out = simplifyPredicate(raw);
    expect(out.kind).toBe('group');
    expect(out.op).toBe('AND');
    expect(out.children).toHaveLength(1);
    expect(out.children[0].kind).toBe('leaf');
  });

  it('returns an empty AND group for an empty tree', () => {
    const out = simplifyPredicate(group('AND', []));
    expect(out.op).toBe('AND');
    expect(out.children).toEqual([]);
  });
});
