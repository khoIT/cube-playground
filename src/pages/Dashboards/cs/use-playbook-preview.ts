/**
 * use-playbook-preview — read-only live count + per-segment sweep for the builder.
 *
 * POST /api/care/playbooks/:id/preview-count?game=  — count VIPs a candidate
 *   condition would match against live Trino (no writes). `:id` is the edited
 *   playbook's display id, or "new" for an unsaved one.
 * POST /api/care/cases/sweep?game=&playbook=         — open/lapse cases for ONE
 *   playbook (the per-segment manual sweep), reusing the full sweep machinery.
 *
 * Thin apiFetch wrappers — no React state; the builder owns loading/error.
 */

import { apiFetch } from '../../../api/api-client';
import type { ThresholdRule } from '../../../types/threshold-rule';
import type { PredicateNode } from '../../../types/segment-api';

export interface PreviewCountBody {
  condition: ThresholdRule;
  /** AND/OR filter ANDed onto the condition; null/omitted = none. */
  supplementalPredicate?: PredicateNode | null;
}

export interface PreviewCountResult {
  /** VIPs matching the candidate condition (VIP-base gated, like the sweep). */
  matched: number;
  /** Live-query wall time; absent when the count short-circuited (no predicate). */
  elapsedMs?: number;
  /** True when the VIP-base (ltv) gate was applied. */
  gated: boolean;
  /** Set when the rule yields no cohort count (ratio / empty filter). */
  note?: string;
}

export async function previewCount(
  gameId: string,
  playbookId: string,
  body: PreviewCountBody,
  signal?: AbortSignal,
): Promise<PreviewCountResult> {
  return apiFetch<PreviewCountResult>(
    `/api/care/playbooks/${encodeURIComponent(playbookId)}/preview-count`,
    { method: 'POST', query: { game: gameId }, body, signal },
  );
}

export interface SweepSegmentResult {
  game: string;
  opened: number;
  lapsed: number;
  profilesRefreshed: number;
  summaries: unknown[];
}

export async function sweepSegment(
  gameId: string,
  playbookId: string,
  signal?: AbortSignal,
): Promise<SweepSegmentResult> {
  return apiFetch<SweepSegmentResult>('/api/care/cases/sweep', {
    method: 'POST',
    query: { game: gameId, playbook: playbookId },
    signal,
  });
}
