/**
 * describePredicate — chip strings for the slice-scope notices. Focus: percentile
 * cutoffs render their { p, over } object (not [object Object]), plus AND-flatten
 * and inline OR grouping.
 */
import { describe, it, expect } from 'vitest';
import type { PredicateNode } from '../../../../types/segment-api';
import { describePredicate } from '../describe-predicate';

const leaf = (over: Record<string, unknown>): PredicateNode =>
  ({ kind: 'leaf', id: 'x', member: 'mf_users.total_active_days', type: 'number', op: 'gte', values: [3], ...over } as PredicateNode);

describe('describePredicate', () => {
  it('renders a percentile cutoff with its reference population, not [object Object]', () => {
    const chips = describePredicate(
      leaf({ op: 'percentileGte', values: [{ p: 75, over: { table: 'mf_users', column: 'ltv_total' } }] }),
    );
    expect(chips).toEqual(['total_active_days ≥ P75 of ltv_total']);
  });

  it('renders a bare percentile (no population) as P{n}', () => {
    const chips = describePredicate(leaf({ op: 'percentileLte', values: [{ p: 25 }] }));
    expect(chips).toEqual(['total_active_days ≤ P25']);
  });

  it('flattens a root AND into one chip per child', () => {
    const tree: PredicateNode = {
      kind: 'group',
      id: 'g',
      op: 'AND',
      children: [
        leaf({ member: 'mf_users.tot_spend', op: 'gt', values: [100] }),
        leaf({ member: 'recharge.os_platform', op: 'equals', values: ['ios'] }),
      ],
    } as PredicateNode;
    expect(describePredicate(tree)).toEqual(['tot_spend > 100', 'os_platform = ios']);
  });

  it('returns no chips for a null predicate', () => {
    expect(describePredicate(null)).toEqual([]);
  });
});
