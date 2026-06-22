/**
 * use-build-segment-from-query — powers the "Build segment from this" bridge on
 * a query-artifact card.
 *
 * On mount it runs an eager, pure segmentability probe (POST
 * /api/segments/translate-query — no Trino round-trip) so the button only
 * appears for explored queries that can legally become a segment. Non-segmentable
 * results (aggregate-only, measure filter, time-in-OR, …) and any probe failure
 * keep the button hidden — the bridge never shows-then-errors.
 *
 * On `build()` it assembles a SegmentProposalPayload pre-filled with the
 * translated predicate and `source_query` lineage, which the caller renders
 * inline through the existing SegmentProposalCard.
 */
import { useEffect, useState } from 'react';
import { segmentsClient } from '../../../api/segments-client';
import type { QueryArtifact } from '../../../api/chat-sse-client';
import type { SegmentProposalPayload } from '../../../api/segment-proposal';
import type { PredicateNode } from '../../../types/segment-api';

interface BuildSegmentState {
  /** True only when the query is segmentable AND the artifact carries a game. */
  segmentable: boolean;
  /** The inline proposal to render once the user clicks build; null until then. */
  proposal: SegmentProposalPayload | null;
  build: () => void;
  reset: () => void;
}

/** Trim a query title into a reasonable default segment name. */
function deriveName(title: string): string {
  const t = (title || 'Explored cohort').trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

export function useBuildSegmentFromQuery(artifact: QueryArtifact): BuildSegmentState {
  const [translated, setTranslated] = useState<{ predicate_tree: PredicateNode; cube: string } | null>(null);
  const [proposal, setProposal] = useState<SegmentProposalPayload | null>(null);

  useEffect(() => {
    // A segment needs a game to scope the create body; older artifacts without a
    // game can't be crystallized, so skip the probe entirely.
    if (!artifact.game) return;
    let cancelled = false;
    segmentsClient
      .translateQuery(artifact.query)
      .then((r) => {
        if (cancelled || !r.segmentable) return;
        setTranslated({ predicate_tree: r.predicate_tree, cube: r.cube });
      })
      .catch(() => {
        /* probe failure → leave the bridge hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.query, artifact.game]);

  const build = () => {
    if (!translated || !artifact.game) return;
    setProposal({
      type: 'segment_proposal',
      name: deriveName(artifact.title),
      game_id: artifact.game,
      cube: translated.cube,
      predicate_tree: translated.predicate_tree,
      resolved: {
        // The explored query's row count is the best pre-save size estimate; the
        // exact cohort size is computed when the segment saves and refreshes.
        estCount: artifact.previewRows ?? 0,
        population: `matching “${artifact.title}”`,
      },
      disclosures: [
        'Crystallized from your explored query — same dimension filters.',
        'Size shown is the explored query’s row count; exact cohort size is computed on save & refresh.',
      ],
      suggestedVisibility: 'personal',
      source_query: {
        artifact_id: artifact.id,
        question: artifact.title,
        cube_query: artifact.query,
      },
    });
  };

  const reset = () => setProposal(null);

  return { segmentable: translated != null, proposal, build, reset };
}
