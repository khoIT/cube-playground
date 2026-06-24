/**
 * Pure layout math for the lifecycle-transition Sankey ribbons.
 *
 * Kept framework-free (no React) so the geometry is unit-testable: given the
 * from→to cells and the SVG geometry, it returns the left/right node bars and
 * the ribbon centerlines. Bars and ribbons share ONE px-per-user scale so a
 * ribbon's thickness lines up with the slice of the node bar it leaves/enters.
 *
 * Left column = prev-date cohort state totals (row sums of the matrix).
 * Right column = curr-date cohort state totals (column sums).
 * Both are the TRACKED-segment cohort — not the full population shown in the
 * state cards above. The view discloses this; this module only does geometry.
 */

import type { TransitionCell } from '../../../../api/lifecycle-flow-client';

export interface RibbonGeometry {
  innerTop: number;
  innerHeight: number;
  nodeGap: number;
  leftX: number;
  rightX: number;
  nodeWidth: number;
}

export interface NodeBar {
  state: string;
  y: number;
  height: number;
  total: number;
}

export interface Ribbon {
  from: string;
  to: string;
  count: number;
  /** Centerline endpoints (x at inner edges of the two node columns). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness: number;
}

export interface RibbonLayout {
  leftBars: NodeBar[];
  rightBars: NodeBar[];
  ribbons: Ribbon[];
  /** Sum of all cell counts — the transition sample size. */
  totalFlow: number;
}

function sumBy(cells: TransitionCell[], pick: (c: TransitionCell) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cells) m.set(pick(c), (m.get(pick(c)) ?? 0) + c.count);
  return m;
}

/**
 * Compute bar + ribbon geometry for an ordered set of states and the matrix
 * cells. Bars use raw-proportional heights (no min-floor) so ribbon widths add
 * up exactly to the bar slices; a zero-total state collapses to a zero-height
 * bar with no ribbons, which is correct.
 */
export function computeRibbonLayout(
  order: readonly string[],
  cells: TransitionCell[],
  geom: RibbonGeometry,
): RibbonLayout {
  const prevTotals = sumBy(cells, (c) => c.from);
  const currTotals = sumBy(cells, (c) => c.to);
  const sumPrev = [...prevTotals.values()].reduce((s, v) => s + v, 0);
  const sumCurr = [...currTotals.values()].reduce((s, v) => s + v, 0);
  // Shared scale across both columns so ribbons connect cleanly.
  const scaleTotal = Math.max(sumPrev, sumCurr, 1);
  const availH = geom.innerHeight - (order.length - 1) * geom.nodeGap;
  const pxPerUser = availH > 0 ? availH / scaleTotal : 0;

  function buildBars(totals: Map<string, number>): NodeBar[] {
    const bars: NodeBar[] = [];
    let y = geom.innerTop;
    for (const state of order) {
      const total = totals.get(state) ?? 0;
      const height = total * pxPerUser;
      bars.push({ state, y, height, total });
      y += height + geom.nodeGap;
    }
    return bars;
  }

  const leftBars = buildBars(prevTotals);
  const rightBars = buildBars(currTotals);
  const leftByState = new Map(leftBars.map((b) => [b.state, b]));
  const rightByState = new Map(rightBars.map((b) => [b.state, b]));

  // Running stack offsets within each node: outgoing ribbons stack down the
  // left node in to-state order; incoming ribbons stack down the right node in
  // from-state order. Iterating from-outer / to-inner yields both orders.
  const leftOffset = new Map(leftBars.map((b) => [b.state, b.y]));
  const rightOffset = new Map(rightBars.map((b) => [b.state, b.y]));

  const innerLeftX = geom.leftX + geom.nodeWidth;
  const ribbons: Ribbon[] = [];
  for (const from of order) {
    for (const to of order) {
      const cell = cells.find((c) => c.from === from && c.to === to);
      if (!cell || cell.count <= 0) continue;
      const thickness = cell.count * pxPerUser;
      const ly = leftOffset.get(from) ?? leftByState.get(from)?.y ?? geom.innerTop;
      const ry = rightOffset.get(to) ?? rightByState.get(to)?.y ?? geom.innerTop;
      ribbons.push({
        from,
        to,
        count: cell.count,
        x0: innerLeftX,
        y0: ly + thickness / 2,
        x1: geom.rightX,
        y1: ry + thickness / 2,
        thickness,
      });
      leftOffset.set(from, ly + thickness);
      rightOffset.set(to, ry + thickness);
    }
  }

  return { leftBars, rightBars, ribbons, totalFlow: sumPrev };
}
