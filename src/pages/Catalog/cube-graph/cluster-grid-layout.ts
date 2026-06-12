/**
 * Deterministic cluster-grid layout — TS port of model-viewer/gen_layouts.py.
 *
 * Each cluster's cubes pack into a near-square grid block; blocks sit on a
 * conceptual (col,row) anchor grid with the hub centred and the event /
 * recharge / identity clusters arranged around it, mirroring
 * cfm_data_model.svg. Pure math, no DOM — same input → same output.
 */
import type { JoinGraphNode } from './build-join-graph';

export const NODE_W = 230;
export const NODE_H = 42;
const GAP = 26; // spacing between cubes inside one cluster block
const COL_GAP = 120; // spacing between cluster blocks (room for label + edges)
const ROW_GAP = 110;
const BOX_PAD = 18; // cluster box breathing room around its block
const BOX_LABEL_H = 26; // slot above the block for the cluster label

/**
 * Conceptual (col,row) anchor per cluster. `profile` shares the hub cell as a
 * stand-in for games without mf_users; when BOTH exist it is bumped aside so
 * the two blocks never overlap.
 */
const DEFAULT_ANCHORS: Record<string, [number, number]> = {
  session: [1, 0], // session events — above the hub
  other: [0, 0], // misc — top-left
  activity: [0, 1], // activity snapshots — left
  hub: [1, 1], // user hub — centre
  profile: [1, 1], // profile (hub stand-in when mf_users is absent)
  behavior: [2, 1], // behaviour-log events — right
  mapping: [0, 2], // identity mapping — bottom-left
  bridge: [1, 2], // role bridge — below the hub
  recharge: [2, 2], // recharge / monetization — bottom-right
};

export interface NodePosition {
  x: number;
  y: number;
}

export interface ClusterRect {
  cluster: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClusterGridLayout {
  positions: Record<string, NodePosition>;
  clusterRects: ClusterRect[];
}

function gridDims(n: number): [number, number] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  return [cols, Math.ceil(n / cols)];
}

function blockSize(n: number): [number, number] {
  const [cols, rows] = gridDims(n);
  return [cols * NODE_W + (cols - 1) * GAP, rows * NODE_H + (rows - 1) * GAP];
}

export function clusterGridLayout(nodes: JoinGraphNode[]): ClusterGridLayout {
  const byCluster = new Map<string, string[]>();
  for (const n of nodes) {
    const list = byCluster.get(n.cluster);
    if (list) list.push(n.name);
    else byCluster.set(n.cluster, [n.name]);
  }

  const anchors: Record<string, [number, number]> = { ...DEFAULT_ANCHORS };
  if (byCluster.has('hub') && byCluster.has('profile')) anchors.profile = [2, 0];

  const placed = new Map<string, [number, number]>();
  const sizes = new Map<string, [number, number]>();
  for (const [cl, names] of byCluster) {
    placed.set(cl, anchors[cl] ?? [0, 0]);
    sizes.set(cl, blockSize(names.length));
  }

  // Column widths / row heights sized to the largest block in each lane.
  const cols = [...new Set([...placed.values()].map(([c]) => c))].sort((a, b) => a - b);
  const rows = [...new Set([...placed.values()].map(([, r]) => r))].sort((a, b) => a - b);
  const colW = new Map<number, number>(cols.map((c) => [c, 0]));
  const rowH = new Map<number, number>(rows.map((r) => [r, 0]));
  for (const [cl, [c, r]] of placed) {
    const [bw, bh] = sizes.get(cl) as [number, number];
    colW.set(c, Math.max(colW.get(c) ?? 0, bw));
    rowH.set(r, Math.max(rowH.get(r) ?? 0, bh));
  }
  const colX = new Map<number, number>();
  let x = 0;
  for (const c of cols) {
    colX.set(c, x);
    x += (colW.get(c) ?? 0) + COL_GAP;
  }
  const rowY = new Map<number, number>();
  let y = 0;
  for (const r of rows) {
    rowY.set(r, y);
    y += (rowH.get(r) ?? 0) + ROW_GAP;
  }

  const positions: Record<string, NodePosition> = {};
  const clusterRects: ClusterRect[] = [];
  for (const [cl, names] of byCluster) {
    const [c, r] = placed.get(cl) as [number, number];
    const [gridCols] = gridDims(names.length);
    const [bw, bh] = sizes.get(cl) as [number, number];
    // Centre the block within its grid cell.
    const ox = (colX.get(c) ?? 0) + ((colW.get(c) ?? 0) - bw) / 2;
    const oy = (rowY.get(r) ?? 0) + ((rowH.get(r) ?? 0) - bh) / 2;
    names.forEach((name, i) => {
      positions[name] = {
        x: Math.round(ox + (i % gridCols) * (NODE_W + GAP)),
        y: Math.round(oy + Math.floor(i / gridCols) * (NODE_H + GAP)),
      };
    });
    clusterRects.push({
      cluster: cl,
      x: Math.round(ox - BOX_PAD),
      y: Math.round(oy - BOX_PAD - BOX_LABEL_H),
      width: Math.round(bw + BOX_PAD * 2),
      height: Math.round(bh + BOX_PAD * 2 + BOX_LABEL_H),
    });
  }

  return { positions, clusterRects };
}
