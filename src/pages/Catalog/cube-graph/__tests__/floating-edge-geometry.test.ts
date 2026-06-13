import { describe, expect, it } from 'vitest';
import { Position, type Node } from 'reactflow';

import { getEdgeEndpoints } from '../floating-edge-geometry';

/** Minimal reactflow node with an absolute position + measured size. */
function node(x: number, y: number, w = 230, h = 48): Node {
  return {
    id: `${x},${y}`,
    position: { x, y },
    positionAbsolute: { x, y },
    width: w,
    height: h,
    data: {},
  } as Node;
}

describe('getEdgeEndpoints — connect from the closest side', () => {
  it('two cards side by side connect right→left', () => {
    const source = node(0, 0);
    const target = node(400, 0); // directly to the right
    const { sourcePos, targetPos } = getEdgeEndpoints(source, target);
    expect(sourcePos).toBe(Position.Right);
    expect(targetPos).toBe(Position.Left);
  });

  it('a card above its target exits the bottom and enters the top', () => {
    const source = node(0, 0);
    const target = node(0, 300); // directly below
    const { sourcePos, targetPos } = getEdgeEndpoints(source, target);
    expect(sourcePos).toBe(Position.Bottom);
    expect(targetPos).toBe(Position.Top);
  });

  it('a card below-left of its target exits top/right toward it', () => {
    const source = node(0, 400);
    const target = node(500, 0); // up and to the right
    const { sourcePos, targetPos } = getEdgeEndpoints(source, target);
    // Source faces up-right, target faces down-left — never the wrong side.
    expect([Position.Top, Position.Right]).toContain(sourcePos);
    expect([Position.Bottom, Position.Left]).toContain(targetPos);
  });

  it('endpoints land on the source rectangle perimeter', () => {
    const source = node(100, 100);
    const target = node(600, 100);
    const { sx, sy } = getEdgeEndpoints(source, target);
    // Right side of the source card → x at the right border, y within height.
    expect(sx).toBeCloseTo(330, 0); // 100 + width 230
    expect(sy).toBeGreaterThanOrEqual(100);
    expect(sy).toBeLessThanOrEqual(148);
  });

  it('falls back to the centre when a node has not been measured yet', () => {
    const source = node(0, 0, 0, 0); // width/height 0 (pre-measure frame)
    const target = node(400, 0);
    const { sx, sy } = getEdgeEndpoints(source, target);
    expect(Number.isFinite(sx)).toBe(true);
    expect(Number.isFinite(sy)).toBe(true);
  });
});
