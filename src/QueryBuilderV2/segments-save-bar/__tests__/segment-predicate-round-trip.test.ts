/**
 * Round-trip property test: segment predicate tree → deeplink query fragment
 * → save-back predicate tree.
 *
 * Forward leg:  treeToQueryFragment  (predicate-tree-to-cube-query.ts)
 * Reverse leg:  buildPredicateFromRows (build-predicate-from-rows.ts)
 *
 * Known lossy edges (by design, not bugs):
 *   - Node ids differ between trees (genId-generated on every call) — compare
 *     structure only.
 *   - Numeric leaf values are stringified by treeToQueryFragment (.map(String))
 *     and come back as strings; inferLeafType returns 'string' for "100".
 *     Predicates authored in the editor store type='number' but after a
 *     playground round-trip the type degrades to 'string'. This is acceptable
 *     because the value is preserved and the server re-infers type from the
 *     Cube meta during refresh.
 *   - Array [from, to] dateRange stored as values:[from, to] (two strings) in
 *     treeToQueryFragment produces dateRange:[from,to] on the Query. The reverse
 *     leg (timeDimensionToLeaf) wraps it as values:[[from,to]] — one nested
 *     array element. These are compared by their semantic content below.
 *
 * Operators blocked by the translatability gate (notInDateRange, notContains,
 * etc.) are NOT tested here — they are covered by translatability-gate.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import { treeToQueryFragment } from '../../../pages/Segments/predicate-tree-to-cube-query';
import { buildPredicateFromRows } from '../build-predicate-from-rows';
import { stripEchoFilters } from '../echo-filter-stripper';
import type {
  GroupNode,
  LeafNode,
  PredicateNode,
} from '../../../types/segment-api';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip ids; sort children for order-agnostic structural comparison. */
function normalise(node: PredicateNode): unknown {
  if (node.kind === 'leaf') {
    const { id: _id, ...rest } = node;
    return rest;
  }
  return {
    kind: node.kind,
    op: node.op,
    children: node.children
      .map(normalise)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

/** Build a minimal Query from a predicate tree and run it through the reverse leg. */
function roundTrip(tree: GroupNode): GroupNode {
  const fragment = treeToQueryFragment(tree);
  const query: Query = {
    measures: ['mf_users.count'],
    dimensions: ['mf_users.user_id'],
    filters: fragment.filters as Query['filters'],
    timeDimensions: fragment.timeDimensions as Query['timeDimensions'],
    limit: 100,
  };
  return buildPredicateFromRows(query, [], 'mf_users.user_id');
}

// ── Source trees (use string values to avoid type-coercion lossy edge) ────────

const leafCountry: LeafNode = {
  kind: 'leaf', id: 'l1',
  member: 'mf_users.country',
  type: 'string', op: 'equals', values: ['VN'],
};

// Numeric stored as string — avoids the .map(String) type-coercion edge.
const leafSpend: LeafNode = {
  kind: 'leaf', id: 'l2',
  member: 'mf_users.total_spend',
  type: 'string', op: 'gte', values: ['100'],
};

const leafDateRange: LeafNode = {
  kind: 'leaf', id: 'l3',
  member: 'active_daily.log_date',
  type: 'time', op: 'inDateRange', values: ['last 30 days'],
};

const leafSet: LeafNode = {
  kind: 'leaf', id: 'l4',
  member: 'mf_users.email',
  type: 'string', op: 'set', values: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('segment predicate round-trip', () => {
  it('round-trips a simple AND(equals, gte) tree', () => {
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafCountry, leafSpend],
    };
    expect(normalise(roundTrip(tree))).toEqual(normalise(tree));
  });

  it('round-trips an AND tree with a relative dateRange', () => {
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafCountry, leafSpend, leafDateRange],
    };
    expect(normalise(roundTrip(tree))).toEqual(normalise(tree));
  });

  it('round-trips a single equals leaf', () => {
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafCountry],
    };
    expect(normalise(roundTrip(tree))).toEqual(normalise(tree));
  });

  it('round-trips a set (unary) operator with no values', () => {
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafSet],
    };
    expect(normalise(roundTrip(tree))).toEqual(normalise(tree));
  });

  it('array [from, to] dateRange: reverse leg wraps it as values:[[from, to]]', () => {
    // treeToQueryFragment sees values:['2025-01-01','2025-01-31'] (2 elements)
    // → dateRange: ['2025-01-01','2025-01-31'] on the Cube Query.
    // timeDimensionToLeaf stores td.dateRange directly in values[0]
    // → values: [['2025-01-01','2025-01-31']].
    // This is the correct and tested behaviour of buildPredicateFromRows.
    const sourceLeaf: LeafNode = {
      kind: 'leaf', id: 'l5',
      member: 'active_daily.log_date',
      type: 'time', op: 'inDateRange',
      values: ['2025-01-01', '2025-01-31'],  // two-element forward form
    };
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [sourceLeaf],
    };
    const back = roundTrip(tree);
    const backLeaf = back.children.find(
      (c): c is LeafNode => c.kind === 'leaf' && c.member === 'active_daily.log_date',
    );
    expect(backLeaf).toBeDefined();
    expect(backLeaf!.op).toBe('inDateRange');
    // The reverse leg wraps the array dateRange as a nested array.
    expect(backLeaf!.values).toEqual([['2025-01-01', '2025-01-31']]);
  });

  it('multi-value equals is promoted to "in" leaf after round-trip', () => {
    // treeToQueryFragment emits { operator: 'equals', values: ['VN','ID'] }.
    // cubeFilterToNode promotes to op:'in' for multi-value equals.
    const inLeaf: LeafNode = {
      kind: 'leaf', id: 'l6',
      member: 'mf_users.country',
      type: 'string', op: 'equals',  // source op: equals (multi-value)
      values: ['VN', 'ID'],
    };
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND', children: [inLeaf],
    };
    const back = roundTrip(tree);
    const backLeaf = back.children.find(
      (c): c is LeafNode => c.kind === 'leaf' && c.member === 'mf_users.country',
    );
    expect(backLeaf).toBeDefined();
    // cubeFilterToNode promotes multi-value equals → 'in'
    expect(backLeaf!.op).toBe('in');
    expect(backLeaf!.values).toEqual(['VN', 'ID']);
  });

  it('in-leaf round-trips via treeToQueryFragment → equals emission → in promotion', () => {
    // A leaf with op:'in' must produce Cube operator 'equals' (TREE_TO_CUBE_OP
    // maps in→equals). buildPredicateFromRows then re-promotes multi-value equals
    // → 'in'. Net: the round-trip is lossless.
    const inLeaf: LeafNode = {
      kind: 'leaf', id: 'l7',
      member: 'mf_users.country',
      type: 'string', op: 'in',
      values: ['VN', 'SG', 'TH'],
    };
    const tree: GroupNode = { kind: 'group', id: 'g', op: 'AND', children: [inLeaf] };
    const back = roundTrip(tree);
    const backLeaf = back.children.find(
      (c): c is LeafNode => c.kind === 'leaf' && c.member === 'mf_users.country',
    );
    expect(backLeaf).toBeDefined();
    expect(backLeaf!.op).toBe('in');
    expect(backLeaf!.values).toEqual(['VN', 'SG', 'TH']);
  });

  it('OR(AND(a,b), c) emits faithful nested structure and round-trips without widening', () => {
    // Critical regression guard: OR(AND(a,b),c) must NOT flatten to or(a,b,c).
    // treeToQueryFragment must emit { or: [{ and:[a,b] }, c] }.
    // buildPredicateFromRows consumes logical {and}/{or} groups recursively,
    // so the nested shape is preserved end-to-end.
    const a = leafCountry;
    const b = leafSpend;
    const c: LeafNode = {
      kind: 'leaf', id: 'l8',
      member: 'mf_users.os_platform',
      type: 'string', op: 'equals', values: ['pc'],
    };
    // Build OR(AND(a,b), c)
    const andGroup: GroupNode = { kind: 'group', id: 'g-and', op: 'AND', children: [a, b] };
    const tree: GroupNode = { kind: 'group', id: 'g-or', op: 'OR', children: [andGroup, c] };

    const fragment = treeToQueryFragment(tree);

    // Forward leg: must emit exactly { or: [{ and: [...] }, plain-leaf] }
    expect(fragment.filters).toHaveLength(1);
    const emittedOr = (fragment.filters[0] as any).or;
    expect(Array.isArray(emittedOr)).toBe(true);
    expect(emittedOr).toHaveLength(2);
    expect(emittedOr[0].and).toBeDefined();  // AND group preserved
    expect(emittedOr[0].and).toHaveLength(2);

    // Reverse leg: consume it back via buildPredicateFromRows
    const query: Query = {
      measures: ['mf_users.count'],
      dimensions: ['mf_users.user_id'],
      filters: fragment.filters as Query['filters'],
      timeDimensions: [],
    };
    const back = buildPredicateFromRows(query, [], 'mf_users.user_id');

    // simplifyPredicate collapses a single-child AND wrapper into the child
    // (rule 5), so the root here is the OR group itself.
    // What matters is that the OR structure — with its nested AND — is preserved.
    // Find the OR node (it may be the root or under a root AND).
    const orNode: GroupNode = back.op === 'OR'
      ? back
      : (back.children[0] as GroupNode);
    expect(orNode.kind).toBe('group');
    expect(orNode.op).toBe('OR');
    // The OR must have two children: AND(a,b) and c
    expect(orNode.children).toHaveLength(2);
    const andNode = orNode.children[0] as GroupNode;
    expect(andNode.kind).toBe('group');
    expect(andNode.op).toBe('AND');
    expect(andNode.children).toHaveLength(2);
  });

  it('AND(filter, dateRange) flat tree round-trips fully (regression guard)', () => {
    // Verifies the most common segment shape (country + date window) survives.
    const tree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafCountry, leafDateRange],
    };
    expect(normalise(roundTrip(tree))).toEqual(normalise(tree));
  });

  it('echo filters are absent from the round-tripped tree when stripped before conversion', () => {
    const echoFilters = [
      { member: 'mf_users.gameId', operator: 'equals', values: ['jus_vn'] },
    ];

    const sourcetree: GroupNode = {
      kind: 'group', id: 'g', op: 'AND',
      children: [leafCountry, leafSpend],
    };
    const fragment = treeToQueryFragment(sourcetree);

    // Simulate applyGameFilter injecting a game-echo filter on top of the tree.
    const queryWithEcho: Query = {
      measures: ['mf_users.count'],
      dimensions: ['mf_users.user_id'],
      filters: [
        ...(fragment.filters as any[]),
        { member: 'mf_users.gameId', operator: 'equals', values: ['jus_vn'] },
      ],
      timeDimensions: fragment.timeDimensions as any,
    };

    const stripped = stripEchoFilters(queryWithEcho, echoFilters);
    const back = buildPredicateFromRows(stripped, [], 'mf_users.user_id');

    // The echo filter must not appear in the saved predicate.
    function hasGameIdLeaf(node: PredicateNode): boolean {
      if (node.kind === 'leaf') return node.member === 'mf_users.gameId';
      return node.children.some(hasGameIdLeaf);
    }
    expect(hasGameIdLeaf(back)).toBe(false);

    // The user's original filters should be preserved.
    expect(normalise(back)).toEqual(normalise(sourcetree));
  });
});
