/**
 * useConceptGraph — enumerates every concept node across the 4 layers from the
 * existing list sources (DRY: no new endpoints), keyed by namespaced ref.
 *
 *   fields   ← useConcepts() (cube measures + dimensions from /meta)
 *   metrics  ← useBusinessMetrics()
 *   terms    ← listGlossary()
 *   segments ← segmentsClient.list()
 *
 * Edges are NOT computed here — they are fetched lazily per focused node by
 * `useFocusEdges` (the relations endpoint is per-ref only; fanning out for
 * every node would be an N+1 storm). This hook produces only the node set +
 * a `byRef` lookup so the page can resolve an edge target back to its node.
 */

import { useEffect, useMemo, useState } from 'react';

import { useConcepts } from '../data-model-tab/use-concepts';
import { useBusinessMetrics } from '../metrics-tab/use-business-metrics';
import { listGlossary, type GlossaryTerm } from '../../../api/glossary-client';
import { segmentsClient } from '../../../api/segments-client';
import type { Segment } from '../../../types/segment-api';
import {
  type ConceptNode,
  makeFieldRef,
  makeMetricRef,
  makeSegmentRef,
  makeTermRef,
} from './concept-node';

export interface ConceptGraph {
  nodes: ConceptNode[];
  byRef: Map<string, ConceptNode>;
  loading: boolean;
  error: string | null;
}

/**
 * Minimal fetch-once hook for a list endpoint that has no shared hook of its
 * own (glossary, segments). Returns the items plus loading/error. Server-side
 * authz/visibility scoping is preserved — we do not bypass either client.
 */
function useAsyncList<T>(
  load: (signal: AbortSignal) => Promise<T[]>,
): { items: T[]; loading: boolean; error: string | null } {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    load(ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setItems(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => ctl.abort();
    // `load` is a stable module function passed by the caller; intentionally
    // run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, error };
}

const loadGlossary = (signal: AbortSignal): Promise<GlossaryTerm[]> =>
  listGlossary(signal);

// owner:'*' asks for all owners; the server still hides other users' personal
// segments, so this surfaces exactly what the viewer is permitted to see.
const loadSegments = (): Promise<Segment[]> =>
  segmentsClient.list({ owner: '*' });

export function useConceptGraph(): ConceptGraph {
  // Fields + cubes share the catalog /meta fetch (reused, not re-fetched).
  const { concepts, loading: fieldsLoading, error: fieldsError } = useConcepts();
  const {
    metrics,
    loading: metricsLoading,
    error: metricsError,
  } = useBusinessMetrics();
  const {
    items: terms,
    loading: termsLoading,
    error: termsError,
  } = useAsyncList(loadGlossary);
  const {
    items: segments,
    loading: segmentsLoading,
    error: segmentsError,
  } = useAsyncList(loadSegments);

  const nodes = useMemo<ConceptNode[]>(() => {
    const out: ConceptNode[] = [];

    // Fields: cube measures + dimensions. Cube-YAML segments (concept.type
    // 'segment') are intentionally excluded — they are NOT app segments and the
    // field layer is the queryable data-model surface.
    for (const c of concepts) {
      if (c.type !== 'measure' && c.type !== 'dimension') continue;
      out.push({
        kind: 'field',
        ref: makeFieldRef(c.fqn),
        label: c.title ?? c.name,
        sublabel: c.fqn,
      });
    }

    for (const m of metrics) {
      out.push({
        kind: 'metric',
        ref: makeMetricRef(m.id),
        label: m.label,
        sublabel: m.id,
        trust: m.trust,
      });
    }

    for (const t of terms) {
      out.push({
        kind: 'term',
        ref: makeTermRef(t.id),
        label: t.label,
        sublabel: t.category ?? undefined,
        trust: t.trust,
      });
    }

    for (const s of segments) {
      out.push({
        kind: 'appSegment',
        ref: makeSegmentRef(s.id),
        label: s.name,
        // Segments are user-built facts — certified by construction (same
        // constant the relations panel uses), not a per-row server field.
        trust: 'certified',
      });
    }

    return out;
  }, [concepts, metrics, terms, segments]);

  const byRef = useMemo(() => {
    const map = new Map<string, ConceptNode>();
    for (const n of nodes) map.set(n.ref, n);
    return map;
  }, [nodes]);

  const loading =
    fieldsLoading || metricsLoading || termsLoading || segmentsLoading;
  // Surface the first error; node enumeration degrades per-layer otherwise.
  const error =
    fieldsError || metricsError || termsError || segmentsError || null;

  return { nodes, byRef, loading, error };
}
