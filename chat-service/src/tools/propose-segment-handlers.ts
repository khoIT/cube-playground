/**
 * Shared result types, arg shapes, cutoff resolution, and the two handlers
 * that do NOT require a server round-trip: handleThreshold and handleQuery.
 *
 * The cutoff-based handlers (percentile + top_n) live in
 * propose-segment-cutoff-handlers.ts to keep each file under ~250 LOC.
 */

import { randomUUID } from 'node:crypto';
import { postJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';
import type { SegmentableMeasure, PopulationOver } from './get-segmentable-measures.js';
import type { LeafNode, GroupNode } from '../types/predicate-tree.js';
import type { CubeInputFilter } from '../utils/cube-query-to-predicate-tree.js';
import { cubeQueryToPredicateTree } from '../utils/cube-query-to-predicate-tree.js';
import {
  buildDisclosures,
  buildQueryDisclosures,
} from './propose-segment-disclosures.js';
import type { SegmentProposal } from './propose-segment.js';

// ---------------------------------------------------------------------------
// Result types (shared across all handlers)
// ---------------------------------------------------------------------------

export type OkResult = { ok: true; proposal_emitted: true; name: string; estCount: number };
export type ErrResult = {
  ok: false;
  error:
    | 'missing_threshold_value'
    | 'missing_percentile'
    | 'missing_top_n'
    | 'missing_population'
    | 'cutoff_failed'
    | 'invalid_over'
    | 'missing_filters'
    | 'missing_cube'
    | 'invalid_filters'
    | 'missing_measure'
    | 'unknown';
  detail: string;
};

// ---------------------------------------------------------------------------
// Cutoff resolution response shape from the server
// ---------------------------------------------------------------------------

export interface CutoffResponse {
  cutoff: number;
  populationCount: number;
  estCount: number;
}

// ---------------------------------------------------------------------------
// Shared arg shapes
// ---------------------------------------------------------------------------

/** Handler args for threshold / percentile / top_n — measure guaranteed non-null. */
export type MeasureHandlerArgs = {
  game_id: string;
  name: string;
  kind: 'threshold' | 'percentile' | 'top_n' | 'query';
  measure: SegmentableMeasure;
  threshold_value?: number;
  percentile_top_pct?: number;
  top_n?: number;
  filters?: CubeInputFilter[];
  cube?: string;
  suggested_visibility?: 'personal' | 'shared' | 'org';
  language?: 'en' | 'vi' | 'mixed';
};

/** Handler args for query kind — measure optional. */
export type QueryHandlerArgs = {
  game_id: string;
  name: string;
  kind: 'threshold' | 'percentile' | 'top_n' | 'query';
  measure?: SegmentableMeasure;
  threshold_value?: number;
  percentile_top_pct?: number;
  top_n?: number;
  filters?: CubeInputFilter[];
  cube?: string;
  suggested_visibility?: 'personal' | 'shared' | 'org';
  language?: 'en' | 'vi' | 'mixed';
};

// ---------------------------------------------------------------------------
// Cutoff resolution — shared by percentile and top_n handlers
// ---------------------------------------------------------------------------

export async function resolveCutoff(
  payload: { game_id: string; p: number; gte: boolean; over: PopulationOver },
  ctx: ToolContext,
): Promise<{ ok: true; data: CutoffResponse } | ErrResult> {
  try {
    const data = await postJson<CutoffResponse>(
      '/api/segments/resolve-cutoff',
      payload,
      ctx,
    );
    return { ok: true, data };
  } catch (err) {
    const detail =
      err instanceof ServerClientError
        ? `HTTP ${err.status}: ${JSON.stringify(err.body)}`
        : String(err);
    return { ok: false, error: 'cutoff_failed', detail };
  }
}

// ---------------------------------------------------------------------------
// Threshold path — fixed measure value, no server round-trip
// ---------------------------------------------------------------------------

export async function handleThreshold(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure } = args;

  if (args.threshold_value == null) {
    return {
      ok: false,
      error: 'missing_threshold_value',
      detail: 'threshold_value is required for kind=threshold.',
    };
  }

  const leaf: LeafNode = {
    kind: 'leaf',
    id: randomUUID(),
    member: measure.dimension,
    type: 'number',
    op: 'gte',
    values: [args.threshold_value],
  };
  const predicate: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children: [leaf] };

  const windowLabel = measure.window ?? 'lifetime';
  const currencyNote = measure.currency ? ` (${measure.currency})` : '';
  const disclosures = buildDisclosures({
    kind: 'threshold',
    label: measure.label,
    value: args.threshold_value,
    currency: measure.currency,
    window: measure.window,
    isVi,
  });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id: args.game_id,
    cube,
    predicate_tree: predicate,
    resolved: {
      // estCount unknown without a server call for a plain threshold; disclose this.
      estCount: 0,
      population: `${measure.label} ≥ ${args.threshold_value}${currencyNote} (${windowLabel})`,
    },
    disclosures: [
      ...disclosures,
      isVi
        ? 'Số lượng thành viên ước tính chưa được tính. Nhấn Xác nhận để lưu và làm mới.'
        : 'Estimated count not pre-computed for fixed thresholds. Confirm to save and refresh.',
    ],
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount: 0 };
}

// ---------------------------------------------------------------------------
// Query path — plain dimension filters from an already-explored Cube query
// ---------------------------------------------------------------------------

export async function handleQuery(opts: {
  args: QueryHandlerArgs;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, isVi, ctx, suggested_visibility } = opts;

  if (!args.filters || args.filters.length === 0) {
    return {
      ok: false,
      error: 'missing_filters',
      detail:
        'filters is required for kind=query. Pass the filters array from the ' +
        'Cube query the user just explored.',
    };
  }

  if (!args.cube || !args.cube.trim()) {
    return {
      ok: false,
      error: 'missing_cube',
      detail:
        'cube is required for kind=query. Pass the logical cube name ' +
        '(member prefix, e.g. "mf_users").',
    };
  }

  // Translate the Cube filters array to a PredicateNode. cubeQueryToPredicateTree
  // enforces all segment-legality guardrails (no measure filters, no time-in-OR,
  // no order+limit without a ranked measure).
  const translateResult = cubeQueryToPredicateTree({ filters: args.filters });
  if (!translateResult.ok) {
    return {
      ok: false,
      error: 'invalid_filters',
      detail: `${translateResult.reason}: ${translateResult.hint}`,
    };
  }

  const cube = args.cube.trim();
  const disclosures = buildQueryDisclosures({ name: args.name, cube, isVi });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id: args.game_id,
    cube,
    predicate_tree: translateResult.predicate,
    resolved: {
      // No cutoff for plain predicate segments. estCount is computed on confirm-refresh.
      estCount: 0,
      population: `matching the explored query filters on ${cube}`,
    },
    disclosures,
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount: 0 };
}
