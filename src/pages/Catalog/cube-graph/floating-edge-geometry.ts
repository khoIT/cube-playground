/**
 * Floating-edge geometry — picks the connection point on each cube card's
 * perimeter that faces the other card, so a join line leaves and enters from
 * whichever side is closest instead of being pinned to fixed Left/Right
 * handles. This is the standalone model-viewer's trick: fewer crossings, lines
 * never shoot out the wrong side of a card and cut back across it.
 *
 * Pure math over node rectangles (no React) — the FloatingEdge component feeds
 * it the two live reactflow nodes and renders the resulting bezier path.
 */
import { Position, type Node } from 'reactflow';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Live node → absolute rect, tolerating pre-measure frames (w/h undefined). */
function rectOf(node: Node): Rect {
  const pos = node.positionAbsolute ?? node.position;
  return { x: pos.x, y: pos.y, w: node.width ?? 0, h: node.height ?? 0 };
}

/**
 * Point where the line from `node`'s centre toward `other`'s centre crosses
 * `node`'s border. Standard ellipse-style intersection used by reactflow's
 * floating-edges example, computed on the node's bounding rectangle.
 */
function intersection(node: Rect, other: Rect): { x: number; y: number } {
  const w = node.w / 2;
  const h = node.h / 2;
  const cx = node.x + w;
  const cy = node.y + h;
  const ox = other.x + other.w / 2;
  const oy = other.y + other.h / 2;

  if (w === 0 || h === 0) return { x: cx, y: cy };

  const xx1 = (ox - cx) / (2 * w) - (oy - cy) / (2 * h);
  const yy1 = (ox - cx) / (2 * w) + (oy - cy) / (2 * h);
  const denom = Math.abs(xx1) + Math.abs(yy1);
  if (denom === 0) return { x: cx, y: cy };
  const a = 1 / denom;
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return { x: w * (xx3 + yy3) + cx, y: h * (-xx3 + yy3) + cy };
}

/** Which side of `node` the intersection point sits on (for path tangents). */
function sideOf(node: Rect, point: { x: number; y: number }): Position {
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  if (px <= Math.round(node.x) + 1) return Position.Left;
  if (px >= Math.round(node.x + node.w) - 1) return Position.Right;
  if (py <= Math.round(node.y) + 1) return Position.Top;
  return Position.Bottom;
}

export interface EdgeEndpoints {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

/** Endpoints + facing sides for a join line between two cube cards. */
export function getEdgeEndpoints(source: Node, target: Node): EdgeEndpoints {
  const s = rectOf(source);
  const t = rectOf(target);
  const sp = intersection(s, t);
  const tp = intersection(t, s);
  return {
    sx: sp.x,
    sy: sp.y,
    tx: tp.x,
    ty: tp.y,
    sourcePos: sideOf(s, sp),
    targetPos: sideOf(t, tp),
  };
}
