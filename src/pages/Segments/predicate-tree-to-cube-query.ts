/**
 * Maps a segment predicate tree to a Cube query fragment
 * ({ filters, timeDimensions }).
 *
 * WHY this module exists (not using cube_query_json):
 *   The stored cube_query_json has relative date ranges already expanded into
 *   literal [start, end] tuples by the server translator before the segment
 *   was last refreshed. Deeplinking from that JSON and saving back would
 *   permanently freeze rolling windows (e.g. "last 30 days" → a hard range
 *   from the last refresh date). The predicate tree retains the original
 *   relative literals the user chose — this mapper forwards them unchanged so
 *   save-back correctly re-anchors to "now" at the next refresh.
 *
 * Time operators (inDateRange/beforeDate/afterDate) on a leaf produce
 * timeDimensions entries; all other operators produce filter entries.
 * The sidecar cube-level segments (e.g. mf_users.whales) are NOT part of
 * the tree — the caller injects them separately from cube_query_json.
 *
 * Operator mapping mirrors server/src/services/translator.ts TREE_TO_CUBE:
 *   in → equals (Cube uses equals for multi-value IN queries)
 *   notIn → notEquals (Cube uses notEquals for NOT IN)
 * buildPredicateFromRows re-promotes multi-value equals → in on the reverse
 * leg, so the round-trip stays lossless.
 *
 * Structural fidelity: nested OR/AND groups are emitted as Cube's boolean
 * filter format ({ or: [...] } / { and: [...] }) so semantics are preserved.
 * A flat root-AND is the only case that is flattened to a top-level array
 * (Cube's implicit-AND semantics). Any other nesting shape is preserved
 * recursively — OR(AND(a,b),c) becomes { or: [{ and:[a,b] }, c] }.
 *
 * Time-ops under OR: a time-dim leaf inside an OR group is emitted as a
 * dateRange filter inside the compound rather than hoisted to timeDimensions.
 * This preserves the OR semantics Cube supports via boolean filter format.
 * The translatability gate blocks such trees from being saved back (boolean-
 * group filters cannot be consumed by buildPredicateFromRows into a tree leaf).
 */

import type { PredicateNode, LeafNode, LeafOperator } from '../../types/segment-api';

/** A single Cube filter object (plain-filter variant, not member-filter). */
export interface CubeFilter {
  member?: string;
  operator?: string;
  values?: string[];
  or?: CubeFilter[];
  and?: CubeFilter[];
}

/**
 * Cube time dimension entry with an optional date range.
 * dateRange may be a relative string (e.g. "last 30 days") or a [from, to]
 * tuple — this mapper forwards whatever the leaf stored.
 */
export interface CubeTimeDimension {
  dimension: string;
  dateRange?: string | [string, string];
}

export interface CubeQueryFragment {
  filters: CubeFilter[];
  timeDimensions: CubeTimeDimension[];
}

/** Time operators that map to timeDimensions rather than filters (at root level). */
const TIME_OPS: ReadonlySet<LeafOperator> = new Set([
  'inDateRange',
  'beforeDate',
  'afterDate',
]);

/** Value-less operators that should omit the values array. */
const NO_VALUE_OPS: ReadonlySet<LeafOperator> = new Set(['set', 'notSet']);

/**
 * Maps our canonical tree operator to the Cube query operator string.
 * Mirrors server/src/services/translator.ts TREE_TO_CUBE map.
 * Note: 'notInDateRange' is not in the FE LeafOperator union (the predicate
 * editor does not expose it) so it is omitted here; the translatability gate
 * blocks it from save-back at the query level.
 */
const TREE_TO_CUBE_OP: Record<LeafOperator, string> = {
  equals: 'equals',
  notEquals: 'notEquals',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
  in: 'equals',       // Cube uses 'equals' for multi-value (IN)
  notIn: 'notEquals', // Cube uses 'notEquals' for NOT IN
  contains: 'contains',
  set: 'set',
  notSet: 'notSet',
  inDateRange: 'inDateRange',
  beforeDate: 'beforeDate',
  afterDate: 'afterDate',
};

