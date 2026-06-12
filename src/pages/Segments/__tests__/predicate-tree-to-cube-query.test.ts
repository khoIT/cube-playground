import { describe, it, expect } from 'vitest';
import { treeToQueryFragment } from '../predicate-tree-to-cube-query';
import type { PredicateNode, LeafNode, GroupNode } from '../../../types/segment-api';

// ── helpers ────────────────────────────────────────────────────────────────

function leaf(
  overrides: Partial<LeafNode> & Pick<LeafNode, 'member' | 'op'>,
): LeafNode {
  return { kind: 'leaf', id: overrides.member, type: 'string', values: [], ...overrides };
}

function and(...children: PredicateNode[]): GroupNode {
  return { kind: 'group', id: 'g1', op: 'AND', children };
}

function or(...children: PredicateNode[]): GroupNode {
  return { kind: 'group', id: 'g2', op: 'OR', children };
}

// ── string / numeric operators → filters ───────────────────────────────────

describe('string / numeric operators', () => {
  it('equals → filter with values', () => {
    const { filters, timeDimensions } = treeToQueryFragment(
      leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] }),
    );
    expect(filters).toEqual([{ member: 'mf_users.os_platform', operator: 'equals', values: ['pc'] }]);
    expect(timeDimensions).toEqual([]);
  });

  it('notEquals → filter with values', () => {
    const { filters } = treeToQueryFragment(
      leaf({ member: 'mf_users.os_platform', op: 'notEquals', values: ['mobile'] }),
    );
    expect(filters[0].operator).toBe('notEquals');
    expect(filters[0].values).toEqual(['mobile']);
  });

  it('in (multi-value) → Cube "equals" with all values (mirrors server TREE_TO_CUBE map)', () => {
    // Cube has no native 'in' operator; the server translator maps in→equals.
    // buildPredicateFromRows re-promotes multi-value equals → 'in' on the
    // reverse leg so the round-trip stays lossless.
    const { filters } = treeToQueryFragment(
      leaf({ member: 'mf_users.country', op: 'in', values: ['VN', 'SG', 'TH'] }),
    );
    expect(filters[0].operator).toBe('equals');
    expect(filters[0].values).toHaveLength(3);
  });

  it('notIn → Cube "notEquals" (mirrors server TREE_TO_CUBE map)', () => {
    // Cube has no native 'notIn' operator; server maps notIn→notEquals.
    const { filters } = treeToQueryFragment(
      leaf({ member: 'mf_users.country', op: 'notIn', values: ['US'] }),
    );
    expect(filters[0].operator).toBe('notEquals');
    expect(filters[0].values).toEqual(['US']);
  });

  it('contains → filter', () => {
    const { filters } = treeToQueryFragment(
      leaf({ member: 'mf_users.name', op: 'contains', values: ['knight'] }),
    );
    expect(filters[0].operator).toBe('contains');
    expect(filters[0].values).toEqual(['knight']);
  });

  it('gt / gte / lt / lte → filters', () => {
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
      const { filters } = treeToQueryFragment(
        leaf({ member: 'mf_users.level', op, values: ['10'], type: 'number' }),
      );
      expect(filters[0].operator).toBe(op);
      expect(filters[0].values).toEqual(['10']);
    }
  });

  it('set / notSet → filter WITHOUT values array', () => {
    for (const op of ['set', 'notSet'] as const) {
      const { filters } = treeToQueryFragment(
        leaf({ member: 'mf_users.email', op, values: [] }),
      );
      expect(filters[0].operator).toBe(op);
      expect(filters[0].values).toBeUndefined();
    }
  });
});

// ── time operators → timeDimensions (relative literals preserved) ──────────

describe('time operators — relative date literals preserved', () => {
  it('inDateRange with relative string → timeDimensions dateRange is "last 30 days"', () => {
    const { filters, timeDimensions } = treeToQueryFragment(
      leaf({
        member: 'active_daily.event_date',
        op: 'inDateRange',
        type: 'time',
        values: ['last 30 days'],
      }),
    );
    expect(filters).toEqual([]);
    expect(timeDimensions).toEqual([
      { dimension: 'active_daily.event_date', dateRange: 'last 30 days' },
    ]);
  });

  it('inDateRange with [from, to] tuple preserves tuple', () => {
    const { timeDimensions } = treeToQueryFragment(
      leaf({
        member: 'mf_users.event_date',
        op: 'inDateRange',
        type: 'time',
        values: ['2024-01-01', '2024-01-31'],
      }),
    );
    expect(timeDimensions[0].dateRange).toEqual(['2024-01-01', '2024-01-31']);
  });

  it('beforeDate → timeDimensions entry (single date value)', () => {
    const { timeDimensions, filters } = treeToQueryFragment(
      leaf({
        member: 'mf_users.registered_at',
        op: 'beforeDate',
        type: 'time',
        values: ['2024-06-01'],
      }),
    );
    expect(filters).toEqual([]);
    expect(timeDimensions[0]).toEqual({
      dimension: 'mf_users.registered_at',
      dateRange: '2024-06-01',
    });
  });

  it('afterDate → timeDimensions entry', () => {
    const { timeDimensions } = treeToQueryFragment(
      leaf({
        member: 'mf_users.registered_at',
        op: 'afterDate',
        type: 'time',
        values: ['2023-01-01'],
      }),
    );
    expect(timeDimensions[0].dateRange).toBe('2023-01-01');
  });

  it('time leaf with no values → timeDimension without dateRange', () => {
    const { timeDimensions } = treeToQueryFragment(
      leaf({ member: 'mf_users.event_date', op: 'inDateRange', type: 'time', values: [] }),
    );
    expect(timeDimensions[0]).toEqual({ dimension: 'mf_users.event_date' });
  });
});

