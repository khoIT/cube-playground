/**
 * Pure unit tests for metric-ref-validator. The live drift detector
 * (`scripts/check-metric-drift.ts`) wraps these with /meta fetches per game;
 * exercising the pure paths here keeps CI fast and hermetic.
 */

import { describe, expect, it } from 'vitest';

import {
  extractRefs,
  parseFqn,
  snapshotFromMeta,
  validateRefs,
} from '../src/services/metric-ref-validator.js';
import type { BusinessMetric } from '../src/types/business-metric.js';

function metric(partial: Partial<BusinessMetric>): BusinessMetric {
  return {
    id: 'm',
    label: 'M',
    description: 'd',
    tier: 1,
    domain: 'engagement',
    owner: 'x@y',
    trust: 'beta',
    formula: { type: 'measure', ref: 'cube.member' },
    ...partial,
  } as BusinessMetric;
}

describe('extractRefs', () => {
  it('returns the single ref for measure formulas', () => {
    expect(
      extractRefs(metric({ formula: { type: 'measure', ref: 'a.b' } })),
    ).toEqual(['a.b']);
  });

  it('returns numerator then denominator for ratio formulas', () => {
    expect(
      extractRefs(
        metric({
          formula: { type: 'ratio', numerator: 'a.b', denominator: 'c.d' },
        }),
      ),
    ).toEqual(['a.b', 'c.d']);
  });

  it('returns inputs (defaulting to empty) for expression formulas', () => {
    expect(
      extractRefs(
        metric({
          formula: { type: 'expression', expression: 'x + y', inputs: ['a.b'] },
        }),
      ),
    ).toEqual(['a.b']);
    expect(
      extractRefs(
        metric({ formula: { type: 'expression', expression: 'x' } }),
      ),
    ).toEqual([]);
  });
});

describe('parseFqn', () => {
  it('splits on the first dot', () => {
    expect(parseFqn('a.b.c')).toEqual({ fqn: 'a.b.c', cube: 'a', member: 'b.c' });
  });

  it('rejects values with no dot or trailing/leading dots', () => {
    expect(parseFqn('nodot')).toBeNull();
    expect(parseFqn('.member')).toBeNull();
    expect(parseFqn('cube.')).toBeNull();
  });
});

describe('snapshotFromMeta', () => {
  it('collects cubes + all (measure ∪ dimension) members', () => {
    const snap = snapshotFromMeta({
      cubes: [
        {
          name: 'mf_users',
          measures: [{ name: 'mf_users.user_count' }],
          dimensions: [{ name: 'mf_users.country' }],
        },
        {
          name: 'active_daily',
          measures: [{ name: 'active_daily.dau' }],
        },
      ],
    });
    expect(snap.cubes).toEqual(new Set(['mf_users', 'active_daily']));
    expect(snap.members).toEqual(
      new Set([
        'mf_users.user_count',
        'mf_users.country',
        'active_daily.dau',
      ]),
    );
  });
});

describe('validateRefs', () => {
  const snap = snapshotFromMeta({
    cubes: [
      {
        name: 'mf_users',
        measures: [{ name: 'mf_users.user_count' }, { name: 'mf_users.ltv_total_vnd' }],
      },
      { name: 'active_daily', measures: [{ name: 'active_daily.dau' }] },
    ],
  });

  it('returns empty when every ref resolves', () => {
    const metrics = [
      metric({ id: 'dau_ok', formula: { type: 'measure', ref: 'active_daily.dau' } }),
      metric({
        id: 'arpu_ok',
        formula: {
          type: 'ratio',
          numerator: 'mf_users.ltv_total_vnd',
          denominator: 'mf_users.user_count',
        },
      }),
    ];
    expect(validateRefs(metrics, snap)).toEqual([]);
  });

  it('flags member-missing when the cube exists but the measure does not', () => {
    // `mf_users.dau` is the canonical "broken ref" from the registry — `dau`
    // lives on active_daily, not mf_users.
    const metrics = [
      metric({ id: 'dau_broken', formula: { type: 'measure', ref: 'mf_users.dau' } }),
    ];
    expect(validateRefs(metrics, snap)).toEqual([
      { metricId: 'dau_broken', ref: 'mf_users.dau', reason: 'member-missing' },
    ]);
  });

  it('flags cube-missing when the left-side cube is not in meta', () => {
    const metrics = [
      metric({ id: 'orphan', formula: { type: 'measure', ref: 'ghost_cube.x' } }),
    ];
    expect(validateRefs(metrics, snap)).toEqual([
      { metricId: 'orphan', ref: 'ghost_cube.x', reason: 'cube-missing' },
    ]);
  });

  it('flags unparseable when ref has no dot', () => {
    const metrics = [
      metric({ id: 'badshape', formula: { type: 'measure', ref: 'nodot' } }),
    ];
    expect(validateRefs(metrics, snap)).toEqual([
      { metricId: 'badshape', ref: 'nodot', reason: 'unparseable' },
    ]);
  });

  it('reports both legs of a ratio independently', () => {
    const metrics = [
      metric({
        id: 'ratio',
        formula: {
          type: 'ratio',
          numerator: 'mf_users.dau',
          denominator: 'mf_users.user_count',
        },
      }),
    ];
    expect(validateRefs(metrics, snap)).toEqual([
      { metricId: 'ratio', ref: 'mf_users.dau', reason: 'member-missing' },
    ]);
  });
});
