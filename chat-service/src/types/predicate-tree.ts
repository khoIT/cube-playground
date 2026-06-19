/**
 * Predicate tree types for chat-service — mirrors server/src/types/predicate-tree.ts.
 *
 * Kept in sync manually; the authoritative definition lives on the server side.
 * Only the subset needed for building proposals is included here.
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
  | 'notInDateRange'
  | 'beforeDate'
  | 'afterDate'
  | 'dateWithinLast'
  | 'dateBeforeLast'
  | 'percentileGte'
  | 'percentileLte';

export type LeafValueType = 'string' | 'number' | 'time' | 'boolean';

export interface RelativeDateValue {
  n: number;
  unit: 'day' | 'week' | 'month';
}

export interface PopulationRef {
  table?: string;
  column?: string;
  filter?: PredicateNode;
  identityMerge?: IdentityMerge;
}

export interface IdentityMerge {
  idColumn: string;
  transform: 'split_part_at';
  agg?: 'max' | 'sum';
}

export interface PercentileValue {
  p: number;
  over?: PopulationRef;
}

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
