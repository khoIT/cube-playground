/**
 * Unit tests for per-game applicability. Pure — no I/O.
 */
import { describe, it, expect } from 'vitest';
import { applicableForGame, filterApplicable } from '../src/services/metric-applicability.js';
import type { BusinessMetric } from '../src/types/business-metric.js';
import type { UnresolvedRef } from '../src/services/metric-ref-validator.js';

function metric(id: string, applicability?: BusinessMetric['meta']): BusinessMetric {
  return {
    id,
    label: id,
    description: id,
    tier: 1,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'draft',
    formula: { type: 'measure', ref: `${id}.x` },
    ...(applicability ? { meta: applicability } : {}),
  } as BusinessMetric;
}

describe('applicableForGame', () => {
  it('defaults to applicable when no entry exists for the game', () => {
    expect(applicableForGame(metric('a'), 'ptg')).toBe(true);
    expect(applicableForGame(metric('a', { applicability: [{ game: 'cfm', applicable: false, at: '2026-01-01T00:00:00.000Z' }] }), 'ptg')).toBe(true);
  });

  it('latest entry per game wins', () => {
    const m = metric('cpi', {
      applicability: [
        { game: 'ptg', applicable: false, at: '2026-01-01T00:00:00.000Z' },
        { game: 'ptg', applicable: true, at: '2026-02-01T00:00:00.000Z' },
      ],
    });
    expect(applicableForGame(m, 'ptg')).toBe(true);
  });

  it('honors a later N/A flip', () => {
    const m = metric('cpi', {
      applicability: [
        { game: 'ptg', applicable: true, at: '2026-01-01T00:00:00.000Z' },
        { game: 'ptg', applicable: false, at: '2026-03-01T00:00:00.000Z' },
      ],
    });
    expect(applicableForGame(m, 'ptg')).toBe(false);
  });
});

describe('filterApplicable', () => {
  it('drops refs whose metric is N/A for the game; keeps unknown metric ids', () => {
    const cpi = metric('cpi', { applicability: [{ game: 'ptg', applicable: false, at: '2026-01-01T00:00:00.000Z' }] });
    const dau = metric('dau');
    const byId = new Map([[cpi.id, cpi], [dau.id, dau]]);
    const refs: UnresolvedRef[] = [
      { metricId: 'cpi', ref: 'marketing.cost', reason: 'cube-missing' },
      { metricId: 'dau', ref: 'mf_users.dau', reason: 'cube-missing' },
      { metricId: 'unknown', ref: 'x.y', reason: 'cube-missing' },
    ];
    const out = filterApplicable(refs, byId, 'ptg');
    expect(out.map((r) => r.metricId)).toEqual(['dau', 'unknown']);
  });
});
