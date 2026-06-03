/**
 * Client for the concepts relations endpoint.
 *
 * GET /api/concepts/:namespace/:id/relations
 *
 * Namespace ∈ business_metrics | data_model | segments.
 * The `ref` parameter is the full slash-separated concept ref
 * (e.g. "business_metrics/dau", "data_model/mf_users.payer_tier").
 * The id segment may contain dots, so we split on the first slash only.
 *
 * Returns the cross-layer resolved refs for a concept: related fields,
 * metrics, glossary terms, and segments — used by the hover-card to show
 * typed actions that require server-side index traversal.
 */

import { apiFetch } from './api-client';

export interface ConceptRelatedField {
  ref: string;
  member: string;
}

export interface ConceptRelatedMetric {
  ref: string;
  id: string;
  label: string;
  trust: 'draft' | 'certified' | 'deprecated';
}

export interface ConceptRelatedTerm {
  ref: string;
  id: string;
  label: string;
  trust: 'draft' | 'certified' | 'deprecated';
}

export interface ConceptRelatedSegment {
  ref: string;
  id: string;
  name: string;
}

export interface ConceptRelations {
  ref: string;
  fields: ConceptRelatedField[];
  metrics: ConceptRelatedMetric[];
  terms: ConceptRelatedTerm[];
  segments: ConceptRelatedSegment[];
}

// ── Promote endpoint ─────────────────────────────────────────────────────────

export type PromoteTargetType = 'term' | 'metric' | 'both';

export interface PromoteResult {
  term?: Record<string, unknown>;
  metric?: Record<string, unknown>;
}

/**
 * Promotes a segment into a draft glossary term and/or a draft metric stub.
 * Returns the created artifacts. Throws SegmentApiError on non-2xx.
 */
export async function promoteSegmentToConcept(
  segmentId: string,
  targetType: PromoteTargetType = 'term',
): Promise<PromoteResult> {
  return apiFetch<PromoteResult>('/api/concepts/promote', {
    method: 'POST',
    body: { sourceType: 'segment', sourceId: segmentId, targetType },
  });
}

// ── Relations endpoint ────────────────────────────────────────────────────────

/**
 * Fetches cross-layer relations for a concept ref.
 *
 * `ref` is the full concept ref: "<namespace>/<id>" where namespace ∈
 * business_metrics | data_model | segments. The id may contain dots.
 *
 * Throws a SegmentApiError (from apiFetch) when the server returns a
 * non-2xx response so callers can distinguish 404 (unknown concept) from
 * network errors.
 */
export async function getConceptRelations(
  ref: string,
  signal?: AbortSignal,
): Promise<ConceptRelations> {
  // Split on first slash only — id segment may contain dots or slashes.
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`Invalid concept ref — expected "<namespace>/<id>", got: ${ref}`);
  }
  const namespace = ref.slice(0, slashIdx);
  const id = ref.slice(slashIdx + 1);

  return apiFetch<ConceptRelations>(
    `/api/concepts/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/relations`,
    { signal },
  );
}
