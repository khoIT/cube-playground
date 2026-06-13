/**
 * FloatingEdge — a reactflow edge that anchors to the closest side of each
 * cube card rather than fixed handles. Reads the two live nodes from the store,
 * computes facing endpoints (floating-edge-geometry), and draws a bezier path.
 * Stroke/markers come straight off the edge `style`/`markerStart`/`markerEnd`
 * so the crow's-foot cardinality markers keep working (they orient along the
 * path and inherit its color via `context-stroke`).
 */
import { useCallback } from 'react';
import { getBezierPath, useStore, type EdgeProps, type ReactFlowState } from 'reactflow';

import { getEdgeEndpoints } from './floating-edge-geometry';

export function FloatingEdge({ id, source, target, markerStart, markerEnd, style }: EdgeProps) {
  const sourceNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(source), [source]),
  );
  const targetNode = useStore(
    useCallback((s: ReactFlowState) => s.nodeInternals.get(target), [target]),
  );

  if (!sourceNode || !targetNode) return null;

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeEndpoints(sourceNode, targetNode);
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
  });

  return (
    <path
      id={id}
      className="react-flow__edge-path"
      d={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
    />
  );
}
