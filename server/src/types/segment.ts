import type { PredicateNode } from './predicate-tree.js';

export type SegmentType = 'manual' | 'predicate';
export type SegmentStatus = 'fresh' | 'refreshing' | 'broken' | 'stale';

export type ActivationStatus = 'active' | 'failed' | 'pending';
export type ActivationEnv = 'dev' | 'stag' | 'prod';
export type ActivationDestination = 'cdp';

export interface Activation {
  id: string;
  destination: ActivationDestination;
  game_id: string;
  env: ActivationEnv;
  metric_name: string;
  registered_at: string;
  last_pushed_at: string | null;
  status: ActivationStatus;
  last_error?: string;
}

export interface Segment {
  id: string;
  name: string;
  type: SegmentType;
  owner: string;
  status: SegmentStatus;
  cube: string | null;
  predicate_tree_json: string | null;
  cube_query_json: string | null;
  sql_preview: string | null;
  uid_count: number;
  uid_list_json: string;
  refresh_cadence_min: number | null;
  last_refreshed_at: string | null;
  broken_reason: string | null;
  created_at: string;
  updated_at: string;
  game_id: string;
  activations_json: string;
  // hydrated fields (not in DB columns directly)
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  activations?: Activation[];
}

export interface SegmentInput {
  name: string;
  type: SegmentType;
  owner?: string;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  game_id?: string;
}

export interface SegmentPatch {
  name?: string;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  status?: SegmentStatus;
  broken_reason?: string | null;
  sql_preview?: string | null;
}
