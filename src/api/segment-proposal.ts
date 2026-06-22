/**
 * Frontend types for the segment_proposal SSE event.
 *
 * The chat-service emits this event when the agent determines a segment could be
 * materialized from the user's query. The FE renders a confirm card; on confirm it
 * POSTs to /api/segments (the existing create endpoint) — chat proposes, FE writes.
 *
 * Shape mirrors chat-service SegmentProposalEvent (do NOT diverge unilaterally).
 */

import type { PredicateNode, SegmentVisibility } from '../types/segment-api';

/** Resolved population & size estimates — computed server-side at proposal time. */
export interface SegmentProposalResolved {
  /** Resolved percentile cutoff value (present for percentileGte/Lte operators).
   *  Approximate: approx_percentile + timing window means the real value may differ. */
  cutoff?: number;
  /** True cohort size estimate. This is uid_count-equivalent, NOT the 5k uid_list sample. */
  estCount: number;
  /** Optional full-population count used to compute the percentile. */
  populationCount?: number;
  /** Human-readable population scope label (e.g. "All active payers — last 90 days"). */
  population: string;
}

/** The full segment_proposal SSE event payload. */
export interface SegmentProposalPayload {
  type: 'segment_proposal';
  /** Draft name for the segment — user may edit before confirming. */
  name: string;
  /** Game the segment belongs to (scopes the POST body). */
  game_id: string;
  /** Logical cube, e.g. 'mf_users'. Passed straight through to the create body. */
  cube: string;
  /** Authoritative predicate tree. Passed as-is to POST /api/segments. */
  predicate_tree: PredicateNode;
  /** Size estimates and population scope description. */
  resolved: SegmentProposalResolved;
  /** Verbatim disclosures to surface — e.g. "using approx_percentile", timing window caveats. */
  disclosures: string[];
  /** Visibility tier the agent recommends. User may override before confirming. */
  suggestedVisibility: SegmentVisibility;
  /**
   * Lineage — the exploration this proposal was crystallized from (the "Build
   * segment from this" bridge, or a "save that as a segment" chat turn). Carried
   * through to the segment's `born_from` on create so the cohort remembers its
   * origin. Absent for proposals authored from scratch (threshold/percentile).
   */
  source_query?: {
    artifact_id?: string;
    question?: string;
    cube_query?: unknown;
  };
  /**
   * Present only on EDIT proposals (propose_segment_edit). When set, the card
   * confirms by PATCHing /api/segments/:id with the new `predicate_tree` instead
   * of POSTing a new segment; `previous_predicate_tree` powers the old→new diff.
   */
  edit?: {
    segment_id: string;
    previous_predicate_tree: PredicateNode;
  };
}
