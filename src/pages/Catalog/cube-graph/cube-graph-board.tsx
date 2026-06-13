/**
 * CubeGraphBoard — the reactflow canvas for the cube join graph. Converts the
 * pure builder output (graph + cluster-grid layout) into reactflow nodes and
 * edges: cluster boxes first (background, non-interactive), then cube cards
 * at absolute layout positions. Selecting a cube highlights its edges with
 * `keyLabel · cardinality` labels and dims the rest, mirroring the
 * model-viewer interaction grammar.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './cube-graph.css';

import type { EdgeCardinality, JoinGraph } from './build-join-graph';
import { EdgeCardinalityMarkers, markersForCardinality } from './edge-cardinality-markers';
import { FloatingEdge } from './floating-edge';
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
// Floating edges anchor to whichever side of each card faces the other cube,
// so lines take the shortest route and rarely cut back across a card.
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

interface Props {
  graph: JoinGraph;
  layout: ClusterGridLayout;
  /** Selected cube name (controlled by the page; null = none). */
  selected: string | null;
  /** Cube names that should render dimmed (search miss / outside view). */
  dimmed: ReadonlySet<string>;
  /** True while the detail pane is open beside the board (drives the re-fit). */
  paneOpen: boolean;
  onSelect: (name: string | null) => void;
}

const canvasStyle: React.CSSProperties = { flex: 1, minHeight: 0, position: 'relative' };

export function CubeGraphBoard({ graph, layout, selected, dimmed, paneOpen, onSelect }: Props) {
  // Opening the pane narrows the canvas (flex sibling); re-fit so the whole
  // graph reflows into the remaining width instead of hiding behind the pane.
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const skipFirstFit = useRef(true);
  useEffect(() => {
    if (skipFirstFit.current) {
      skipFirstFit.current = false; // initial framing comes from the `fitView` prop
      return;
    }
    // Wait a frame so the flex width change is applied before reactflow measures.
    const raf = requestAnimationFrame(() => {
      rfInstance.current?.fitView({ padding: 0.18, duration: 350 });
    });
    return () => cancelAnimationFrame(raf);
  }, [paneOpen]);
  const lintByNode = useMemo(() => {
    const map = new Map<string, CubeLint>();
    for (const m of graph.lints.missingTarget) map.set(m.source, 'missing-target');
    // Isolation supersedes: a cube with ONLY a dangling join is both, and
    // "isolated" is the more actionable signal on the card.
    for (const name of graph.lints.isolated) map.set(name, 'isolated');
    return map;
  }, [graph.lints]);

  // Source of truth for node identity, data, and *initial* layout positions.
  const computedNodes = useMemo<Node[]>(() => {
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
      // Cards are freely draggable so users can rearrange the canvas (same as
      // the standalone model viewer); the layout is the starting point only.
      draggable: true,
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

  // Hold nodes in state so drag positions persist. When the computed nodes
  // change (selection / dim / lint), re-apply the latest data but keep any
  // position the user has dragged a card to. A new graph (game/workspace
  // switch) remounts the board via its key, resetting to the fresh layout.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(computedNodes);
  useEffect(() => {
    setRfNodes((prev) => {
      const draggedPos = new Map(prev.map((n) => [n.id, n.position]));
      return computedNodes.map((n) =>
        n.type === 'cubeNode' && draggedPos.has(n.id)
          ? { ...n, position: draggedPos.get(n.id) ?? n.position }
          : n,
      );
    });
  }, [computedNodes, setRfNodes]);

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
        // An edge always keeps its source cluster's color — selecting a cube
        // only lights its incident joins (full opacity) and dims the rest; it
        // never recolors them (mirrors the standalone model viewer).
        const base = accentByNode.get(e.source) ?? 'var(--border-strong)';
        const opacity = hot ? 1 : anySelected ? 0.18 : 0.85;
        // Cardinality is shown as crow's-foot / bar ER markers at the edge
        // ends (many vs one) instead of overlapping text — readable at a glance
        // and never collides; the full `col → col` mapping lives in the drawer.
        const { markerStart, markerEnd } = markersForCardinality(e.cardinality as EdgeCardinality);
        return {
          id: e.id,
          type: 'floating',
          source: e.source,
          target: e.target,
          style: { stroke: base, strokeWidth: hot ? 2.5 : 1.5, opacity },
          markerStart,
          markerEnd,
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
      <EdgeCardinalityMarkers />
      <ReactFlow
        className="cube-graph-flow"
        nodes={rfNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onInit={(inst) => {
          rfInstance.current = inst;
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
