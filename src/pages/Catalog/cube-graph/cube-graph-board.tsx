/**
 * CubeGraphBoard — the reactflow canvas for the cube join graph. Converts the
 * pure builder output (graph + cluster-grid layout) into reactflow nodes and
 * edges: cluster boxes first (background, non-interactive), then cube cards
 * at absolute layout positions. Selecting a cube highlights its edges with
 * `keyLabel · cardinality` labels and dims the rest, mirroring the
 * model-viewer interaction grammar.
 */
import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './cube-graph.css';

import type { JoinGraph } from './build-join-graph';
import type { ClusterGridLayout } from './cluster-grid-layout';
import {
  ClusterBoxNode,
  CubeNode,
  clusterAccent,
  type ClusterBoxData,
  type CubeLint,
  type CubeNodeData,
} from './cube-node';

const nodeTypes: NodeTypes = { cubeNode: CubeNode, clusterBox: ClusterBoxNode };

interface Props {
  graph: JoinGraph;
  layout: ClusterGridLayout;
  /** Selected cube name (controlled by the page; null = none). */
  selected: string | null;
  /** Cube names that should render dimmed (search miss / outside view). */
  dimmed: ReadonlySet<string>;
  onSelect: (name: string | null) => void;
}

const canvasStyle: React.CSSProperties = { flex: 1, minHeight: 0, position: 'relative' };

export function CubeGraphBoard({ graph, layout, selected, dimmed, onSelect }: Props) {
  const lintByNode = useMemo(() => {
    const map = new Map<string, CubeLint>();
    for (const m of graph.lints.missingTarget) map.set(m.source, 'missing-target');
    // Isolation supersedes: a cube with ONLY a dangling join is both, and
    // "isolated" is the more actionable signal on the card.
    for (const name of graph.lints.isolated) map.set(name, 'isolated');
    return map;
  }, [graph.lints]);

  const nodes = useMemo<Node[]>(() => {
    const boxes: Node<ClusterBoxData>[] = layout.clusterRects.map((r) => ({
      id: `cluster:${r.cluster}`,
      type: 'clusterBox',
      position: { x: r.x, y: r.y },
      data: { cluster: r.cluster, accent: clusterAccent(r.cluster), width: r.width, height: r.height },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
    const cards: Node<CubeNodeData>[] = graph.nodes.map((n) => ({
      id: n.name,
      type: 'cubeNode',
      position: layout.positions[n.name] ?? { x: 0, y: 0 },
      data: {
        label: n.name,
        description: n.description,
        accent: clusterAccent(n.cluster),
        dimmed: dimmed.has(n.name),
        selected: n.name === selected,
        lint: lintByNode.get(n.name) ?? null,
      },
    }));
    return [...boxes, ...cards];
  }, [graph.nodes, layout, selected, dimmed, lintByNode]);

  // Each cube name → its cluster accent, so an edge can take the color of the
  // cluster it originates from (the legend then reads the arrows too).
  const accentByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph.nodes) map.set(n.name, clusterAccent(n.cluster));
    return map;
  }, [graph.nodes]);

  const edges = useMemo<Edge[]>(() => {
    const anySelected = selected != null;
    return graph.edges
      .filter((e) => !e.missingTarget) // no node to land on — surfaced via lints
      .map((e) => {
        const hot = anySelected && (e.source === selected || e.target === selected);
        // Hot edges go brand so the focused cube's joins pop; otherwise the
        // edge wears its source cluster's color and dims when something else
        // is selected.
        const base = accentByNode.get(e.source) ?? 'var(--border-strong)';
        const stroke = hot ? 'var(--brand)' : base;
        const opacity = hot ? 1 : anySelected ? 0.18 : 0.85;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: hot ? [e.keyLabel, e.cardinality].filter(Boolean).join(' · ') : undefined,
          style: { stroke, strokeWidth: hot ? 2 : 1.5, opacity },
          // Arrowhead points at the join target (N:1 → the hub), giving the
          // graph an explicit direction like the standalone model viewer.
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: 16,
            height: 16,
          },
          zIndex: hot ? 1 : 0,
        };
      });
  }, [graph.edges, selected, accentByNode]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    if (node.type !== 'cubeNode') return;
    onSelect(node.id === selected ? null : node.id);
  };

  return (
    <div style={canvasStyle}>
      <ReactFlow
        className="cube-graph-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
      >
        <Background gap={20} color="var(--border-card)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
