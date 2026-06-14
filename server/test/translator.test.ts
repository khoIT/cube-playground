import { describe, it, expect } from 'vitest';
import {
  treeToCubeFilters,
  cubeFiltersToTree,
  UnsupportedOperatorError,
  PercentileNotResolvedError,
} from '../src/services/translator.js';
import type { GroupNode, LeafNode, PredicateNode } from '../src/types/predicate-tree.js';

// Helper to build a leaf node
function leaf(overrides: Partial<LeafNode> & Pick<LeafNode, 'member' | 'op' | 'values'>): LeafNode {
  return { kind: 'leaf', id: 'test-id', type: 'string', ...overrides };
}

function group(op: 'AND' | 'OR', children: PredicateNode[]): GroupNode {
  return { kind: 'group', id: 'group-id', op, children };
}

describe('treeToCubeFilters', () => {
  it('flattens a root AND group with 3 leaves', () => {
    const tree = group('AND', [
      leaf({ member: 'Users.country', op: 'equals', values: ['US'] }),
      leaf({ member: 'Users.name', op: 'contains', values: ['alice'] }),
      leaf({ member: 'Users.createdAt', op: 'inDateRange', values: ['2024-01-01', '2024-12-31'] }),
    ]);

    const filters = treeToCubeFilters(tree);

    expect(filters).toHaveLength(3);
    expect(filters[0]).toEqual({ member: 'Users.country', operator: 'equals', values: ['US'] });
    expect(filters[1]).toEqual({ member: 'Users.name', operator: 'contains', values: ['alice'] });
    expect(filters[2]).toEqual({ member: 'Users.createdAt', operator: 'inDateRange', values: ['2024-01-01', '2024-12-31'] });
  });

  it('round-trips flat AND of 3 leaves without loss', () => {
    const tree = group('AND', [
      leaf({ member: 'A.x', op: 'equals', values: ['1'] }),
      leaf({ member: 'A.y', op: 'contains', values: ['foo'] }),
      leaf({ member: 'A.ts', op: 'inDateRange', values: ['2024-01-01', '2024-03-31'] }),
    ]);

    const filters = treeToCubeFilters(tree);
    const back = cubeFiltersToTree(filters);

    expect(back.kind).toBe('group');
    const root = back as GroupNode;
    expect(root.op).toBe('AND');
    expect(root.children).toHaveLength(3);
    expect((root.children[0] as LeafNode).member).toBe('A.x');
    expect((root.children[0] as LeafNode).op).toBe('equals');
    expect((root.children[1] as LeafNode).op).toBe('contains');
    expect((root.children[2] as LeafNode).op).toBe('inDateRange');
  });

  it('round-trips 3-level nested AND > OR > AND', () => {
    const innerAnd = group('AND', [
      leaf({ member: 'B.tier', op: 'equals', values: ['gold'] }),
      leaf({ member: 'B.active', op: 'equals', values: ['true'] }),
    ]);
    const outerOr = group('OR', [
      leaf({ member: 'B.country', op: 'equals', values: ['VN'] }),
      innerAnd,
    ]);
    const root = group('AND', [
      leaf({ member: 'B.status', op: 'equals', values: ['ok'] }),
      outerOr,
    ]);

    const filters = treeToCubeFilters(root);
    // root AND: first item is a leaf filter, second is { or: [...] }
    expect(filters).toHaveLength(2);
    expect(filters[0]).toEqual({ member: 'B.status', operator: 'equals', values: ['ok'] });
    expect(filters[1]).toHaveProperty('or');

    const back = cubeFiltersToTree(filters);
    expect(back.kind).toBe('group');
    const backRoot = back as GroupNode;
    expect(backRoot.op).toBe('AND');
    expect(backRoot.children).toHaveLength(2);
    const orChild = backRoot.children[1] as GroupNode;
    expect(orChild.op).toBe('OR');
    expect(orChild.children).toHaveLength(2);
    const andGrandchild = orChild.children[1] as GroupNode;
    expect(andGrandchild.op).toBe('AND');
    expect(andGrandchild.children).toHaveLength(2);
  });

  it('maps notIn correctly', () => {
    const tree = leaf({ member: 'U.role', op: 'notIn', values: ['admin', 'mod'] });
    const [filter] = treeToCubeFilters(tree);
    expect(filter).toEqual({ member: 'U.role', operator: 'notEquals', values: ['admin', 'mod'] });
  });

  it('maps set and notSet (no values)', () => {
    const setTree = leaf({ member: 'U.email', op: 'set', values: [] });
    const notSetTree = leaf({ member: 'U.phone', op: 'notSet', values: [] });

    const [setFilter] = treeToCubeFilters(setTree);
    const [notSetFilter] = treeToCubeFilters(notSetTree);

    expect(setFilter).toEqual({ member: 'U.email', operator: 'set' });
    expect(notSetFilter).toEqual({ member: 'U.phone', operator: 'notSet' });
  });

  it('maps beforeDate and afterDate', () => {
    const before = leaf({ member: 'U.createdAt', op: 'beforeDate', values: ['2024-01-01'], type: 'time' });
    const after = leaf({ member: 'U.createdAt', op: 'afterDate', values: ['2023-01-01'], type: 'time' });

    const [bFilter] = treeToCubeFilters(before);
    const [aFilter] = treeToCubeFilters(after);

    expect(bFilter).toEqual({ member: 'U.createdAt', operator: 'beforeDate', values: ['2024-01-01'] });
    expect(aFilter).toEqual({ member: 'U.createdAt', operator: 'afterDate', values: ['2023-01-01'] });
  });

  it('expands inDateRange single-value "this month" to a 2-date array', () => {
    const tree = leaf({
      member: 'U.last_active_date',
      op: 'inDateRange',
      values: ['this month'],
      type: 'time',
    });
    const [f] = treeToCubeFilters(tree);
    expect(f).toBeDefined();
    expect((f as { values: string[] }).values).toHaveLength(2);
    // Both values should be valid YYYY-MM-DD strings.
    expect((f as { values: string[] }).values[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((f as { values: string[] }).values[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('expands a notInDateRange single-value relative window the same as inDateRange', () => {
    // The "not in window" event operator shares inDateRange's value shape; the
    // translator must expand the relative string and keep the negated operator.
    const tree = leaf({
      member: 'U.last_active_date',
      op: 'notInDateRange',
      values: ['this month'],
      type: 'time',
    });
    const [f] = treeToCubeFilters(tree);
    expect(f).toBeDefined();
    expect((f as { operator: string }).operator).toBe('notInDateRange');
    expect((f as { values: string[] }).values).toHaveLength(2);
    expect((f as { values: string[] }).values[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('normalizes inDateRange values wrapped as `[[start, end]]` to a flat tuple', () => {
    // Authoring path (segments-save-bar/build-predicate-from-rows) emits the
    // nested shape because each `values[i]` is one logical value. Translator
    // must accept it so deeply-nested predicates from cohort rows aren't
    // silently dropped — which would make the segment match the surrounding
    // date window instead of the intended bucket.
    const tree = leaf({
      member: 'mf_users.first_active_date',
      op: 'inDateRange',
      values: [['2026-05-03', '2026-05-09']],
      type: 'time',
    });
    const [f] = treeToCubeFilters(tree);
    expect(f).toEqual({
      member: 'mf_users.first_active_date',
      operator: 'inDateRange',
      values: ['2026-05-03', '2026-05-09'],
    });
  });

  it('preserves the nested-bucket filter when embedded inside AND > OR > AND', () => {
    // Regression: replicates the production-broken predicate shape that was
    // collapsing to "outer date range only" in `cube_query_json`.
    const tree = group('AND', [
      leaf({
        member: 'mf_users.first_active_date',
        op: 'inDateRange',
        values: ['last 30 days'],
        type: 'time',
      }),
      group('OR', [
        group('AND', [
          leaf({
            member: 'mf_users.first_active_date',
            op: 'inDateRange',
            values: [['2026-05-03', '2026-05-09']],
            type: 'time',
          }),
        ]),
      ]),
    ]);
    const filters = treeToCubeFilters(tree);
    // Both the outer 30-day filter and the inner bucket filter must survive.
    expect(filters).toHaveLength(2);
    const or = filters[1] as { or: Array<{ and: Array<{ values: string[] }> }> };
    expect(or.or[0].and[0].values).toEqual(['2026-05-03', '2026-05-09']);
  });

  it('drops inDateRange filter when the single value is unrecognized', () => {
    const tree = group('AND', [
      leaf({ member: 'U.country', op: 'equals', values: ['US'] }),
      leaf({
        member: 'U.last_active_date',
        op: 'inDateRange',
        values: ['gibberish'],
        type: 'time',
      }),
    ]);
    const filters = treeToCubeFilters(tree);
    // Bad filter dropped; the country filter remains.
    expect(filters).toHaveLength(1);
    expect((filters[0] as { member: string }).member).toBe('U.country');
  });

  it('throws UnsupportedOperatorError for unknown op in tree', () => {
    // Force an invalid op via type cast to test runtime guard
    const badLeaf = leaf({ member: 'X.y', op: 'invalidOp' as never, values: [] });
    expect(() => treeToCubeFilters(badLeaf)).toThrow(UnsupportedOperatorError);
  });

  it('throws UnsupportedOperatorError for unknown Cube operator in inverse', () => {
    const badFilter = { member: 'X.y', operator: 'unknownCubeOp', values: [] };
    expect(() => cubeFiltersToTree([badFilter])).toThrow(UnsupportedOperatorError);
  });
});

describe('treeToCubeFilters — anchorDate threading', () => {
  it('expands a relative window against anchorDate, not real today', () => {
    const tree = leaf({ member: 'etl.d', op: 'inDateRange', type: 'time', values: ['last 7 days'] });
    const anchorDate = new Date('2026-05-04T00:00:00.000Z');
    const filters = treeToCubeFilters(tree, { anchorDate }) as { values: string[] }[];
    // 7 days inclusive ending on the anchor day → 2026-04-28 .. 2026-05-04.
    expect(filters[0].values).toEqual(['2026-04-28', '2026-05-04']);
  });

  it('reaches an inDateRange leaf nested inside a group', () => {
    const tree = group('AND', [
      leaf({ member: 'mf.ltv', op: 'gte', type: 'number', values: [1] }),
      leaf({ member: 'etl.d', op: 'inDateRange', type: 'time', values: ['last 7 days'] }),
    ]);
    const anchorDate = new Date('2026-05-04T00:00:00.000Z');
    const filters = treeToCubeFilters(tree, { anchorDate });
    const dateFilter = filters.find((f) => 'member' in f && f.member === 'etl.d') as { values: string[] };
    expect(dateFilter.values).toEqual(['2026-04-28', '2026-05-04']);
  });

  it('expands an "anniversary" window to an OR of 5 single-day ranges before the anchor', () => {
    const tree = leaf({ member: 'mf_users.first_active_date', op: 'inDateRange', type: 'time', values: ['anniversary'] });
    const anchorDate = new Date(2026, 4, 4); // 2026-05-04 local
    const filters = treeToCubeFilters(tree, { anchorDate }) as { or: { member: string; values: string[] }[] }[];
    expect(filters).toHaveLength(1);
    const or = filters[0].or;
    expect(or).toHaveLength(5); // {30,90,180,365,730} days before
    // 30 days before 2026-05-04 = 2026-04-04, as a single-day range.
    expect(or[0]).toMatchObject({ member: 'mf_users.first_active_date', values: ['2026-04-04', '2026-04-04'] });
    // every range is a single day (start === end)
    for (const f of or) expect(f.values[0]).toBe(f.values[1]);
  });

  it('defaults to today when no anchorDate is passed (back-compat)', () => {
    const tree = leaf({ member: 'etl.d', op: 'inDateRange', type: 'time', values: ['this year'] });
    const thisYear = String(new Date().getFullYear());
    const filters = treeToCubeFilters(tree) as { values: string[] }[];
    expect(filters[0].values[0].startsWith(thisYear)).toBe(true);
  });
});

describe('cubeFiltersToTree', () => {
  it('wraps multiple top-level filters in a root AND group', () => {
    const filters = [
      { member: 'A.x', operator: 'equals', values: ['1'] },
      { member: 'A.y', operator: 'gt', values: ['5'] },
    ];
    const tree = cubeFiltersToTree(filters) as GroupNode;
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(2);
  });

  it('returns empty AND group for empty filter array', () => {
    const tree = cubeFiltersToTree([]) as GroupNode;
    expect(tree.kind).toBe('group');
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(0);
  });

  it('disambiguates multi-value equals → in', () => {
    const filters = [{ member: 'U.role', operator: 'equals', values: ['a', 'b', 'c'] }];
    const tree = cubeFiltersToTree(filters) as LeafNode;
    expect(tree.op).toBe('in');
  });
});

describe('derived relative-date operators', () => {
  const asOf = new Date('2026-06-14T00:00:00');

  it('dateWithinLast resolves to an absolute afterDate against the anchor', () => {
    const tree = leaf({ member: 'U.first_login', op: 'dateWithinLast', type: 'time', values: [{ n: 6, unit: 'month' }] });
    const [f] = treeToCubeFilters(tree, { anchorDate: asOf });
    expect(f).toEqual({ member: 'U.first_login', operator: 'afterDate', values: ['2025-12-14'] });
  });

  it('dateBeforeLast resolves to an absolute beforeDate against the anchor', () => {
    const tree = leaf({ member: 'U.first_login', op: 'dateBeforeLast', type: 'time', values: [{ n: 18, unit: 'month' }] });
    const [f] = treeToCubeFilters(tree, { anchorDate: asOf });
    expect(f).toEqual({ member: 'U.first_login', operator: 'beforeDate', values: ['2024-12-14'] });
  });

  it('a tenure band ANDs before-18mo with within-6mo into a deterministic range', () => {
    const tree = group('AND', [
      leaf({ member: 'U.first_login', op: 'dateWithinLast', type: 'time', values: [{ n: 18, unit: 'month' }] }),
      leaf({ member: 'U.first_login', op: 'dateBeforeLast', type: 'time', values: [{ n: 6, unit: 'month' }] }),
    ]);
    const filters = treeToCubeFilters(tree, { anchorDate: asOf });
    expect(filters).toEqual([
      { member: 'U.first_login', operator: 'afterDate', values: ['2024-12-14'] },
      { member: 'U.first_login', operator: 'beforeDate', values: ['2025-12-14'] },
    ]);
  });
});

describe('percentile operators (two-pass)', () => {
  it('throws PercentileNotResolvedError when no cutoff is supplied', () => {
    const tree = leaf({ member: 'B.lifetime_vnd', op: 'percentileGte', type: 'number', values: [{ p: 75 }] });
    expect(() => treeToCubeFilters(tree)).toThrow(PercentileNotResolvedError);
  });

  it('compiles to a scalar gte against the pre-resolved cutoff', () => {
    const tree = leaf({ member: 'B.lifetime_vnd', op: 'percentileGte', type: 'number', values: [{ p: 75 }] });
    const resolved = new Map([['test-id', 5_000_000]]);
    const [f] = treeToCubeFilters(tree, { resolvedPercentiles: resolved });
    expect(f).toEqual({ member: 'B.lifetime_vnd', operator: 'gte', values: ['5000000'] });
  });

  it('percentileLte compiles to a scalar lte', () => {
    const tree = leaf({ member: 'B.arppu', op: 'percentileLte', type: 'number', values: [{ p: 25 }] });
    const resolved = new Map([['test-id', 120]]);
    const [f] = treeToCubeFilters(tree, { resolvedPercentiles: resolved });
    expect(f).toEqual({ member: 'B.arppu', operator: 'lte', values: ['120'] });
  });
});