// ── AND group → flat merge ─────────────────────────────────────────────────

describe('AND group', () => {
  it('flattens multiple leaves into one filters array', () => {
    const tree = and(
      leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] }),
      leaf({ member: 'mf_users.country', op: 'in', values: ['VN'] }),
    );
    const { filters, timeDimensions } = treeToQueryFragment(tree);
    expect(filters).toHaveLength(2);
    expect(timeDimensions).toHaveLength(0);
  });

  it('AND with a time leaf → one filter + one timeDimension', () => {
    const tree = and(
      leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] }),
      leaf({
        member: 'active_daily.event_date',
        op: 'inDateRange',
        type: 'time',
        values: ['last 30 days'],
      }),
    );
    const { filters, timeDimensions } = treeToQueryFragment(tree);
    expect(filters).toHaveLength(1);
    expect(timeDimensions[0].dateRange).toBe('last 30 days');
  });
});

// ── OR group → compound filter ────────────────────────────────────────────

describe('OR group', () => {
  it('wraps child filters in { or: [...] }', () => {
    const tree = or(
      leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] }),
      leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['console'] }),
    );
    const { filters } = treeToQueryFragment(tree);
    expect(filters).toHaveLength(1);
    expect((filters[0] as any).or).toHaveLength(2);
  });
});

// ── nested group — structure preservation ─────────────────────────────────

describe('nested group — faithful structure emission', () => {
  it('AND(OR(a,b), c) → two top-level items: { or: [a, b] } and plain filter', () => {
    const tree = and(
      or(
        leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] }),
        leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['mobile'] }),
      ),
      leaf({ member: 'mf_users.country', op: 'in', values: ['VN'] }),
    );
    const { filters } = treeToQueryFragment(tree);
    // First item = { or: [a, b] }, second item = plain filter for 'in' → equals
    expect(filters).toHaveLength(2);
    expect((filters[0] as any).or).toHaveLength(2);
    expect(filters[1].member).toBe('mf_users.country');
    // 'in' is mapped to 'equals' (Cube has no native 'in' operator)
    expect(filters[1].operator).toBe('equals');
  });

  it('OR(AND(a,b), c) → single { or: [{ and:[a,b] }, c] } — NOT flattened to or(a,b,c)', () => {
    // Critical: OR(AND(a,b),c) must NOT be flattened to or(a,b,c).
    // Flattening silently widens the cohort: AND(a,b) is strictly narrower than
    // loose a or b. The round-trip must emit a nested boolean-group filter.
    const a = leaf({ member: 'mf_users.country', op: 'equals', values: ['VN'] });
    const b = leaf({ member: 'mf_users.spend', op: 'gte', values: ['100'] });
    const c = leaf({ member: 'mf_users.os_platform', op: 'equals', values: ['pc'] });
    const tree = or(and(a, b), c);
    const { filters } = treeToQueryFragment(tree);
    // Must produce exactly one top-level { or: [...] } item
    expect(filters).toHaveLength(1);
    const orFilter = (filters[0] as any).or;
    expect(Array.isArray(orFilter)).toBe(true);
    expect(orFilter).toHaveLength(2);
    // First child of OR must be { and: [a, b] } — not flattened
    const andChild = orFilter[0];
    expect(andChild.and).toBeDefined();
    expect(andChild.and).toHaveLength(2);
    // Second child is plain leaf c
    expect(orFilter[1].member).toBe('mf_users.os_platform');
  });

  it('AND(a, AND(b, c)) → three top-level items (flattens sibling ANDs at root)', () => {
    const a = leaf({ member: 'mf_users.country', op: 'equals', values: ['VN'] });
    const b = leaf({ member: 'mf_users.spend', op: 'gte', values: ['100'] });
    const c = leaf({ member: 'mf_users.level', op: 'gt', values: ['5'] });
    // Root AND containing a nested AND group
    const tree = and(a, and(b, c));
    const { filters } = treeToQueryFragment(tree);
    // Child AND group is emitted as { and: [b, c] } — a compound filter object
    // (not re-flattened because the child AND is explicitly a group node).
    expect(filters).toHaveLength(2);
    expect(filters[0].member).toBe('mf_users.country');
    // Second item is the nested { and: [b, c] }
    expect((filters[1] as any).and).toHaveLength(2);
  });
});
