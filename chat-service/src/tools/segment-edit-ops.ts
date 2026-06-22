/**
 * Pure predicate-tree edit operations for propose_segment_edit.
 *
 * Applies a small, explicit op set to an existing predicate tree without any
 * HTTP — kept side-effect-free so the apply logic is unit-testable on its own
 * and the tool file stays focused on the server round-trip + SSE emit.
 *
 * Ops (last-write-wins, applied in array order):
 *   add_filter    — AND a new leaf onto the tree (wraps the root in an AND group
 *                   when the root is a leaf or an OR group).
 *   remove_filter — drop every leaf matching a member; errors if the tree would
 *                   become empty (an empty predicate selects the whole population).
 *   replace_tree  — swap the whole tree for a caller-supplied one.
 */

import { randomUUID } from 'node:crypto';
import { buildAdditionalLeaves, type AdditionalFilter, type ErrResult } from './propose-segment-handlers.js';
import type { LeafNode, GroupNode, PredicateNode } from '../types/predicate-tree.js';

export type EditOp =
  | { kind: 'add_filter'; member: string; operator: AdditionalFilter['operator']; values?: (string | number)[] }
  | { kind: 'remove_filter'; member: string }
  | { kind: 'replace_tree'; predicate_tree: PredicateNode };

export interface ApplyOk {
  ok: true;
  tree: PredicateNode;
  /** Human-readable summary lines of what each op changed (for diff disclosures). */
  added: string[];
  removed: string[];
}

/** Deep clone so the caller's stored tree is never mutated. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** AND `leaf` onto `tree`: append to an existing top-level AND, else wrap both. */
function andLeaf(tree: PredicateNode, leaf: LeafNode): GroupNode {
  if (tree.kind === 'group' && tree.op === 'AND') {
    return { ...tree, children: [...tree.children, leaf] };
  }
  return { kind: 'group', id: randomUUID(), op: 'AND', children: [tree, leaf] };
}

/** Recursively drop leaves whose member matches; prune groups that go empty. */
function dropMember(node: PredicateNode, member: string): PredicateNode | null {
  if (node.kind === 'leaf') return node.member === member ? null : node;
  const kept = node.children
    .map((c) => dropMember(c, member))
    .filter((c): c is PredicateNode => c !== null);
  if (kept.length === 0) return null;
  return { ...node, children: kept };
}

/** Minimal shape guard for a caller-supplied replacement tree. */
function isPredicateNode(v: unknown): v is PredicateNode {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  if (k === 'leaf') return typeof (v as LeafNode).member === 'string';
  if (k === 'group') return Array.isArray((v as GroupNode).children);
  return false;
}

export function applyEditOps(
  current: PredicateNode,
  ops: EditOp[],
  cube: string,
): ApplyOk | ErrResult {
  if (!ops || ops.length === 0) {
    return { ok: false, error: 'invalid_filters', detail: 'ops is required and must contain at least one edit operation.' };
  }

  let tree: PredicateNode = clone(current);
  const added: string[] = [];
  const removed: string[] = [];

  for (const op of ops) {
    if (op.kind === 'add_filter') {
      const f: AdditionalFilter = { member: op.member, operator: op.operator, values: op.values };
      const built = buildAdditionalLeaves([f], cube);
      if (!built.ok) return built;
      for (const leaf of built.leaves) tree = andLeaf(tree, leaf);
      added.push(...built.summary);
    } else if (op.kind === 'remove_filter') {
      const next = dropMember(tree, op.member);
      if (next === null) {
        return {
          ok: false,
          error: 'invalid_filters',
          detail:
            `Removing "${op.member}" would leave the segment with no conditions, ` +
            `which selects the entire population. Add a replacement condition or keep at least one filter.`,
        };
      }
      removed.push(op.member);
      tree = next;
    } else if (op.kind === 'replace_tree') {
      if (!isPredicateNode(op.predicate_tree)) {
        return { ok: false, error: 'invalid_filters', detail: 'replace_tree.predicate_tree is not a valid predicate node.' };
      }
      tree = clone(op.predicate_tree);
      added.push('(predicate tree replaced)');
    } else {
      return { ok: false, error: 'unknown', detail: `Unknown edit op: ${JSON.stringify(op)}` };
    }
  }

  return { ok: true, tree, added, removed };
}
