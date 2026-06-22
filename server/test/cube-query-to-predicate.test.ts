/**
 * Unit tests for the server-side cubeQueryToPredicate translator + segmentability
 * gate. Mirrors chat-service/test/cube-query-to-predicate-tree.test.ts (the two
 * MUST stay in lockstep) and adds a round-trip-to-SQL check: the translated tree,
 * when compiled by predicate-to-sql, must reproduce the query's filter semantics.
 */

import { describe, it, expect } from 'vitest';
import {
  cubeQueryToPredicate,
  type CubeQueryFilters,
} from '../src/services/cube-query-to-predicate.js';
import { predicateToSql } from '../src/services/predicate-to-sql.js';

function leaf(member: string, operator: string, values: string[] = []) {
  return { member, operator, values };
}

// ---------------------------------------------------------------------------
// Segmentability gate — reject paths (button hidden on the FE)
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicate — gate / reject paths', () => {
  it('rejects order+limit when no measure is present', () => {
    const q: CubeQueryFilters = {
      filters: [leaf('mf_users.country', 'equals', ['VN'])],
      order: { 'mf_users.recharge_vnd': 'desc' },
      limit: 100,
    };
    const result = cubeQueryToPredicate(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('order_limit_without_measure');
  });

  it('order+limit gate is measure-aware (no order_limit rejection), but a filterless query is still not a cohort', () => {
    const q: CubeQueryFilters = {
      measures: ['mf_users.recharge_vnd'],
      filters: [],
      order: { 'mf_users.recharge_vnd': 'desc' },
      limit: 100,
    };
    const result = cubeQueryToPredicate(q);
    // The order+limit gate does NOT fire (a measure is present); the rejection is
    // the empty-filters guard, not order_limit_without_measure.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_predicate');
  });

  it('rejects a measure filter', () => {
    const q: CubeQueryFilters = { filters: [leaf('mf_users.recharge_vnd', 'gte', ['1000'])] };
    const result = cubeQueryToPredicate(q, new Set(['mf_users.recharge_vnd']));
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
    const result = cubeQueryToPredicate(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('time_leaf_in_or');
  });

  it('rejects a filter with a missing member field', () => {
    const result = cubeQueryToPredicate({ filters: [{ operator: 'equals', values: ['VN'] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_member');
  });

  it('rejects an unsupported operator', () => {
    const q: CubeQueryFilters = {
      filters: [{ member: 'mf_users.country', operator: 'fuzzyMatch', values: ['VN'] }],
    };
    const result = cubeQueryToPredicate(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch('unsupported_operator');
  });
});

// ---------------------------------------------------------------------------
// Happy paths — leaf translation
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicate — happy paths', () => {
  it('translates a single equals filter to an AND group with one leaf', () => {
    const result = cubeQueryToPredicate({ filters: [leaf('mf_users.country', 'equals', ['VN'])] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pred = result.predicate;
    if (pred.kind !== 'group') return;
    expect(pred.op).toBe('AND');
    expect(pred.children).toHaveLength(1);
    const child = pred.children[0];
    if (child.kind !== 'leaf') return;
    expect(child.member).toBe('mf_users.country');
    expect(child.op).toBe('equals');
    expect(child.values).toEqual(['VN']);
  });

  it('rejects zero filters with no dimensions as no_predicate (never a silent match-all)', () => {
    const result = cubeQueryToPredicate({ filters: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_predicate');
  });

  it('rejects an unfiltered breakdown but returns the grouping dimension(s) to seed', () => {
    const result = cubeQueryToPredicate({
      measures: ['mf_users.paying_users', 'mf_users.ltv_total_vnd'],
      dimensions: ['mf_users.payer_tier'],
      order: { 'mf_users.ltv_total_vnd': 'desc' },
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('breakdown_unfiltered');
    expect(result.seedDimensions).toEqual(['mf_users.payer_tier']);
  });

  it('coerces numeric values for numeric dimensions', () => {
    const result = cubeQueryToPredicate({ filters: [leaf('mf_users.days_since_last_active', 'lte', ['30'])] });
    expect(result.ok).toBe(true);
    if (!result.ok || result.predicate.kind !== 'group') return;
    const child = result.predicate.children[0];
    if (child.kind !== 'leaf') return;
    expect(child.type).toBe('number');
    expect(child.values).toEqual([30]);
  });

  it('assigns unique ids to every node', () => {
    const result = cubeQueryToPredicate({
      filters: [leaf('mf_users.country', 'equals', ['VN']), leaf('mf_users.user_type', 'equals', ['payer'])],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.predicate.kind !== 'group') return;
    const ids = [result.predicate.id, ...result.predicate.children.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: translated tree → SQL reproduces the query's filter semantics
// ---------------------------------------------------------------------------

describe('cubeQueryToPredicate — round-trip to SQL', () => {
  it('single equals → equality WHERE', () => {
    const result = cubeQueryToPredicate({ filters: [leaf('mf_users.country', 'equals', ['VN'])] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(predicateToSql(result.predicate)).toBe("mf_users.country = 'VN'");
  });

  it('two AND leaves → AND-joined WHERE', () => {
    const result = cubeQueryToPredicate({
      filters: [leaf('mf_users.country', 'equals', ['VN']), leaf('mf_users.days_since_last_active', 'lte', ['30'])],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(predicateToSql(result.predicate)).toBe("(mf_users.country = 'VN' AND mf_users.days_since_last_active <= 30)");
  });

  it('nested OR group → parenthesised OR', () => {
    const result = cubeQueryToPredicate({
      filters: [{ or: [leaf('mf_users.country', 'equals', ['VN']), leaf('mf_users.country', 'equals', ['SG'])] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(predicateToSql(result.predicate)).toBe("(mf_users.country = 'VN' OR mf_users.country = 'SG')");
  });
});
