/**
 * ConceptBoard — the reactflow canvas. Lays out the 4 layer columns via the
 * pure `buildLayout`, renders one custom node type per layer (all served by
 * BaseNode, which discriminates on the node kind), and draws focus-scoped edges
 * from the focused node to its relation targets. Unconnected nodes dim when a
 * focus is active.
 *
 * A fixed header strip above the canvas labels the visible columns and hosts
 * the per-column "show N more" control (the cap lives in buildLayout, V2).
 */
import React, { useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './concept-map.css';

import { BaseNode, LAYER_VISUAL } from './nodes/base-node';
import { buildLayout, LAYER_ORDER, LAYER_TO_FILTER } from './build-layout';
import type { ConceptLayer, ConceptNode } from './concept-node';
import type { ConceptEdge } from './use-focus-edges';
import type { LayerFilter } from '../schema-cartographer/layer-filter-pills';

// One stable nodeTypes object — BaseNode renders every layer (keyed on kind).
const nodeTypes: NodeTypes = {
  field: BaseNode,
  metric: BaseNode,
  term: BaseNode,
  appSegment: BaseNode,
};

const COLUMN_HEADERS: Record<ConceptLayer, string> = {
  field: 'Data Model · Fields',
  metric: 'Metrics',
  term: 'Glossary',
  appSegment: 'Segments',
};

interface Props {
  /** Full (already search-filtered) node set. */
  graphNodes: ConceptNode[];
  /** Visible layers from the filter pills. */
  activeLayers: ReadonlySet<LayerFilter>;
  /** Focused node ref (controlled by the page). */
  focusedRef: string | null;
  /** Focus-scoped edges for the focused node. */
  edges: ConceptEdge[];
  /** Focus setter (null clears focus). */
  onFocus: (ref: string | null) => void;
}

const wrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 24,
  padding: '8px 32px',
  borderTop: '1px solid var(--border-card)',
  borderBottom: '1px solid var(--border-card)',
  background: 'var(--bg-app)',
  flexWrap: 'wrap',
};

const canvasStyle: React.CSSProperties = { flex: 1, minHeight: 0, position: 'relative' };

export function ConceptBoard({ graphNodes, activeLayers, focusedRef, edges, onFocus }: Props) {
  const [expandedLayers, setExpandedLayers] = useState<Set<ConceptLayer>>(
    () => new Set(),
  );

  const edgeTargets = useMemo(() => new Set(edges.map((e) => e.to)), [edges]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    onFocus(node.id === focusedRef ? null : node.id);
  };

  const { nodes: layoutNodes, hiddenCounts } = useMemo(
    () =>
      buildLayout(graphNodes, {
        activeLayers,
        expandedLayers,
        focusedRef,
        edgeTargets,
      }),
    [graphNodes, activeLayers, expandedLayers, focusedRef, edgeTargets],
  );

  // Inject keyboard activation per node (reactflow onNodeClick is mouse-only).
  const flowNodes = useMemo(
    () =>
      layoutNodes.map((n) => ({
        ...n,
        data: { ...n.data, onActivate: () => onFocus(n.id === focusedRef ? null : n.id) },
      })),
    [layoutNodes, focusedRef, onFocus],
  );

  const rfEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: `${e.from}__${e.to}`,
        source: e.from,
        target: e.to,
        style: { stroke: LAYER_VISUAL[e.kind].accent, strokeWidth: 1.5 },
      })),
    [edges],
  );

  const totals = useMemo(() => {
    const t: Record<ConceptLayer, number> = { field: 0, metric: 0, term: 0, appSegment: 0 };
    for (const n of graphNodes) t[n.kind] += 1;
    return t;
  }, [graphNodes]);

  const visibleLayers = LAYER_ORDER.filter((l) => activeLayers.has(LAYER_TO_FILTER[l]));

  const toggleExpand = (layer: ConceptLayer) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  return (
    <div style={wrapStyle}>
      <div style={stripStyle} role="list" aria-label="Concept map columns">
        {visibleLayers.map((layer) => {
          const hidden = hiddenCounts[layer];
          const expanded = expandedLayers.has(layer);
          return (
            <div
              key={layer}
              role="listitem"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontSize: 12 }}
            >
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: LAYER_VISUAL[layer].accent }}
              />
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{COLUMN_HEADERS[layer]}</span>
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{totals[layer]}</span>
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpand(layer)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--brand)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    padding: 0,
                  }}
                >
                  {expanded ? 'show less' : `show ${hidden} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={canvasStyle}>
        <ReactFlow
          className="concept-map-flow"
          nodes={flowNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={() => onFocus(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          panOnScroll
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background gap={20} color="var(--border-card)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
