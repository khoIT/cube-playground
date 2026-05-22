/**
 * Builds a canonical PredicateNode tree from an executed Cube Query plus the
 * cohort rows the user selected in Playground results.
 *
 * Output shape (always a root AND group):
 *   AND(
 *     ...originalFilters → leaves/groups (preserves nested and/or),
 *     ...timeDimensions w/ dateRange → leaf{ op: inDateRange, values: [rangeLiteral] },
 *     // omitted when no rows selected:
 *     OR(
 *       ...selectedRows.map(row => AND(
 *         nonIdentityDims.map(dim => leaf{ op: equals, values: [row[dim]] })
 *       ))
 *     )
 *   )
 *
 * dateRange is kept as the original literal ("this week", "last 7 days", or
 * [start, end]) — when the segment refreshes on cadence, Cube re-resolves the
 * relative string against the refresh-time clock, giving rolling Live semantics.
 *
 * Filter translation mirrors `server/src/services/translator.ts` so the FE-
 * built tree round-trips identically through the server's treeToCubeFilters.
 */

import type { Query, TimeDimension } from '@cubejs-client/core';
import type {
  PredicateNode,
  GroupNode,
  LeafNode,
  LeafOperator,
  LeafValueType,
} from '../../types/segment-api';
import {
  getCohortTimeDimensions,
  getNonIdentityDimensions,
} from './build-expansion-query';
import { bucketDateRange } from './bucket-range';

function genId(prefix: 'grp' | 'leaf'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

const CUBE_TO_TREE_OP: Record<string, LeafOperator> = {
  equals: 'equals',
  notEquals: 'notEquals',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
  contains: 'contains',
  set: 'set',
  notSet: 'notSet',
  inDateRange: 'inDateRange',
  beforeDate: 'beforeDate',
  afterDate: 'afterDate',
};

interface CubeLeafFilter {
  member?: string;
  dimension?: string;
  operator: string;
  values?: unknown[];
}
interface CubeLogicalFilter {
  and?: CubeFilter[];
  or?: CubeFilter[];
}
type CubeFilter = CubeLeafFilter | CubeLogicalFilter;

function isLogical(f: CubeFilter): f is CubeLogicalFilter {
  return 'and' in f || 'or' in f;
}

/** Best-effort type inference from raw filter values. Refinable in editor. */
function inferLeafType(values: unknown[] | undefined): LeafValueType {
  if (!values || values.length === 0) return 'string';
  const v = values[0];
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

function cubeFilterToNode(f: CubeFilter): PredicateNode | null {
  if (isLogical(f)) {
    if (f.and) {
      const children = f.and.map(cubeFilterToNode).filter((c): c is PredicateNode => c != null);
      if (children.length === 0) return null;
      return { kind: 'group', id: genId('grp'), op: 'AND', children };
    }
    if (f.or) {
      const children = f.or.map(cubeFilterToNode).filter((c): c is PredicateNode => c != null);
      if (children.length === 0) return null;
      return { kind: 'group', id: genId('grp'), op: 'OR', children };
    }
    return null;
  }

  const leaf = f as CubeLeafFilter;
  const member = leaf.member ?? leaf.dimension;
  if (!member) return null;

  const baseOp = CUBE_TO_TREE_OP[leaf.operator];
  if (!baseOp) return null;

  // Multi-value equals/notEquals → in/notIn (mirrors server translator).
  let op: LeafOperator = baseOp;
  if (op === 'equals' && leaf.values && leaf.values.length > 1) op = 'in';
  if (op === 'notEquals' && leaf.values && leaf.values.length > 1) op = 'notIn';

  return {
    kind: 'leaf',
    id: genId('leaf'),
    member,
    type: inferLeafType(leaf.values),
    op,
    values: leaf.values ?? [],
  };
}

function timeDimensionToLeaf(td: TimeDimension): LeafNode | null {
  if (!td.dateRange) return null;
  // dateRange may be a literal string ("this week") or [start, end].
  const value = td.dateRange as unknown;
  return {
    kind: 'leaf',
    id: genId('leaf'),
    member: td.dimension,
    type: 'time',
    op: 'inDateRange',
    values: [value],
  };
}

function rowToAndGroup(
  row: Record<string, unknown>,
  dims: string[],
  cohortTimeDims: ReturnType<typeof getCohortTimeDimensions> = [],
): GroupNode | null {
  const dimLeaves: LeafNode[] = dims
    .filter((d) => row[d] != null)
    .map((d) => ({
      kind: 'leaf',
      id: genId('leaf'),
      member: d,
      type: inferLeafType([row[d]]),
      op: 'equals',
      values: [row[d]],
    }));

  const timeLeaves: LeafNode[] = [];
  for (const td of cohortTimeDims) {
    const range = bucketDateRange(row[td.rowKey], td.granularity);
    if (range) {
      timeLeaves.push({
        kind: 'leaf',
        id: genId('leaf'),
        member: td.member,
        type: 'time',
        op: 'inDateRange',
        values: [range],
      });
    }
  }

  const leaves = [...dimLeaves, ...timeLeaves];
  if (leaves.length === 0) return null;
  return { kind: 'group', id: genId('grp'), op: 'AND', children: leaves };
}

export function buildPredicateFromRows(
  executedQuery: Query,
  selectedRows: Record<string, unknown>[],
  identityField: string,
): GroupNode {
  const children: PredicateNode[] = [];

  // 1) original filters
  for (const f of (executedQuery.filters ?? []) as CubeFilter[]) {
    const node = cubeFilterToNode(f);
    if (node) children.push(node);
  }

  // 2) time dimension dateRange literals
  for (const td of executedQuery.timeDimensions ?? []) {
    const leaf = timeDimensionToLeaf(td);
    if (leaf) children.push(leaf);
  }

  // 3) OR-of-AND across selected rows over non-identity dims + cohort time buckets
  const dimsToConstrain = getNonIdentityDimensions(executedQuery.dimensions, identityField);
  const cohortTimeDims = getCohortTimeDimensions(executedQuery.timeDimensions, identityField);
  const orChildren = selectedRows
    .map((r) => rowToAndGroup(r, dimsToConstrain, cohortTimeDims))
    .filter((g): g is GroupNode => g != null);
  if (orChildren.length > 0) {
    children.push({ kind: 'group', id: genId('grp'), op: 'OR', children: orChildren });
  }

  return { kind: 'group', id: genId('grp'), op: 'AND', children };
}
