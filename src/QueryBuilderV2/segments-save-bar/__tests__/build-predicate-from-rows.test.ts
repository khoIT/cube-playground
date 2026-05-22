/**
 * Tests for build-predicate-from-rows — converts an executed Cube Query plus
 * selected cohort rows into a canonical PredicateNode tree for "Live" segment
 * creation from the Playground push flow.
 */

import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import { buildPredicateFromRows } from '../build-predicate-from-rows';
import type { GroupNode, LeafNode, PredicateNode } from '../../../types/segment-api';

function isGroup(n: PredicateNode): n is GroupNode {
  return n.kind === 'group';
}
function isLeaf(n: PredicateNode): n is LeafNode {
  return n.kind === 'leaf';
}

describe('buildPredicateFromRows', () => {
  const baseQuery: Query = {
    dimensions: ['mf_users.first_login_month'],
    measures: ['mf_users.arpu_vnd'],
    timeDimensions: [
      { dimension: 'active_daily.log_date', dateRange: 'this week', granularity: 'week' },
    ],
    filters: [
      { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
    ],
  };

  it('returns a root AND group', () => {
    const tree = buildPredicateFromRows(baseQuery, [], 'mf_users.user_id');
    expect(tree.kind).toBe('group');
    expect(tree.op).toBe('AND');
  });

  it('translates a single-value equals filter to an equals leaf', () => {
    const tree = buildPredicateFromRows(baseQuery, [], 'mf_users.user_id');
    const leaf = tree.children.find(
      (c) => isLeaf(c) && c.member === 'mf_users.country',
    ) as LeafNode | undefined;
    expect(leaf).toBeDefined();
    expect(leaf!.op).toBe('equals');
    expect(leaf!.values).toEqual(['VN']);
  });

  it('promotes multi-value equals to "in"', () => {
    const q: Query = {
      ...baseQuery,
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN', 'ID'] }],
    };
    const tree = buildPredicateFromRows(q, [], 'mf_users.user_id');
    const leaf = tree.children.find(
      (c) => isLeaf(c) && c.member === 'mf_users.country',
    ) as LeafNode | undefined;
    expect(leaf!.op).toBe('in');
    expect(leaf!.values).toEqual(['VN', 'ID']);
  });

  it('keeps dateRange as a literal in an inDateRange leaf', () => {
    const tree = buildPredicateFromRows(baseQuery, [], 'mf_users.user_id');
    const td = tree.children.find(
      (c) => isLeaf(c) && c.member === 'active_daily.log_date',
    ) as LeafNode | undefined;
    expect(td).toBeDefined();
    expect(td!.op).toBe('inDateRange');
    expect(td!.values).toEqual(['this week']);
    expect(td!.type).toBe('time');
  });

  it('preserves array-form dateRange ([start, end])', () => {
    const q: Query = {
      ...baseQuery,
      timeDimensions: [
        {
          dimension: 'active_daily.log_date',
          dateRange: ['2025-05-01', '2025-05-31'],
          granularity: 'day',
        },
      ],
    };
    const tree = buildPredicateFromRows(q, [], 'mf_users.user_id');
    const td = tree.children.find(
      (c) => isLeaf(c) && c.member === 'active_daily.log_date',
    ) as LeafNode | undefined;
    expect(td!.values).toEqual([['2025-05-01', '2025-05-31']]);
  });

  it('skips time dimensions without dateRange', () => {
    const q: Query = {
      ...baseQuery,
      timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day' }],
    };
    const tree = buildPredicateFromRows(q, [], 'mf_users.user_id');
    expect(
      tree.children.some((c) => isLeaf(c) && c.member === 'active_daily.log_date'),
    ).toBe(false);
  });

  it('emits an OR-of-AND group over non-identity dims for selected rows', () => {
    const rows = [
      { 'mf_users.first_login_month': '2025-05-01' },
      { 'mf_users.first_login_month': '2025-06-01' },
    ];
    const tree = buildPredicateFromRows(baseQuery, rows, 'mf_users.user_id');
    const orGroup = tree.children.find(
      (c) => isGroup(c) && c.op === 'OR',
    ) as GroupNode | undefined;
    expect(orGroup).toBeDefined();
    expect(orGroup!.children).toHaveLength(2);
    const inner = orGroup!.children[0] as GroupNode;
    expect(inner.op).toBe('AND');
    const innerLeaf = inner.children[0] as LeafNode;
    expect(innerLeaf.member).toBe('mf_users.first_login_month');
    expect(innerLeaf.op).toBe('equals');
    expect(innerLeaf.values).toEqual(['2025-05-01']);
  });

  it('excludes the identity dim from row-equality leaves', () => {
    const q: Query = {
      ...baseQuery,
      dimensions: ['mf_users.user_id', 'mf_users.first_login_month'],
    };
    const rows = [
      { 'mf_users.user_id': 'u1', 'mf_users.first_login_month': '2025-05' },
    ];
    const tree = buildPredicateFromRows(q, rows, 'mf_users.user_id');
    const orGroup = tree.children.find(
      (c) => isGroup(c) && c.op === 'OR',
    ) as GroupNode;
    const inner = orGroup.children[0] as GroupNode;
    const members = inner.children.map((c) => (c as LeafNode).member);
    expect(members).not.toContain('mf_users.user_id');
    expect(members).toContain('mf_users.first_login_month');
  });

  it('omits the OR group entirely when no rows are selected', () => {
    const tree = buildPredicateFromRows(baseQuery, [], 'mf_users.user_id');
    expect(tree.children.some((c) => isGroup(c) && c.op === 'OR')).toBe(false);
  });

  it('translates nested logical filters (and/or)', () => {
    const q: Query = {
      ...baseQuery,
      filters: [
        {
          or: [
            { member: 'mf_users.country', operator: 'equals', values: ['VN'] },
            {
              and: [
                { member: 'mf_users.country', operator: 'equals', values: ['ID'] },
                { member: 'mf_users.arpu_vnd', operator: 'gt', values: ['1000'] },
              ],
            },
          ],
        },
      ],
    };
    const tree = buildPredicateFromRows(q, [], 'mf_users.user_id');
    const root = tree.children[0] as GroupNode;
    expect(root.kind).toBe('group');
    expect(root.op).toBe('OR');
    expect(root.children).toHaveLength(2);
    const andNode = root.children[1] as GroupNode;
    expect(andNode.op).toBe('AND');
    expect(andNode.children).toHaveLength(2);
  });

  it('handles a query with neither filters, time, nor selected rows', () => {
    const tree = buildPredicateFromRows(
      { dimensions: [], measures: [] },
      [],
      'mf_users.user_id',
    );
    expect(tree.kind).toBe('group');
    expect(tree.op).toBe('AND');
    expect(tree.children).toEqual([]);
  });

  it('builds inDateRange leaves per cohort row for bucketed time dimensions', () => {
    const cohortQuery: Query = {
      measures: ['mf_users.arpu_vnd'],
      timeDimensions: [
        { dimension: 'active_daily.log_date', dateRange: 'this month', granularity: 'week' },
        { dimension: 'mf_users.first_login_date', granularity: 'week' },
      ],
    };
    const rows = [
      {
        'active_daily.log_date.week': '2026-05-04',
        'mf_users.first_login_date.week': '2026-03-02',
      },
    ];
    const tree = buildPredicateFromRows(cohortQuery, rows, 'mf_users.user_id');
    const orGroup = tree.children.find(
      (c) => isGroup(c) && c.op === 'OR',
    ) as GroupNode | undefined;
    expect(orGroup).toBeDefined();
    const rowAnd = orGroup!.children[0] as GroupNode;
    const leafMembers = rowAnd.children.map((c) => (c as LeafNode).member);
    expect(leafMembers).toEqual([
      'active_daily.log_date',
      'mf_users.first_login_date',
    ]);
    const logDateLeaf = rowAnd.children[0] as LeafNode;
    expect(logDateLeaf.op).toBe('inDateRange');
    expect(logDateLeaf.type).toBe('time');
    expect(logDateLeaf.values).toEqual([['2026-05-04', '2026-05-10']]);
    const firstLoginLeaf = rowAnd.children[1] as LeafNode;
    expect(firstLoginLeaf.values).toEqual([['2026-03-02', '2026-03-08']]);
  });
});
