/**
 * build-layout — pure transform from ConceptNode[] to reactflow Node[] with
 * deterministic positions. No auto-layout engine: the map is a fixed 4-column
 * grid (Fields · Metrics · Glossary · Segments), so positions are hand-computed
 * and fully unit-testable without mounting reactflow.
 *
 * Also applies the layer filter (hidden layers drop out and visible columns
 * close the gap) and the per-layer cap (~50 nodes; excess is summarised as a
 * `hiddenCount` the board renders as a "show N more" affordance). Focus/dim
 * flags are baked into each node's `data` so the custom node component can
 * style itself without re-deriving graph state.
 */

import type { Node } from 'reactflow';

import type { ConceptLayer, ConceptNode } from './concept-node';
import type { LayerFilter } from '../schema-cartographer/layer-filter-pills';

/** Left-to-right column order. */
export const LAYER_ORDER: readonly ConceptLayer[] = [
  'field',
  'metric',
  'term',
  'appSegment',
];

/** Concept layer → the LayerFilter key the pills/legend use. */
export const LAYER_TO_FILTER: Record<ConceptLayer, LayerFilter> = {
  field: 'fields',
  metric: 'metrics',
  term: 'glossary',
  appSegment: 'segments',
};

/** Default per-layer node cap before "show more" (Decision V2). */
export const DEFAULT_LAYER_CAP = 50;

// Geometry — deterministic grid. A layout change is a constant change here,
// covered by unit tests, never eyeballed.
export const COLUMN_WIDTH = 300;
export const ROW_PITCH = 72;
export const COLUMN_TOP = 0;

/** Payload carried on each reactflow node, consumed by the custom node types. */
export interface ConceptNodeData {
  node: ConceptNode;
  /** Dimmed when a focus is active and this node is neither it nor a neighbor. */
  dimmed: boolean;
  /** True for the currently focused node. */
  focused: boolean;
  /**
   * Keyboard activation (Enter/Space). Injected by the board after layout —
   * reactflow's onNodeClick is mouse-only, so the card needs its own handler
   * for keyboard operability. Absent in the pure layout output.
   */
  onActivate?: () => void;
}

export interface BuildLayoutOptions {
  /** Visible layers (pills). A layer not in the set is hidden and its column collapses. */
  activeLayers: ReadonlySet<LayerFilter>;
  /** Layers whose cap has been lifted via "show more". */
  expandedLayers?: ReadonlySet<ConceptLayer>;
  /** Currently focused node ref (drives focus + dim flags). */
  focusedRef?: string | null;
  /** Refs connected to the focused node (kept un-dimmed). */
  edgeTargets?: ReadonlySet<string>;
  /** Override the per-layer cap (tests / future tuning). */
  cap?: number;
}

export interface LayoutResult {
  nodes: Node<ConceptNodeData>[];
  /** Per-layer count of nodes hidden by the cap (0 when none hidden). */
  hiddenCounts: Record<ConceptLayer, number>;
}

const emptyHidden = (): Record<ConceptLayer, number> => ({
  field: 0,
  metric: 0,
  term: 0,
  appSegment: 0,
});

export function buildLayout(
  nodes: ConceptNode[],
  opts: BuildLayoutOptions,
): LayoutResult {
  const {
    activeLayers,
    expandedLayers,
    focusedRef = null,
    edgeTargets,
    cap = DEFAULT_LAYER_CAP,
  } = opts;

  const hiddenCounts = emptyHidden();
  const out: Node<ConceptNodeData>[] = [];

  // Bucket nodes by layer, preserving input order (stable, deterministic).
  const byLayer: Record<ConceptLayer, ConceptNode[]> = {
    field: [],
    metric: [],
    term: [],
    appSegment: [],
  };
  for (const n of nodes) byLayer[n.kind].push(n);

  // Visible layers, in canonical order — column index counts only visible
  // layers so a hidden layer doesn't leave a gap.
  const visibleLayers = LAYER_ORDER.filter((layer) =>
    activeLayers.has(LAYER_TO_FILTER[layer]),
  );

  visibleLayers.forEach((layer, colIndex) => {
    const all = byLayer[layer];
    const expanded = expandedLayers?.has(layer) ?? false;
    const shown = expanded ? all : all.slice(0, cap);
    hiddenCounts[layer] = all.length - shown.length;

    const x = colIndex * COLUMN_WIDTH;
    shown.forEach((node, rowIndex) => {
      const focused = focusedRef != null && node.ref === focusedRef;
      const dimmed =
        focusedRef != null &&
        !focused &&
        !(edgeTargets?.has(node.ref) ?? false);
      out.push({
        id: node.ref,
        type: node.kind,
        position: { x, y: COLUMN_TOP + rowIndex * ROW_PITCH },
        data: { node, dimmed, focused },
      });
    });
  });

  return { nodes: out, hiddenCounts };
}