function leafToTopLevelFragment(leaf: LeafNode): CubeQueryFragment {
  if (TIME_OPS.has(leaf.op)) {
    // Relative literals (e.g. "last 30 days") and [from, to] tuples are
    // stored in leaf.values. For inDateRange the value may be the relative
    // string directly (single element) or a two-element [from, to] tuple.
    // beforeDate / afterDate always have a single date value.
    let dateRange: string | [string, string] | undefined;
    if (leaf.values.length === 1) {
      dateRange = String(leaf.values[0]);
    } else if (leaf.values.length >= 2) {
      dateRange = [String(leaf.values[0]), String(leaf.values[1])];
    }
    return {
      filters: [],
      timeDimensions: [{ dimension: leaf.member, ...(dateRange !== undefined ? { dateRange } : {}) }],
    };
  }

  const cubeOp = TREE_TO_CUBE_OP[leaf.op] ?? leaf.op;
  const filter: CubeFilter = { member: leaf.member, operator: cubeOp };
  if (!NO_VALUE_OPS.has(leaf.op) && leaf.values.length > 0) {
    filter.values = leaf.values.map(String);
  }
  return { filters: [filter], timeDimensions: [] };
}

/**
 * Convert a predicate node to a single Cube filter object.
 * Used for nodes that appear inside a boolean group (not at the query root).
 * Time-dim leaves are emitted as inDateRange/beforeDate/afterDate filter objects
 * (not promoted to timeDimensions) because they are inside a compound filter.
 */
function nodeToFilter(node: PredicateNode): CubeFilter {
  if (node.kind === 'leaf') {
    const cubeOp = TREE_TO_CUBE_OP[node.op] ?? node.op;
    const f: CubeFilter = { member: node.member, operator: cubeOp };
    if (!NO_VALUE_OPS.has(node.op) && node.values.length > 0) {
      f.values = node.values.map(String);
    }
    // Time-dim leaves inside boolean groups: use their Cube operator directly
    // (inDateRange, beforeDate, afterDate) rather than promoting to timeDimensions.
    // The translatability gate blocks such trees from being saved back because
    // buildPredicateFromRows cannot consume boolean-group filters back into tree
    // leaves (the gate counts them as unconsumed constructs).
    return f;
  }

  // Group node — recurse
  const childFilters = node.children.map(nodeToFilter);
  if (node.op === 'AND') {
    return { and: childFilters };
  }
  return { or: childFilters };
}

function mergeFragments(a: CubeQueryFragment, b: CubeQueryFragment): CubeQueryFragment {
  return {
    filters: [...a.filters, ...b.filters],
    timeDimensions: [...a.timeDimensions, ...b.timeDimensions],
  };
}

/**
 * Traverse the predicate tree and collect Cube filters + timeDimensions.
 *
 * Root AND: each child becomes a top-level filter entry (Cube's implicit AND).
 * Nested OR/AND groups: emitted as Cube boolean filter format ({ or:[...] } /
 * { and:[...] }) so structure is preserved — OR(AND(a,b),c) becomes
 * { or: [{ and:[a,b] }, c] }, never silently flattened to or(a,b,c).
 */
export function treeToQueryFragment(node: PredicateNode): CubeQueryFragment {
  if (node.kind === 'leaf') {
    return leafToTopLevelFragment(node);
  }

  if (node.op === 'AND') {
    // Root/intermediate AND: process each child. Child AND/OR groups become
    // nested filter objects; child leaves at this level become top-level entries.
    return node.children
      .map((child): CubeQueryFragment => {
        if (child.kind === 'leaf') {
          return leafToTopLevelFragment(child);
        }
        // Child group — emit as a compound filter object, never flatten.
        return { filters: [nodeToFilter(child)], timeDimensions: [] };
      })
      .reduce(mergeFragments, { filters: [], timeDimensions: [] });
  }

  // Root OR group: wrap the entire OR in a single compound filter.
  // Children (leaves or nested groups) are emitted as filter objects.
  const orChildren = node.children.map(nodeToFilter);
  return { filters: [{ or: orChildren }], timeDimensions: [] };
}
