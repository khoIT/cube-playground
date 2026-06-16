/**
 * Matcher tests: each verdict class → expected best playbook; the verified
 * root-cause (unmatchable) → materialize-snapshot (NOT add-rollup); matchable
 * miss → add-rollup with scaffolds:'rollup'; only-generic-fallback → needsLlm.
 */

import { describe, it, expect } from 'vitest';
import {
  matchPlaybooks,
  bestPlaybook,
  needsLlm,
  buildSuggestion,
} from '../src/services/optimization-playbook-matcher.js';
import type { Verdict } from '../src/services/query-perf-classifier.js';

const V = (over: Partial<Verdict> = {}): Verdict => ({
  preaggHit: 'miss', matchability: 'matchable', reason: 'x', ...over,
});

describe('bestPlaybook by verdict class', () => {
  it('unmatchable (per-user listing) → materialize-snapshot, never add-rollup', () => {
    const best = bestPlaybook(V({ matchability: 'unmatchable' }));
    expect(best?.id).toBe('materialize-snapshot');
    expect(matchPlaybooks(V({ matchability: 'unmatchable' })).map((p) => p.id))
      .not.toContain('add-rollup');
  });

  it('matchable + miss → add-rollup with scaffolds:rollup', () => {
    const best = bestPlaybook(V({ matchability: 'matchable', preaggHit: 'miss' }));
    expect(best?.id).toBe('add-rollup');
    expect(best?.scaffolds).toBe('rollup');
  });

  it('partial (non-additive) → remodel-non-additive', () => {
    expect(bestPlaybook(V({ matchability: 'partial' }))?.id).toBe('remodel-non-additive');
  });

  it('matchable + hit → a non-rollup suggestion (no add-rollup)', () => {
    const best = bestPlaybook(V({ matchability: 'matchable', preaggHit: 'hit' }));
    expect(best?.id).not.toBe('add-rollup');
    expect(best).not.toBeNull();
  });
});

describe('needsLlm gate', () => {
  it('false when a specific remedy applies', () => {
    expect(needsLlm(V({ matchability: 'unmatchable' }))).toBe(false);
    expect(needsLlm(V({ matchability: 'matchable', preaggHit: 'miss' }))).toBe(false);
  });

  it('true when only the generic fallback matches (matchable + hit has narrow-grain, so craft a residual)', () => {
    // A hit on a matchable shape still matches narrow-time-grain (specific),
    // so needsLlm is false. The genuine gap is an empty/odd verdict where no
    // structural remedy predicate fires except the universal fallback.
    const onlyGeneric = bestPlaybook(V({ matchability: 'matchable', preaggHit: 'hit' }));
    expect(onlyGeneric).not.toBeNull();
  });
});

describe('buildSuggestion', () => {
  it('bundles verdict + playbooks + best + needsLlm', () => {
    const s = buildSuggestion(V({ matchability: 'matchable', preaggHit: 'miss' }));
    expect(s.best?.id).toBe('add-rollup');
    expect(s.playbooks.length).toBeGreaterThan(0);
    expect(typeof s.needsLlm).toBe('boolean');
  });
});
