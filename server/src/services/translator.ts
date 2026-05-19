/**
 * Pure bidirectional translator between the canonical AND/OR predicate tree
 * and Cube Query.filters array format.
 *
 * No I/O — safe to call from routes, cron, or tests without side effects.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  PredicateNode,
  GroupNode,
  LeafNode,
  LeafOperator,
  CubeFilter,
  CubeLeafFilter,
  CubeLogicalFilter,
} from '../types/predicate-tree.js';

export class UnsupportedOperatorError extends Error {
  constructor(op: string, context = '') {
    super(`Unsupported operator: "${op}"${context ? ` (${context})` : ''}`);
    this.name = 'UnsupportedOperatorError';
  }
}

// Mapping from our canonical LeafOperator → Cube operator string
const TREE_TO_CUBE: Record<LeafOperator, string> = {
  equals: 'equals',
  notEquals: 'notEquals',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
  in: 'equals',        // Cube uses 'equals' for multi-value (IN)
  notIn: 'notEquals',  // Cube uses 'notEquals' for NOT IN
  contains: 'contains',
  set: 'set',
  notSet: 'notSet',
  inDateRange: 'inDateRange',
  beforeDate: 'beforeDate',
  afterDate: 'afterDate',
};

// Reverse map: Cube operator → our canonical operator
// Some Cube operators map to multiple tree ops; context (single vs multi value) disambiguates
const CUBE_TO_TREE_BASE: Record<string, LeafOperator> = {
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

function leafToCubeFilter(node: LeafNode): CubeLeafFilter {
  const cubeOp = TREE_TO_CUBE[node.op];
  if (!cubeOp) throw new UnsupportedOperatorError(node.op, `member=${node.member}`);

  const filter: CubeLeafFilter = {
    member: node.member,
    operator: cubeOp,
  };

  // set/notSet carry no values
  if (node.op !== 'set' && node.op !== 'notSet') {
    filter.values = node.values.map(String);
  }

  return filter;
}

function groupToCubeFilters(node: GroupNode): CubeFilter[] {
  const childFilters = node.children.map(nodeToCubeFilter);

  if (node.op === 'AND') {
    // Top-level AND: flatten children into a flat array.
    // Nested AND: wrap with { and: [...] }.
    return childFilters;
  }

  // OR group: emit { or: [...] }
  return [{ or: childFilters }];
}

function nodeToCubeFilter(node: PredicateNode): CubeFilter {
  if (node.kind === 'leaf') return leafToCubeFilter(node);

  const childFilters = node.children.map(nodeToCubeFilter);
  if (node.op === 'AND') return { and: childFilters };
  return { or: childFilters };
}

/**
 * Translate predicate tree → flat Cube Query.filters array.
 *
 * Root AND group is flattened to a top-level array (Cube implicit AND).
 * Nested OR/AND groups become { or: [...] } / { and: [...] } objects.
 */
export function treeToCubeFilters(tree: PredicateNode): CubeFilter[] {
  if (tree.kind === 'leaf') {
    return [leafToCubeFilter(tree)];
  }

  if (tree.op === 'AND') {
    // Root AND: each child becomes a top-level filter entry
    return tree.children.map(nodeToCubeFilter);
  }

  // Root OR: wrap everything in { or: [...] }
  return [{ or: tree.children.map(nodeToCubeFilter) }];
}

// ---------------------------------------------------------------------------
// Inverse: Cube filters → predicate tree
// ---------------------------------------------------------------------------

function isLogical(f: CubeFilter): f is CubeLogicalFilter {
  return 'and' in f || 'or' in f;
}

function cubeFilterToNode(f: CubeFilter): PredicateNode {
  if (!isLogical(f)) {
    const leaf = f as CubeLeafFilter;
    const op = CUBE_TO_TREE_BASE[leaf.operator];
    if (!op) throw new UnsupportedOperatorError(leaf.operator, `member=${leaf.member}`);

    // Disambiguate equals/notEquals: multi-value → in/notIn
    let resolvedOp: LeafOperator = op;
    if (op === 'equals' && leaf.values && leaf.values.length > 1) resolvedOp = 'in';
    if (op === 'notEquals' && leaf.values && leaf.values.length > 1) resolvedOp = 'notIn';

    return {
      kind: 'leaf',
      id: uuidv4(),
      member: leaf.member,
      type: 'string', // type is unknown from Cube filters alone; default string
      op: resolvedOp,
      values: leaf.values ?? [],
    };
  }

  const logical = f as CubeLogicalFilter;
  if (logical.and) {
    return {
      kind: 'group',
      id: uuidv4(),
      op: 'AND',
      children: logical.and.map(cubeFilterToNode),
    };
  }
  if (logical.or) {
    return {
      kind: 'group',
      id: uuidv4(),
      op: 'OR',
      children: logical.or.map(cubeFilterToNode),
    };
  }

  throw new UnsupportedOperatorError('unknown', 'empty logical filter');
}

/**
 * Translate flat Cube Query.filters → predicate tree.
 *
 * Multiple top-level filters are wrapped in a root AND group (Cube implicit AND).
 * A single logical filter at root is used directly as root.
 */
export function cubeFiltersToTree(filters: CubeFilter[]): PredicateNode {
  if (filters.length === 0) {
    return { kind: 'group', id: uuidv4(), op: 'AND', children: [] };
  }

  if (filters.length === 1) {
    return cubeFilterToNode(filters[0]);
  }

  return {
    kind: 'group',
    id: uuidv4(),
    op: 'AND',
    children: filters.map(cubeFilterToNode),
  };
}
