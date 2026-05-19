/**
 * Canonical AND/OR predicate tree — the authoritative form stored in segments.
 * Translated to/from Cube Query.filters by services/translator.ts.
 */

export type LeafOperator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'set'
  | 'notSet'
  | 'inDateRange'
  | 'beforeDate'
  | 'afterDate';

export type LeafValueType = 'string' | 'number' | 'time' | 'boolean';

export interface LeafNode {
  kind: 'leaf';
  id: string;
  member: string;
  type: LeafValueType;
  op: LeafOperator;
  values: unknown[];
}

export interface GroupNode {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: PredicateNode[];
}

export type PredicateNode = GroupNode | LeafNode;

// Cube filter shapes used in translation
export interface CubeLeafFilter {
  member: string;
  operator: string;
  values?: string[];
}

export interface CubeLogicalFilter {
  and?: CubeFilter[];
  or?: CubeFilter[];
}

export type CubeFilter = CubeLeafFilter | CubeLogicalFilter;
