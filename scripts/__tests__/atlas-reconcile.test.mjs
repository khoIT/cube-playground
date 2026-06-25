import { describe, it, expect } from 'vitest';
import {
  computeProposals,
  indexFeaturesByPlanBasename,
  planDateFromDir,
} from '../atlas-reconcile.mjs';
import { validateAtlas } from '../../src/feature-atlas/validate-atlas.mjs';

/** Minimal valid atlas fixture builder. */
function atlasWith(features, reconciledAt = '2026-06-20') {
  return {
    version: 1,
    reconciledAt,
    surfaces: [{ id: 'surf', label: 'Surf', features }],
  };
}

describe('planDateFromDir', () => {
  it('extracts ISO date from a YYMMDD-prefixed plan dir', () => {
    expect(planDateFromDir('plans/260624-0104-liveops-monitoring-center')).toBe('2026-06-24');
    expect(planDateFromDir('260625-1106-public-segment-export-api')).toBe('2026-06-25');
  });
  it('returns null for non-conforming names', () => {
    expect(planDateFromDir('reports')).toBeNull();
    expect(planDateFromDir('templates')).toBeNull();
  });
});

describe('indexFeaturesByPlanBasename', () => {
  it('maps each linked plan basename to its feature', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'healthy', links: { plans: ['plans/260601-0000-x'] } },
    ]);
    const map = indexFeaturesByPlanBasename(atlas);
    expect(map.get('260601-0000-x').id).toBe('a');
  });
});

describe('computeProposals', () => {
  it('proposes nothing on a clean, in-sync atlas', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'healthy' },
    ]);
    const ops = computeProposals({ atlas, today: '2026-06-25' });
    expect(ops).toEqual([]);
  });

  it('proposes set-status: shipped when a linked plan moved to complete/', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'in-flight', health: 'partial', links: { plans: ['plans/260601-0000-x'] } },
    ]);
    const ops = computeProposals({
      atlas,
      completePlanBasenames: new Set(['260601-0000-x']),
      today: '2026-06-25',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'set-status', featureId: 'a', to: 'shipped' });
  });

  it('proposes set-status: shipped when plan.md frontmatter status is completed', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'planned', health: 'partial', links: { plans: ['plans/260601-0000-x'] } },
    ]);
    const ops = computeProposals({
      atlas,
      planStatus: new Map([['260601-0000-x', 'completed']]),
      today: '2026-06-25',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'set-status', featureId: 'a', to: 'shipped' });
  });

  it('does NOT re-propose shipped for an already-shipped feature', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'healthy', links: { plans: ['plans/260601-0000-x'] } },
    ]);
    const ops = computeProposals({
      atlas,
      completePlanBasenames: new Set(['260601-0000-x']),
      today: '2026-06-25',
    });
    expect(ops).toEqual([]);
  });

  it('proposes add-feature only for plan dirs created after reconciledAt', () => {
    const atlas = atlasWith([], '2026-06-20');
    const ops = computeProposals({
      atlas,
      activePlanDirs: ['260618-0000-old-plan', '260624-0000-new-plan'],
      today: '2026-06-25',
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'add-feature', suggestedId: 'new-plan', surface: null });
  });

  it('skips add-feature for plan dirs already linked to a feature', () => {
    const atlas = atlasWith(
      [{ id: 'a', label: 'A', status: 'shipped', health: 'healthy', links: { plans: ['plans/260624-0000-new-plan'] } }],
      '2026-06-20',
    );
    const ops = computeProposals({
      atlas,
      activePlanDirs: ['260624-0000-new-plan'],
      today: '2026-06-25',
    });
    expect(ops.filter((o) => o.op === 'add-feature')).toEqual([]);
  });

  it('flags a healthy shipped feature with open drawbacks as at-risk', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'healthy', drawbacks: ['something broken'] },
    ]);
    const ops = computeProposals({ atlas, today: '2026-06-25' });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'flag-health', featureId: 'a', to: 'at-risk' });
  });

  it('does not flag at-risk when drawbacks exist but health is already partial', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'partial', drawbacks: ['x'] },
    ]);
    const ops = computeProposals({ atlas, today: '2026-06-25' });
    expect(ops).toEqual([]);
  });
});

describe('validateAtlas', () => {
  it('accepts a well-formed atlas', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'shipped', health: 'healthy', directions: [{ label: 'x', effort: 'M' }] },
    ]);
    expect(validateAtlas(atlas)).toEqual({ valid: true, errors: [] });
  });

  it('accepts a reconciledAt with a quoted time + offset, rejects a malformed one', () => {
    const ok = atlasWith([{ id: 'a', label: 'A', status: 'idea', health: 'healthy' }], '2026-06-25T17:26+07:00');
    expect(validateAtlas(ok)).toEqual({ valid: true, errors: [] });
    const bad = atlasWith([{ id: 'a', label: 'A', status: 'idea', health: 'healthy' }], '2026/06/25 17:26');
    const { valid, errors } = validateAtlas(bad);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('reconciledAt'))).toBe(true);
  });

  it('rejects an invalid status/health and a bad effort', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'live', health: 'green', directions: [{ label: 'x', effort: 'HUGE' }] },
    ]);
    const { valid, errors } = validateAtlas(atlas);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('status'))).toBe(true);
    expect(errors.some((e) => e.includes('health'))).toBe(true);
    expect(errors.some((e) => e.includes('effort'))).toBe(true);
  });

  it('rejects duplicate feature ids', () => {
    const atlas = {
      version: 1,
      reconciledAt: '2026-06-25',
      surfaces: [
        { id: 's1', label: 'S1', features: [{ id: 'dup', label: 'A', status: 'idea', health: 'healthy' }] },
        { id: 's2', label: 'S2', features: [{ id: 'dup', label: 'B', status: 'idea', health: 'healthy' }] },
      ],
    };
    const { valid, errors } = validateAtlas(atlas);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('duplicate feature id'))).toBe(true);
  });

  it('rejects a direction with an unexpected key (comma-in-flow-label trap)', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'idea', health: 'healthy', directions: [{ label: 'x (y', 'z)': null, effort: 'M' }] },
    ]);
    const { valid, errors } = validateAtlas(atlas);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('unexpected key'))).toBe(true);
  });

  it('rejects a dep that references an unknown feature id', () => {
    const atlas = atlasWith([
      { id: 'a', label: 'A', status: 'idea', health: 'healthy', deps: ['ghost'] },
    ]);
    const { valid, errors } = validateAtlas(atlas);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('unknown feature id'))).toBe(true);
  });
});
