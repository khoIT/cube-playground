/**
 * ConceptMapPage — the standalone cross-layer concept map (Data Model subtab
 * `/catalog/data-model/concept-map`). This phase builds the shell: page header,
 * legend, toolbar (search + layer pills), and the status states. The node-graph
 * board fills the slot below in the next phase.
 *
 * Default export so the Catalog dispatch can `React.lazy` it — keeping the
 * reactflow canvas (pulled in by the board) out of the main Catalog bundle.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Network } from 'lucide-react';

import { useConceptGraph } from './use-concept-graph';
import { useFocusEdges } from './use-focus-edges';
import { useMapFocus } from './use-map-focus';
import { ConceptBoard } from './concept-board';
import { ConceptMapLegend, type LayerCounts } from './concept-map-legend';
import { LAYER_TO_FILTER } from './build-layout';
import { CartographerSearch } from '../schema-cartographer/cartographer-search';
import {
  LayerFilterPills,
  ALL_LAYERS,
  type LayerFilter,
} from '../schema-cartographer/layer-filter-pills';

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--bg-app)',
};

const headerStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 1320,
  width: '100%',
  margin: '0 auto',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  fontFamily: 'var(--font-sans)',
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const searchWrapStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 220,
  maxWidth: 360,
};

const statusStyle = (kind: 'info' | 'error'): React.CSSProperties => ({
  padding: '16px 32px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  color: kind === 'error' ? 'var(--danger)' : 'var(--text-muted)',
});

// Board slot — filled with the reactflow canvas in the next phase.
const boardSlotStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
};

const placeholderStyle: React.CSSProperties = {
  margin: 'auto',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--text-muted)',
};

function countByLayer(
  nodes: ReturnType<typeof useConceptGraph>['nodes'],
): LayerCounts {
  const counts: LayerCounts = { fields: 0, metrics: 0, glossary: 0, segments: 0 };
  for (const n of nodes) {
    if (n.kind === 'field') counts.fields += 1;
    else if (n.kind === 'metric') counts.metrics += 1;
    else if (n.kind === 'term') counts.glossary += 1;
    else if (n.kind === 'appSegment') counts.segments += 1;
  }
  return counts;
}

export function ConceptMapPage() {
  const { nodes, loading, error } = useConceptGraph();
  const [search, setSearch] = useState('');
  const [activeLayers, setActiveLayers] = useState<Set<LayerFilter>>(
    () => new Set(ALL_LAYERS),
  );
  // Focus lives in the URL (?focus=) — deep-linkable, back/forward-safe.
  const [focusedRef, setFocusedRef] = useMapFocus();
  const { edges } = useFocusEdges(focusedRef);

  // Search narrows across all layers (case-insensitive label/sublabel match).
  const visibleNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        (n.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [nodes, search]);

  // Refs actually on screen = search-visible AND in an active layer.
  const displayableRefs = useMemo(() => {
    const set = new Set<string>();
    for (const n of visibleNodes) {
      if (activeLayers.has(LAYER_TO_FILTER[n.kind])) set.add(n.ref);
    }
    return set;
  }, [visibleNodes, activeLayers]);

  // If search/filter hides the focused node, clear focus so no orphan edges
  // dangle (mirrors the Cartographer guard).
  useEffect(() => {
    if (focusedRef && !displayableRefs.has(focusedRef)) setFocusedRef(null);
  }, [focusedRef, displayableRefs, setFocusedRef]);

  const counts = useMemo(() => countByLayer(visibleNodes), [visibleNodes]);
  const isEmpty = !loading && !error && visibleNodes.length === 0;

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <span style={eyebrowStyle}>Catalog · Concept Map</span>
        <div style={titleRowStyle}>
          <Network size={20} color="var(--brand)" aria-hidden="true" />
          <h1 style={titleStyle}>Concept Map</h1>
        </div>

        <ConceptMapLegend counts={counts} />

        <div style={toolbarStyle}>
          <div style={searchWrapStyle}>
            <CartographerSearch
              value={search}
              onChange={setSearch}
              placeholder="Search fields, metrics, terms, segments…"
            />
          </div>
          <LayerFilterPills active={activeLayers} onChange={setActiveLayers} />
        </div>
      </div>

      {error && <div style={statusStyle('error')}>Failed to load concepts: {error}</div>}
      {loading && <div style={statusStyle('info')}>Loading concepts…</div>}

      <div style={boardSlotStyle}>
        {isEmpty && <div style={placeholderStyle}>No concepts to display yet.</div>}
        {!loading && !error && !isEmpty && (
          <ConceptBoard
            graphNodes={visibleNodes}
            activeLayers={activeLayers}
            focusedRef={focusedRef}
            edges={edges}
            onFocus={setFocusedRef}
          />
        )}
      </div>
    </div>
  );
}

export default ConceptMapPage;
