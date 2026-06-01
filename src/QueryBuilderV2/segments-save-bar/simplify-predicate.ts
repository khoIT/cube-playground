/**
 * Canonicalizes a predicate tree into a concise, logically-equivalent form for
 * display + storage. Predicates built from query-builder rows accumulate
 * redundant structure — single-child OR/AND wrappers, nested same-op groups,
 * duplicate leaves, and overlapping date windows on the same time member (an
 * outer query dateRange AND-ed with a per-row bucket range). This collapses all
 * of that so the segment editor shows the user's intent, not the build process.
 *
 * Pure — no IO. Applied at predicate-build time (so the saved tree is clean)
 * and at editor hydration (so pre-existing verbose trees render concise too).
 *
 * Rules, applied bottom-up to a fixpoint:
 *   1. Flatten nested same-op groups (AND-in-AND, OR-in-OR).
 *   2. Dedupe structurally-identical sibling nodes within a group.
 *   3. Within an AND group, intersect overlapping absolute inDateRange leaves on
 *      the same member into the tightest [max-start, min-end] window.
 *   4. Drop empty groups; unwrap single-child groups into the child.
 *   5. Keep the root a GroupNode (callers expect that shape).
 */

import type { PredicateNode, GroupNode, LeafNode } from '../../types/segment-api';

/** Structural fingerprint ignoring the volatile `id` — used for dedup + equality. */
function fingerprint(node: PredicateNode): string {
  if (node.kind === 'leaf') {
    return `L:${node.member}|${node.op}|${JSON.stringify(node.values)}`;
  }
  return `G:${node.op}(${node.children.map(fingerprint).join(',')})`;
}

/**
 * Pull an absolute [start, end] ISO date pair out of an inDateRange leaf.
 * Handles the wrapped `[[start, end]]` shape the predicate builder emits, the
 * flat `[start, end]` shape, and returns null for relative literals
 * ("this week") or anything non-absolute — those are left untouched.
 */
function absoluteRange(node: LeafNode): [string, string] | null {
  if (node.op !== 'inDateRange') return null;
  const v = node.values;
  let pair: unknown;
  if (v.length === 1 && Array.isArray(v[0]) && v[0].length === 2) pair = v[0];
  else if (v.length === 2) pair = v;
  else return null;
  const [start, end] = pair as unknown[];
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(start) || !/^\d{4}-\d{2}-\d{2}/.test(end)) return null;
  return [start, end];
}

/**
 * Merge inDateRange leaves that share a member within an AND group by
 * intersecting their absolute windows. Non-absolute date leaves and
 * non-overlapping windows are preserved as-is (a non-overlap is the user's
 * concern, not ours to silently resolve).
 */
function intersectDateRangesInAnd(children: PredicateNode[]): PredicateNode[] {
  // member → index of the surviving (tightest) inDateRange leaf so far.
  const dateLeafByMember = new Map<string, number>();
  const out: PredicateNode[] = [];

  for (const child of children) {
    const range = child.kind === 'leaf' ? absoluteRange(child) : null;
    if (!range || child.kind !== 'leaf') {
      out.push(child);
      continue;
    }
    const prevIdx = dateLeafByMember.get(child.member);
    if (prevIdx === undefined) {
      dateLeafByMember.set(child.member, out.length);
      out.push(child);
      continue;
    }
    const prev = out[prevIdx] as LeafNode;
    const prevRange = absoluteRange(prev)!;
    const start = range[0] > prevRange[0] ? range[0] : prevRange[0];
    const end = range[1] < prevRange[1] ? range[1] : prevRange[1];
    if (start > end) {
      // Disjoint windows — can't intersect into one; keep both so the
      // (likely empty) result is visible rather than silently rewritten.
      out.push(child);
      continue;
    }
    out[prevIdx] = { ...prev, values: [[start, end]] };
  }

  return out;
}

function simplifyNode(node: PredicateNode): PredicateNode | null {
  if (node.kind === 'leaf') return node;

  // 1. Simplify children first (bottom-up); drop any that collapse to null.
  let children = node.children
    .map(simplifyNode)
    .filter((c): c is PredicateNode => c != null);

  // 2. Flatten nested same-op groups into this one.
  const flattened: PredicateNode[] = [];
  for (const child of children) {
    if (child.kind === 'group' && child.op === node.op) {
      flattened.push(...child.children);
    } else {
      flattened.push(child);
    }
  }
  children = flattened;

  // 3. Intersect overlapping date windows (AND only — OR widens, not narrows).
  if (node.op === 'AND') children = intersectDateRangesInAnd(children);

  // 4. Dedupe structurally-identical siblings.
  const seen = new Set<string>();
  children = children.filter((c) => {
    const fp = fingerprint(c);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  // 5. Empty group → drop; single-child group → unwrap to the child.
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  return { ...node, children };
}

/**
 * Simplify a predicate tree, guaranteeing a GroupNode root (callers and the
 * editor render a group at the top level). A tree that collapses to a single
 * leaf is re-wrapped in an AND group.
 */
export function simplifyPredicate(root: PredicateNode): GroupNode {
  const simplified = simplifyNode(root);
  if (simplified == null) {
    return { kind: 'group', id: root.id, op: 'AND', children: [] };
  }
  if (simplified.kind === 'leaf') {
    return { kind: 'group', id: root.id, op: 'AND', children: [simplified] };
  }
  return simplified;
}
