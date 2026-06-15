/**
 * Turns a draft's trace-back receipt (DraftProvenance) into the per-stage
 * "↗ verify" links the Decide screen renders — so each step links back to a
 * real artifact instead of trusting the blueprint sentence:
 *   - Target      → the real Segment detail page.
 *   - Opportunity → the lens Cube query, re-opened in the Playground.
 *
 * Pure (no React) so it can be unit-tested and reused by either Decide path.
 * Other slots (Cause is a hypothesis, Proof's numbers ride the scorecard's
 * provenance dimension, Lever's playbook has no standalone route yet) carry no
 * link this round and are simply omitted.
 */

import type { ExperimentDraft, PlaygroundLink } from '../../api/advisor';
import { buildQueryDeeplink } from '../../utils/playground-deeplink';
import type { StageKey } from './advisor-types';

export interface VerifyLink {
  stage: StageKey;
  label: string;
  /** Hash route (e.g. `#/segments/abc` or `#/build?query=…`). */
  href: string;
}

/**
 * Minimal Cube query that reproduces a lens read in the Playground. We carry
 * only members + filters (no `cube`/`source`) — this relies on the lens
 * provenance convention that members are fully cube-qualified
 * (e.g. `mf_users.avg_total_active_days`) so the builder resolves them.
 */
function evidenceQuery(link: PlaygroundLink): Record<string, unknown> {
  return {
    measures: link.measures,
    dimensions: link.dimensions ?? [],
    filters: link.filters ?? [],
    limit: link.rows && link.rows > 0 ? link.rows : 100,
  };
}

export function draftVerifyLinks(draft: ExperimentDraft): Partial<Record<StageKey, VerifyLink>> {
  const prov = draft.provenance;
  const out: Partial<Record<StageKey, VerifyLink>> = {};
  if (!prov) return out;

  if (prov.segment?.segmentId) {
    out.target = {
      stage: 'target',
      label: 'Open this segment',
      href: `#/segments/${encodeURIComponent(prov.segment.segmentId)}`,
    };
  }
  if (prov.opportunityEvidence) {
    out.opportunity = {
      stage: 'opportunity',
      label: 'See the numbers in Playground',
      href: buildQueryDeeplink(evidenceQuery(prov.opportunityEvidence)),
    };
  }
  return out;
}
