/**
 * recommendation-trust-guard — the citation invariant for renderable actions.
 *
 * An action is renderable only with a complete citation; the benchmark field
 * may be null (honest "no benchmark") but must be present. Blind-spot items are
 * never actions — they are rejected and re-surfaced as caveats.
 */

import { describe, it, expect } from 'vitest';
import { isCited, guardRecommendations } from '../src/tools/recommendation-trust-guard.js';
import type { ActionCitation } from '../src/tools/recommendation-citation.js';

const cited: ActionCitation = {
  sourceEngine: 'advisor/recommend',
  triggeringSignal: 'payer conversion below norm',
  benchmark: null, // null is honest, still cited
  leverFamily: 'monetization-funnel',
  defaultWrite: 'case',
  libraryMatched: false,
};

describe('isCited', () => {
  it('accepts a citation with a null benchmark field present', () => {
    expect(isCited(cited)).toBe(true);
  });
  it('rejects undefined / empty signal', () => {
    expect(isCited(undefined)).toBe(false);
    expect(isCited({ ...cited, triggeringSignal: '   ' })).toBe(false);
    expect(isCited({ ...cited, sourceEngine: '' } as ActionCitation)).toBe(false);
  });
});

describe('guardRecommendations', () => {
  it('keeps cited candidates and drops uncited ones with a reason', () => {
    const r = guardRecommendations([
      { id: 'a', citation: cited },
      { id: 'b' }, // no citation
    ]);
    expect(r.valid.map((c) => c.id)).toEqual(['a']);
    expect(r.rejected).toEqual([{ id: 'b', reason: expect.stringContaining('missing citation') }]);
    expect(r.caveats.some((c) => c.includes('withheld'))).toBe(true);
  });

  it('rejects a blind-spot candidate as not-an-action', () => {
    const r = guardRecommendations([{ id: 'cheat', citation: { ...cited, blindSpot: true } }]);
    expect(r.valid).toHaveLength(0);
    expect(r.rejected[0].reason).toContain('blind spot');
  });

  it('turns blind spots into honest caveats', () => {
    const r = guardRecommendations(
      [{ id: 'a', citation: cited }],
      [{ id: 'fps-cheat', lever: 'Cheating integrity', signal: 'cheating erodes retention' }],
    );
    expect(r.valid).toHaveLength(1);
    expect(r.caveats[0]).toContain('Cannot assess: Cheating integrity');
  });
});
