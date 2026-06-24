/**
 * Pure geometry tests for the lifecycle Sankey ribbon layout.
 *
 * No React / DOM — asserts the bar/ribbon math: bar heights track row/column
 * sums, a node's outgoing ribbon thicknesses sum back to its bar height (shared
 * px-per-user scale), endpoints sit at the inner edges of the node columns, and
 * zero-count cells produce no ribbon.
 */
import { describe, it, expect } from 'vitest';
import { computeRibbonLayout, type RibbonGeometry } from '../sankey-ribbon-layout';
import type { TransitionCell } from '../../../../../api/lifecycle-flow-client';

const ORDER = ['new', 'core', 'lapsing', 'reactivated', 'churned'] as const;

const GEOM: RibbonGeometry = {
  innerTop: 0,
  innerHeight: 500,
  nodeGap: 10,
  leftX: 90,
  rightX: 452,
  nodeWidth: 18,
};

const CELLS: TransitionCell[] = [
  { from: 'core', to: 'core', count: 100 },
  { from: 'core', to: 'lapsing', count: 25 },
  { from: 'lapsing', to: 'churned', count: 10 },
  { from: 'reactivated', to: 'core', count: 0 }, // zero → dropped
];

describe('computeRibbonLayout', () => {
  const layout = computeRibbonLayout(ORDER, CELLS, GEOM);

  it('drops zero-count cells', () => {
    expect(layout.ribbons).toHaveLength(3);
    expect(layout.ribbons.some((r) => r.count === 0)).toBe(false);
  });

  it('left bars equal row sums, right bars equal column sums', () => {
    const left = new Map(layout.leftBars.map((b) => [b.state, b.total]));
    const right = new Map(layout.rightBars.map((b) => [b.state, b.total]));
    expect(left.get('core')).toBe(125);
    expect(left.get('lapsing')).toBe(10);
    expect(left.get('new')).toBe(0);
    expect(right.get('core')).toBe(100);
    expect(right.get('lapsing')).toBe(25);
    expect(right.get('churned')).toBe(10);
  });

  it('totalFlow is the prev-side sample size', () => {
    expect(layout.totalFlow).toBe(135);
  });

  it("a node's outgoing ribbons sum to its bar height (shared scale)", () => {
    const coreBar = layout.leftBars.find((b) => b.state === 'core')!;
    const coreRibbons = layout.ribbons.filter((r) => r.from === 'core');
    const sumThick = coreRibbons.reduce((s, r) => s + r.thickness, 0);
    expect(sumThick).toBeCloseTo(coreBar.height, 5);
  });

  it('ribbon endpoints sit at the inner edges of the two node columns', () => {
    for (const r of layout.ribbons) {
      expect(r.x0).toBe(GEOM.leftX + GEOM.nodeWidth);
      expect(r.x1).toBe(GEOM.rightX);
    }
  });

  it('empty matrix yields zero-height bars and no ribbons', () => {
    const empty = computeRibbonLayout(ORDER, [], GEOM);
    expect(empty.ribbons).toHaveLength(0);
    expect(empty.leftBars.every((b) => b.height === 0)).toBe(true);
  });
});
