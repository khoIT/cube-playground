/**
 * use-build-segment-from-query — powers the "Build segment from this" bridge on
 * a query-artifact card.
 *
 * On mount it runs an eager, pure segmentability probe (POST
 * /api/segments/translate-query — no Trino round-trip) so the button only
 * appears for queries that can become a segment. Two routes result:
 *
 *  - DIRECT (`segmentable:true`): the query already carries row filters →
 *    `build()` assembles a proposal pre-filled with the translated predicate.
 *  - SEED (`reason: 'breakdown_unfiltered'`): the query only groups by a
 *    dimension (e.g. a payer-tier breakdown) — its selectivity lives in a
 *    GROUP BY, not a WHERE, so a direct translation would match every user.
 *    The button still shows but routes to a value picker; `buildFromSeed()`
 *    turns the chosen value(s) into an equals/in predicate.
 *
 * Genuinely non-segmentable shapes (aggregate-only, measure filter, time-in-OR)
 * and any probe failure keep the button hidden — the bridge never shows-then-errors.
 */
import { useEffect, useState } from 'react';
import { segmentsClient } from '../../../api/segments-client';
import type { QueryArtifact } from '../../../api/chat-sse-client';
import type { SegmentProposalPayload } from '../../../api/segment-proposal';
import type { PredicateNode, LeafNode, GroupNode } from '../../../types/segment-api';

interface SeedInfo {
  /** Grouping dimension(s) the user can turn into a filter. */
  dimensions: string[];
  cube: string;
}

interface BuildSegmentState {
  /** True when the query is directly segmentable (has row filters) AND has a game. */
  segmentable: boolean;
  /** Set when the query is a breakdown that can be seeded by picking a value. */
  seed: SeedInfo | null;
  /** The inline proposal to render once built; null until then. */
  proposal: SegmentProposalPayload | null;
  /** Direct path: build from the translated predicate. */
  build: () => void;
  /** Seed path: build an equals/in predicate from chosen dimension value(s). */
  buildFromSeed: (dimension: string, values: string[]) => void;
  reset: () => void;
}

/** Trim a query title into a reasonable default segment name. */
function deriveName(title: string): string {
  const t = (title || 'Explored cohort').trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

export function useBuildSegmentFromQuery(artifact: QueryArtifact): BuildSegmentState {
  const [translated, setTranslated] = useState<{ predicate_tree: PredicateNode; cube: string } | null>(null);
  const [seed, setSeed] = useState<SeedInfo | null>(null);
  const [proposal, setProposal] = useState<SegmentProposalPayload | null>(null);

  useEffect(() => {
    // A segment needs a game to scope the create body; older artifacts without a
    // game can't be crystallized, so skip the probe entirely.
    if (!artifact.game) return;
    let cancelled = false;
    setTranslated(null);
    setSeed(null);
    segmentsClient
      .translateQuery(artifact.query)
      .then((r) => {
        if (cancelled) return;
        if (r.segmentable === true) {
          setTranslated({ predicate_tree: r.predicate_tree, cube: r.cube });
          return;
        }
        // Breakdown → offer the seed picker. Every other rejection leaves both
        // states null so the bridge stays hidden.
        if (r.reason === 'breakdown_unfiltered' && r.seed_dimensions?.length && r.cube) {
          setSeed({ dimensions: r.seed_dimensions, cube: r.cube });
        }
      })
      .catch(() => {
        /* probe failure → leave the bridge hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.query, artifact.game]);

  /** Shared proposal assembly — only the predicate/cube/disclosure differ. */
  const emit = (
    predicate_tree: PredicateNode,
    cube: string,
    disclosures: string[],
  ) => {
    if (!artifact.game) return;
    setProposal({
      type: 'segment_proposal',
      name: deriveName(artifact.title),
      game_id: artifact.game,
      cube,
      predicate_tree,
      resolved: {
        // The explored query's row count is the best pre-save size estimate; the
        // exact cohort size is computed when the segment saves and refreshes.
        estCount: artifact.previewRows ?? 0,
        population: `matching “${artifact.title}”`,
      },
      disclosures,
      suggestedVisibility: 'personal',
      source_query: {
        artifact_id: artifact.id,
        question: artifact.title,
        cube_query: artifact.query,
      },
    });
  };

  const build = () => {
    if (!translated) return;
    emit(translated.predicate_tree, translated.cube, [
      'Crystallized from your explored query — same dimension filters.',
      'Size shown is the explored query’s row count; exact cohort size is computed on save & refresh.',
    ]);
  };

  const buildFromSeed = (dimension: string, values: string[]) => {
    if (!seed || values.length === 0) return;
    // Single value → equals; multiple → in. Tier/channel/country labels are
    // strings, so the leaf type is always 'string' here.
    const leaf: LeafNode = {
      kind: 'leaf',
      id: crypto.randomUUID(),
      member: dimension,
      type: 'string',
      op: values.length === 1 ? 'equals' : 'in',
      values,
    };
    const root: GroupNode = { kind: 'group', id: crypto.randomUUID(), op: 'AND', children: [leaf] };
    const shortDim = dimension.split('.').pop() ?? dimension;
    // If the breakdown grouped by more than one dimension, the cohort is scoped
    // only by the one the user picked — disclose that the others aren't applied.
    const otherDims = seed.dimensions
      .filter((d) => d !== dimension)
      .map((d) => d.split('.').pop() ?? d);
    emit(root, seed.cube, [
      `Seeded from the breakdown: ${shortDim} ${values.length === 1 ? '=' : 'in'} ${values.join(', ')}.`,
      ...(otherDims.length
        ? [`Only ${shortDim} constrains this cohort — the breakdown’s other grouping (${otherDims.join(', ')}) is not applied.`]
        : []),
      'Size shown is the explored query’s row count; exact cohort size is computed on save & refresh.',
    ]);
  };

  const reset = () => setProposal(null);

  return {
    segmentable: translated != null,
    seed,
    proposal,
    build,
    buildFromSeed,
    reset,
  };
}
