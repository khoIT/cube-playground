/**
 * Map a clicked heatmap cell to a segment-editor predicate prefill.
 *
 * A heatmap cell is the intersection of two categorical dimensions — its row
 * (series) value and its column (category) value. Saving it as a segment means
 * "members where seriesDim = seriesValue AND categoryDim = categoryValue", so
 * the cell becomes a two-leaf AND group. Dimension member keys (e.g.
 * "mf_users.country") double as the editor's predicate members; their shared
 * prefix is the cube the editor seeds.
 */

import type { GroupNode, LeafNode, PredicateNode } from '../../../types/segment-api';

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older embedded webviews without crypto.randomUUID — ids only need to be
    // unique within this one tree, so a counter-ish fallback is fine.
    return `leaf-${Math.random().toString(36).slice(2)}`;
  }
}

function equalsLeaf(member: string, value: string | number): LeafNode {
  return { kind: 'leaf', id: uid(), member, type: 'string', op: 'equals', values: [String(value)] };
}

/** Cube name from a member key ("mf_users.country" → "mf_users"). */
export function cubeOfMember(member: string): string {
  const dot = member.indexOf('.');
  return dot > 0 ? member.slice(0, dot) : member;
}

export interface HeatmapCell {
  seriesDim: string;
  seriesValue: string | number;
  categoryDim: string;
  categoryValue: string | number;
}

export function heatmapCellToPredicate(cell: HeatmapCell): PredicateNode {
  const group: GroupNode = {
    kind: 'group',
    id: uid(),
    op: 'AND',
    children: [
      equalsLeaf(cell.seriesDim, cell.seriesValue),
      equalsLeaf(cell.categoryDim, cell.categoryValue),
    ],
  };
  return group;
}
