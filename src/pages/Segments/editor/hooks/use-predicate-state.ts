/**
 * Local state hook for the predicate builder.
 * Operates on a PredicateNode (root = GroupNode). All updates are immutable
 * via structuredClone. The mutator helpers mirror the mock's screen-editor.jsx.
 */

import { useCallback, useState } from 'react';
import type {
  GroupNode,
  LeafNode,
  PredicateNode,
  LeafValueType,
  LeafOperator,
} from '../../../../types/segment-api';

export type Path = number[];

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyRoot(): GroupNode {
  return { kind: 'group', id: genId('grp'), op: 'AND', children: [] };
}

export function emptyLeaf(): LeafNode {
  return {
    kind: 'leaf',
    id: genId('leaf'),
    member: '',
    type: 'string',
    op: 'equals',
    values: [],
  };
}

/** Returns the node at the given path, or null if the path is invalid. */
function getAt(root: PredicateNode, path: Path): PredicateNode | null {
  let cur: PredicateNode = root;
  for (const idx of path) {
    if (cur.kind !== 'group') return null;
    cur = cur.children[idx];
    if (!cur) return null;
  }
  return cur;
}

function updateAt(
  root: PredicateNode,
  path: Path,
  updater: (node: PredicateNode) => PredicateNode,
): PredicateNode {
  const next = structuredClone(root);
  if (path.length === 0) return updater(next);
  let parent: GroupNode = next as GroupNode;
  for (let i = 0; i < path.length - 1; i++) {
    const child = parent.children[path[i]];
    if (!child || child.kind !== 'group') return root;
    parent = child;
  }
  const last = path[path.length - 1];
  parent.children[last] = updater(parent.children[last]);
  return next;
}

function removeAt(root: PredicateNode, path: Path): PredicateNode {
  if (path.length === 0) return root;
  const next = structuredClone(root);
  let parent: GroupNode = next as GroupNode;
  for (let i = 0; i < path.length - 1; i++) {
    const child = parent.children[path[i]];
    if (!child || child.kind !== 'group') return root;
    parent = child;
  }
  const last = path[path.length - 1];
  parent.children.splice(last, 1);
  return next;
}

function insertChild(root: PredicateNode, path: Path, child: PredicateNode): PredicateNode {
  const next = structuredClone(root);
  let target: PredicateNode = next;
  for (const idx of path) {
    if (target.kind !== 'group') return root;
    target = target.children[idx];
    if (!target) return root;
  }
  if (target.kind !== 'group') return root;
  target.children.push(child);
  return next;
}

export function isTreeValid(node: PredicateNode): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) return false;
    return node.children.every(isTreeValid);
  }
  if (!node.member || !node.op) return false;
  if (node.op === 'set' || node.op === 'notSet') return true;
  if (node.values.length === 0) return false;
  return node.values.every((v) => v !== '' && v != null);
}

export function usePredicateState(initial?: PredicateNode | null) {
  const [tree, setTree] = useState<PredicateNode>(() => initial ?? emptyRoot());

  const replaceTree = useCallback((next: PredicateNode) => setTree(next), []);

  const addLeaf = useCallback((groupPath: Path) => {
    setTree((cur) => insertChild(cur, groupPath, emptyLeaf()));
  }, []);

  const addGroup = useCallback((groupPath: Path) => {
    setTree((cur) => insertChild(cur, groupPath, emptyRoot()));
  }, []);

  const removeNode = useCallback((path: Path) => {
    setTree((cur) => removeAt(cur, path));
  }, []);

  const updateLeaf = useCallback((path: Path, patch: Partial<LeafNode>) => {
    setTree((cur) =>
      updateAt(cur, path, (node) =>
        node.kind === 'leaf' ? { ...node, ...patch } : node,
      ),
    );
  }, []);

  const setLeafMember = useCallback((path: Path, member: string, type: LeafValueType) => {
    setTree((cur) =>
      updateAt(cur, path, (node) =>
        node.kind === 'leaf' ? { ...node, member, type, op: defaultOp(type), values: [] } : node,
      ),
    );
  }, []);

  const setLeafOp = useCallback((path: Path, op: LeafOperator) => {
    setTree((cur) =>
      updateAt(cur, path, (node) =>
        node.kind === 'leaf' ? { ...node, op, values: op === 'set' || op === 'notSet' ? [] : node.values } : node,
      ),
    );
  }, []);

  const setLeafValues = useCallback((path: Path, values: unknown[]) => {
    setTree((cur) =>
      updateAt(cur, path, (node) =>
        node.kind === 'leaf' ? { ...node, values } : node,
      ),
    );
  }, []);

  const toggleConj = useCallback((path: Path) => {
    setTree((cur) =>
      updateAt(cur, path, (node) =>
        node.kind === 'group' ? { ...node, op: node.op === 'AND' ? 'OR' : 'AND' } : node,
      ),
    );
  }, []);

  return {
    tree,
    setTree,
    replaceTree,
    addLeaf,
    addGroup,
    removeNode,
    updateLeaf,
    setLeafMember,
    setLeafOp,
    setLeafValues,
    toggleConj,
    getAt: (p: Path) => getAt(tree, p),
    isValid: isTreeValid(tree),
  };
}

function defaultOp(type: LeafValueType): LeafOperator {
  switch (type) {
    case 'number':  return 'equals';
    case 'time':    return 'inDateRange';
    case 'boolean': return 'equals';
    case 'string':
    default:        return 'equals';
  }
}
