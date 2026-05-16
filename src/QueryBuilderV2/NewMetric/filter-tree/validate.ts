import { FilterGroup, FilterLeaf, FilterNode } from './types';

export type FilterTreeError = {
  level: 'error' | 'warning';
  nodeId: string;
  message: string;
};

export function validateTree(
  root: FilterNode,
  eligibleColumns: Set<string>
): FilterTreeError[] {
  const errors: FilterTreeError[] = [];

  function walk(node: FilterNode): void {
    if (node.kind === 'leaf') return walkLeaf(node);
    return walkGroup(node);
  }

  function walkLeaf(leaf: FilterLeaf): void {
    if (!eligibleColumns.has(leaf.column)) {
      errors.push({
        level: 'error',
        nodeId: leaf.id,
        message: `Column "${leaf.column}" is not part of the source cube.`,
      });
    }
    if (leaf.op !== 'set' && leaf.op !== 'notSet' && leaf.values.length === 0) {
      errors.push({
        level: 'error',
        nodeId: leaf.id,
        message: `Operator "${leaf.op}" requires at least one value.`,
      });
    }
    if (leaf.columnType === 'number' || leaf.columnType === 'integer') {
      for (const v of leaf.values) {
        if (!/^-?\d+(\.\d+)?$/.test(v)) {
          errors.push({
            level: 'error',
            nodeId: leaf.id,
            message: `Value "${v}" is not numeric.`,
          });
        }
      }
    }
    if (leaf.columnType === 'boolean') {
      for (const v of leaf.values) {
        const lo = v.toLowerCase();
        if (lo !== 'true' && lo !== 'false') {
          errors.push({
            level: 'error',
            nodeId: leaf.id,
            message: `Value "${v}" is not boolean.`,
          });
        }
      }
    }
  }

  function walkGroup(group: FilterGroup): void {
    if (group.children.length === 0) {
      errors.push({
        level: 'warning',
        nodeId: group.id,
        message: 'Empty group has no effect.',
      });
      return;
    }
    for (const c of group.children) walk(c);
  }

  walk(root);
  return errors;
}
