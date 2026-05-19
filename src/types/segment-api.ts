/**
 * Shared frontend types for the segments API.
 * These mirror the server-side zod schemas in server/src/types/.
 * Keep in sync manually when the server schema changes.
 */

export type SegmentType = 'manual' | 'predicate';
export type SegmentStatus = 'fresh' | 'refreshing' | 'broken' | 'stale';

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

export interface Segment {
  id: string;
  name: string;
  type: SegmentType;
  owner: string;
  status: SegmentStatus;
  cube: string | null;
  predicate_tree: PredicateNode | null;
  cube_query_json: string | null;
  sql_preview: string | null;
  uid_count: number;
  uid_list: string[];
  tags: string[];
  refresh_cadence_min: number | null;
  last_refreshed_at: string | null;
  broken_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentInput {
  name: string;
  type: SegmentType;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
}

export interface SegmentPatch {
  name?: string;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
}

export interface SegmentAnalysis {
  id: string;
  segment_id: string;
  title: string;
  owner: string;
  query_json: string | null;
  layout_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CubeIdentityMapping {
  cube: string;
  identity_field: string | null;
  source: 'manual' | 'auto' | 'auto-suggest';
  confidence: number | null;
  updated_at: string | null;
  is_suggested?: boolean;
  matched_pattern?: string | null;
}

export interface PresetTab {
  id: string;
  label: string;
}

export interface Preset {
  id: string;
  label: string;
  description?: string;
  tabs: PresetTab[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
