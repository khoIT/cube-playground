import { describe, it, expect } from 'vitest';
import { draftVerifyLinks } from '../draft-provenance-links';
import type { ExperimentDraft } from '../../../api/advisor';

/** Minimal draft carrying only the fields the verify-link helper reads. */
function draft(provenance?: ExperimentDraft['provenance']): ExperimentDraft {
  return { provenance } as unknown as ExperimentDraft;
}

describe('draftVerifyLinks', () => {
  it('returns no links when the draft has no provenance receipt', () => {
    expect(draftVerifyLinks(draft())).toEqual({});
  });

  it('links Target to the real segment detail page', () => {
    const links = draftVerifyLinks(draft({ segment: { segmentId: 'seg 42', gameId: 'cfm_vn' } }));
    expect(links.target?.href).toBe('#/segments/seg%2042');
    expect(links.opportunity).toBeUndefined();
  });

  it('links Opportunity to a re-runnable Playground query from the evidence link', () => {
    const links = draftVerifyLinks(
      draft({
        segment: { segmentId: 'seg-1', gameId: 'cfm_vn' },
        opportunityEvidence: { measures: ['mf_users.avg_total_active_days'], dimensions: ['mf_users.os'], source: 'L' },
      }),
    );
    expect(links.opportunity?.href.startsWith('#/build?query=')).toBe(true);
    const decoded = JSON.parse(decodeURIComponent(links.opportunity!.href.split('query=')[1]));
    expect(decoded.measures).toContain('mf_users.avg_total_active_days');
    expect(decoded.dimensions).toContain('mf_users.os');
  });

  it('does not link Opportunity when no evidence query was carried', () => {
    const links = draftVerifyLinks(draft({ segment: { segmentId: 'seg-1', gameId: 'cfm_vn' } }));
    expect(links.opportunity).toBeUndefined();
  });
});
