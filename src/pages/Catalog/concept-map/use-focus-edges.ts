/**
 * useFocusEdges — derives the cross-layer edges for the CURRENTLY focused node.
 *
 * Wraps the module-cached `useConceptResolution` (one shared, deduped fetch per
 * ref) and flattens its `ConceptRelations` into a flat typed edge list rooted
 * at the focused ref. Only the focused node contributes edges, so a focus
 * change costs at most one relations fetch — no whole-graph fan-out.
 *
 * When `focusedRef` is null the hook is idle (no fetch, no edges).
 */

import { useMemo } from 'react';

import { useConceptResolution } from '../../../components/concept-hover-card/use-concept-resolution';
import { layerForNamespace, parseConceptRef, type ConceptLayer } from './concept-node';

/** A directed edge from the focused node to one related concept. */
export interface ConceptEdge {
  /** The focused node's ref (edge source). */
  from: string;
  /** The related concept's ref (edge target). */
  to: string;
  /** Layer of the target — drives edge styling / target-column resolution. */
  kind: ConceptLayer;
}

export interface FocusEdges {
  edges: ConceptEdge[];
  loading: boolean;
  error: string | null;
}

export function useFocusEdges(focusedRef: string | null): FocusEdges {
  const { data, loading, error } = useConceptResolution(focusedRef);

  const edges = useMemo<ConceptEdge[]>(() => {
    if (!focusedRef || !data) return [];

    const out: ConceptEdge[] = [];
    // Every relation bucket exposes a `.ref` target; the bucket itself implies
    // the layer, but we derive it from the target's namespace so a node from
    // any bucket lands in the right column even if buckets evolve.
    const targets = [
      ...data.fields,
      ...data.metrics,
      ...data.terms,
      ...data.segments,
    ];
    for (const t of targets) {
      const parsed = parseConceptRef(t.ref);
      const kind = parsed ? layerForNamespace(parsed.namespace) : null;
      if (!kind) continue; // skip unknown namespaces rather than mis-place them
      out.push({ from: focusedRef, to: t.ref, kind });
    }
    return out;
  }, [focusedRef, data]);

  return { edges, loading, error: error ? error.message : null };
}
