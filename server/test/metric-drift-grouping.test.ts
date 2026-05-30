/**
 * Unit tests for root-cause grouping. Pure — no I/O.
 */
import { describe, it, expect } from 'vitest';
import { groupDriftByRootCause } from '../src/services/metric-drift-grouping.js';
import type { UnresolvedRef } from '../src/services/metric-ref-validator.js';

describe('groupDriftByRootCause', () => {
  it('collapses many cube-missing refs for one cube into a single group', () => {
    const refs: UnresolvedRef[] = Array.from({ length: 30 }, (_, i) => ({
      metricId: `m${i}`,
      ref: `mf_users.measure_${i}`,
      reason: 'cube-missing',
    }));
    const groups = groupDriftByRootCause(refs);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'cube-missing', key: 'mf_users', affectedCount: 30 });
    expect(groups[0].items).toHaveLength(30);
  });

  it('groups member-missing per full ref (distinct root cause each)', () => {
    const refs: UnresolvedRef[] = [
      { metricId: 'a', ref: 'recharge.gone', reason: 'member-missing' },
      { metricId: 'b', ref: 'recharge.gone', reason: 'member-missing' },
      { metricId: 'c', ref: 'recharge.also_gone', reason: 'member-missing' },
    ];
    const groups = groupDriftByRootCause(refs);
    expect(groups).toHaveLength(2);
    const gone = groups.find((g) => g.key === 'recharge.gone');
    expect(gone?.affectedCount).toBe(2);
  });

  it('keeps unparseable refs per-ref and orders cube-missing first', () => {
    const refs: UnresolvedRef[] = [
      { metricId: 'x', ref: 'no_dot_ref', reason: 'unparseable' },
      { metricId: 'y', ref: 'mf_users.acu', reason: 'cube-missing' },
      { metricId: 'z', ref: 'recharge.gone', reason: 'member-missing' },
    ];
    const groups = groupDriftByRootCause(refs);
    expect(groups.map((g) => g.kind)).toEqual(['cube-missing', 'member-missing', 'unparseable']);
  });

  it('de-duplicates a metric that references the same missing cube twice', () => {
    const refs: UnresolvedRef[] = [
      { metricId: 'ratio', ref: 'mf_users.a', reason: 'cube-missing' },
      { metricId: 'ratio', ref: 'mf_users.b', reason: 'cube-missing' },
    ];
    const groups = groupDriftByRootCause(refs);
    expect(groups[0].affectedMetricIds).toEqual(['ratio']);
    expect(groups[0].affectedCount).toBe(1);
    expect(groups[0].items).toHaveLength(2);
  });
});
