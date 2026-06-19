/**
 * Unit tests for cubeQueryToPredicateTree — covers every reject path and the
 * three translated leaf shapes the segment feature depends on.
 */

import { describe, it, expect } from 'vitest';
import {
  cubeQueryToPredicateTree,
  type CubeQueryFilters,
} from '../src/utils/cube-query-to-predicate-tree.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leaf(member: string, operator: string, values: string[] = []) {
  return { member, operator, values };
}

// ---------------------------------------------------------------------------
// Reject paths
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicateTree — reject paths', () => {
  it('rejects order+limit when no measure is present', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.country', 'equals', ['VN'])],
      order: { 'mf_users.recharge_vnd': 'desc' },
      limit: 100,
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('order_limit_without_measure');
  });

  it('allows order+limit when a measure is present (top-N exploration query)', () => {
    const q: CubeQueryFilters = {
      measures: ['mf_users.recharge_vnd'],
      filters: [],
      order: { 'mf_users.recharge_vnd': 'desc' },
      limit: 100,
    };
    const result = cubeQueryToPredicateTree(q);
    // No filters → empty AND group is ok
    expect(result.ok).toBe(true);
  });

  it('rejects a measure filter', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.recharge_vnd', 'gte', ['1000'])],
    };
    const measures = new Set(['mf_users.recharge_vnd']);
    const result = cubeQueryToPredicateTree(q, measures);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('measure_filter');
  });

  it('rejects a time leaf inside an OR group', () => {
    const q: CubeQueryFilters = {
      filters: [
        {
          or: [
            leaf('mf_users.country', 'equals', ['VN']),
            { member: 'mf_users.register_date', operator: 'inDateRange', values: ['2024-01-01', '2024-12-31'] },
          ],
        },
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('time_leaf_in_or');
  });

  it('rejects a filter with a missing member field', () => {
    const q: CubeQueryFilters = {
      filters: [{ operator: 'equals', values: ['VN'] }],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_member');
  });

  it('rejects an unsupported operator', () => {
    const q: CubeQueryFilters = {
      filters: [{ member: 'mf_users.country', operator: 'fuzzyMatch', values: ['VN'] }],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch('unsupported_operator');
  });
});

// ---------------------------------------------------------------------------
// Happy paths — leaf translation
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicateTree — happy paths', () => {
  it('translates a single equals filter to an AND group with one leaf', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.country', 'equals', ['VN'])],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    expect(pred.kind).toBe('group');
    if (pred.kind !== 'group') return;
    expect(pred.op).toBe('AND');
    expect(pred.children).toHaveLength(1);
    const child = pred.children[0];
    expect(child.kind).toBe('leaf');
    if (child.kind !== 'leaf') return;
    expect(child.member).toBe('mf_users.country');
    expect(child.op).toBe('equals');
    expect(child.values).toEqual(['VN']);
  });

  it('produces an empty AND root for zero filters', () => {
    const result = cubeQueryToPredicateTree({ filters: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.predicate.kind).toBe('group');
    if (result.predicate.kind !== 'group') return;
    expect(result.predicate.children).toHaveLength(0);
  });

  it('wraps multiple top-level filters in AND', () => {
    const q: CubeQueryFilters = {
      filters: [
        leaf('mf_users.country', 'equals', ['VN']),
        leaf('mf_users.user_type', 'equals', ['payer']),
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    expect(pred.kind).toBe('group');
    if (pred.kind !== 'group') return;
    expect(pred.op).toBe('AND');
    expect(pred.children).toHaveLength(2);
  });

  it('translates a nested OR group (wrapped in root AND)', () => {
    const q: CubeQueryFilters = {
      filters: [
        {
          or: [
            leaf('mf_users.country', 'equals', ['VN']),
            leaf('mf_users.country', 'equals', ['SG']),
          ],
        },
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Root is always AND; the OR group is the single child.
    const pred = result.predicate;
    expect(pred.kind).toBe('group');
    if (pred.kind !== 'group') return;
    expect(pred.op).toBe('AND');
    expect(pred.children).toHaveLength(1);
    const orGroup = pred.children[0];
    expect(orGroup.kind).toBe('group');
    if (orGroup.kind !== 'group') return;
    expect(orGroup.op).toBe('OR');
    expect(orGroup.children).toHaveLength(2);
  });

  it('allows a time leaf at the top level (inside implicit AND)', () => {
    const q: CubeQueryFilters = {
      filters: [
        { member: 'mf_users.register_date', operator: 'afterDate', values: ['2024-01-01'] },
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
  });

  it('coerces numeric values for numeric dimensions', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.days_since_last_active', 'lte', ['30'])],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    if (pred.kind !== 'group') return;
    const child = pred.children[0];
    if (child.kind !== 'leaf') return;
    expect(child.type).toBe('number');
    expect(child.values).toEqual([30]);
  });

  it('infers time type for members ending in _date', () => {
    const q: CubeQueryFilters = {
      filters: [
        { member: 'mf_users.register_date', operator: 'inDateRange', values: ['2024-01-01', '2024-12-31'] },
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    if (pred.kind !== 'group') return;
    const child = pred.children[0];
    if (child.kind !== 'leaf') return;
    expect(child.type).toBe('time');
  });

  it('assigns unique ids to every node', () => {
    const q: CubeQueryFilters = {
      filters: [
        leaf('mf_users.country', 'equals', ['VN']),
        leaf('mf_users.user_type', 'equals', ['payer']),
      ],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    if (pred.kind !== 'group') return;
    const ids = [pred.id, ...pred.children.map((c) => c.id)];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Hard-case builder shapes (translator side — predicate structure only)
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicateTree — hard-case predicate shapes', () => {
  // Measure threshold: the LLM feeds a plain gte leaf from the segmentable
  // dimension. The translator must pass it through without complaint.
  it('passes through a plain gte leaf (threshold shape)', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.ltv_vnd', 'gte', ['1000000'])],
    };
    // ltv_vnd is NOT in measureNames — it's a dimension member for this catalog entry
    const result = cubeQueryToPredicateTree(q, new Set());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    if (pred.kind !== 'group') return;
    const child = pred.children[0];
    if (child.kind !== 'leaf') return;
    expect(child.op).toBe('gte');
    expect(child.member).toBe('mf_users.ltv_vnd');
  });

  // The propose_segment tool builds percentileGte leaves directly (bypasses
  // the translator). Verify the translator does NOT reject an unknown operator
  // string that maps to nothing — it should return ok:false with reason unsupported_operator.
  it('rejects percentileGte from Cube filter (not a valid Cube operator)', () => {
    const q: CubeQueryFilters = {
      filters: [{ member: 'mf_users.ltv_vnd', operator: 'percentileGte', values: [] }],
    };
    const result = cubeQueryToPredicateTree(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch('unsupported_operator');
  });
});
