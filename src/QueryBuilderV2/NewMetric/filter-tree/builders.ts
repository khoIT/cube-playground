import { ColumnType, FilterGroup, FilterLeaf, FilterNode, FilterOperator } from './types';

let idCounter = 0;
function nextId(prefix: 'leaf' | 'group'): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyTree(): FilterGroup {
  return { kind: 'group', id: nextId('group'), op: 'AND', children: [] };
}

export function makeLeaf(
  column: string,
  columnType: ColumnType,
  op: FilterOperator = '=',
  values: string[] = []
): FilterLeaf {
  return { kind: 'leaf', id: nextId('leaf'), column, columnType, op, values };
}

export function makeGroup(op: 'AND' | 'OR' = 'OR', children: FilterNode[] = []): FilterGroup {
  return { kind: 'group', id: nextId('group'), op, children };
}

function cloneNode(node: FilterNode): FilterNode {
  if (node.kind === 'leaf') return { ...node, values: [...node.values] };
  return { ...node, children: node.children.map(cloneNode) };
}

function findAndReplace(
  root: FilterGroup,
  targetId: string,
  replace: (n: FilterNode) => FilterNode | null
): FilterGroup {
  function walk(node: FilterNode): FilterNode | null {
    if (node.id === targetId) return replace(node);
    if (node.kind === 'group') {
      const newChildren: FilterNode[] = [];
      for (const c of node.children) {
        const r = walk(c);
        if (r !== null) newChildren.push(r);
      }
      return { ...node, children: newChildren };
    }
    return node;
  }
  const result = walk(root);
  if (result == null || result.kind !== 'group') return emptyTree();
  return result;
}

export function addLeaf(
  root: FilterGroup,
  parentId: string,
  leaf: FilterLeaf
): FilterGroup {
  function walk(node: FilterNode): FilterNode {
    if (node.kind === 'group' && node.id === parentId) {
      return { ...node, children: [...node.children, leaf] };
    }
    if (node.kind === 'group') {
      return { ...node, children: node.children.map(walk) };
    }
    return node;
  }
  const result = walk(root);
  return result.kind === 'group' ? result : root;
}

export function addGroup(root: FilterGroup, parentId: string, group: FilterGroup): FilterGroup {
  return addLeaf(root, parentId, group as unknown as FilterLeaf);
}

export function removeNode(root: FilterGroup, targetId: string): FilterGroup {
  return findAndReplace(root, targetId, () => null);
}

export function updateLeaf(
  root: FilterGroup,
  targetId: string,
  patch: Partial<Omit<FilterLeaf, 'id' | 'kind'>>
): FilterGroup {
  return findAndReplace(root, targetId, (n) => {
    if (n.kind !== 'leaf') return n;
    return { ...n, ...patch, values: patch.values ?? n.values };
  });
}

export function setGroupOp(
  root: FilterGroup,
  targetId: string,
  op: 'AND' | 'OR'
): FilterGroup {
  return findAndReplace(root, targetId, (n) => {
    if (n.kind !== 'group') return n;
    return { ...n, op };
  });
}

export function cloneTree(root: FilterGroup): FilterGroup {
  const c = cloneNode(root);
  return c as FilterGroup;
}

export function isEmpty(root: FilterGroup): boolean {
  if (root.children.length === 0) return true;
  return root.children.every((c) => c.kind === 'group' && isEmpty(c));
}

export function countLeaves(root: FilterNode): number {
  if (root.kind === 'leaf') return 1;
  return root.children.reduce((acc, c) => acc + countLeaves(c), 0);
}
