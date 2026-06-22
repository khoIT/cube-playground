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
import type { LeafNode, GroupNode, LeafOperator, LeafValueType } from '../types/predicate-tree.js';
import type { CubeInputFilter } from '../utils/cube-query-to-predicate-tree.js';
import { cubeQueryToPredicateTree } from '../utils/cube-query-to-predicate-tree.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
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

/**
 * A simple extra condition AND-ed onto the main threshold/percentile/top_n leaf
 * so a single proposal can express a compound predicate (e.g. "top 25% by active
 * days AND ltv_vnd = 0"). Plain comparison ops only — no cutoff resolution.
 */
export type AdditionalFilter = {
  member: string;
  operator: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte' | 'set' | 'notSet';
  values?: (string | number)[];
};

/** Handler args for threshold / percentile / top_n — measure guaranteed non-null. */
export type MeasureHandlerArgs = {
  game_id: string;
  name: string;
  kind: 'threshold' | 'percentile' | 'top_n' | 'query';
  measure: SegmentableMeasure;
  threshold_value?: number;
  threshold_op?: 'gte' | 'lte';
  threshold_value_max?: number;
  percentile_top_pct?: number;
  top_n?: number;
  filters?: CubeInputFilter[];
  additional_filters?: AdditionalFilter[];
  cube?: string;
  suggested_visibility?: 'personal' | 'shared' | 'org';
  language?: 'en' | 'vi' | 'mixed';
};

const VALUE_LESS_OPS = new Set<LeafOperator>(['set', 'notSet']);
const OP_SYMBOL: Record<string, string> = {
  equals: '=', notEquals: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
  set: 'is set', notSet: 'is not set',
};

/**
 * Translate `additional_filters` into AND-able leaves, validating each member
 * belongs to the same logical cube and carries a value when the op needs one.
 * Returns the leaves plus a human-readable summary for the disclosures.
 */
export function buildAdditionalLeaves(
  filters: AdditionalFilter[] | undefined,
  cube: string,
): { ok: true; leaves: LeafNode[]; summary: string[] } | ErrResult {
  if (!filters || filters.length === 0) return { ok: true, leaves: [], summary: [] };

  const leaves: LeafNode[] = [];
  const summary: string[] = [];
  for (const f of filters) {
    if (!f.member.startsWith(`${cube}.`)) {
      return {
        ok: false,
        error: 'invalid_filters',
        detail:
          `additional_filters member "${f.member}" must belong to cube "${cube}" ` +
          `(prefix "${cube}."). Mixing cubes in one segment predicate is not supported.`,
      };
    }
    const needsValue = !VALUE_LESS_OPS.has(f.operator);
    const values = f.values ?? [];
    if (needsValue && values.length === 0) {
      return {
        ok: false,
        error: 'invalid_filters',
        detail: `additional_filters "${f.member}" with operator "${f.operator}" needs at least one value.`,
      };
    }
    // Numeric type only when every supplied value is a number (e.g. ltv_vnd = 0).
    const type: LeafValueType =
      needsValue && values.every((v) => typeof v === 'number') ? 'number' : 'string';
    leaves.push({
      kind: 'leaf',
      id: randomUUID(),
      member: f.member,
      type,
      op: f.operator as LeafOperator,
      values: needsValue ? values : [],
    });
    const sym = OP_SYMBOL[f.operator] ?? f.operator;
    summary.push(needsValue ? `${f.member} ${sym} ${values.join(', ')}` : `${f.member} ${sym}`);
  }
  return { ok: true, leaves, summary };
}

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

  // Range threshold: when threshold_value_max is given, the predicate is a band
  // (measure >= threshold_value AND measure <= threshold_value_max). Otherwise a
  // single bound whose direction is threshold_op (gte default; lte = upper bound
  // like "fewer than 3 active days"). Either way no query-path detour is needed —
  // the query path rejects measure members, so measure bands live here.
  const isRange = args.threshold_value_max != null;
  if (isRange && (args.threshold_value_max as number) < args.threshold_value) {
    return {
      ok: false,
      error: 'missing_threshold_value',
      detail:
        `threshold_value_max (${args.threshold_value_max}) must be ≥ threshold_value ` +
        `(${args.threshold_value}) for a range threshold.`,
    };
  }

  const thresholdLeaves: LeafNode[] = isRange
    ? [
        { kind: 'leaf', id: randomUUID(), member: measure.dimension, type: 'number', op: 'gte', values: [args.threshold_value] },
        { kind: 'leaf', id: randomUUID(), member: measure.dimension, type: 'number', op: 'lte', values: [args.threshold_value_max as number] },
      ]
    : [
        {
          kind: 'leaf',
          id: randomUUID(),
          member: measure.dimension,
          type: 'number',
          op: args.threshold_op === 'lte' ? 'lte' : 'gte',
          values: [args.threshold_value],
        },
      ];

  // Optional extra conditions (e.g. ltv_vnd = 0) AND-ed onto the threshold so a
  // single proposal can express a compound predicate.
  const extra = buildAdditionalLeaves(args.additional_filters, cube);
  if (!extra.ok) return extra;

  const predicate: GroupNode = {
    kind: 'group',
    id: randomUUID(),
    op: 'AND',
    children: [...thresholdLeaves, ...extra.leaves],
  };

  const windowLabel = measure.window ?? 'lifetime';
  const currencyNote = measure.currency ? ` (${measure.currency})` : '';
  const disclosures = buildDisclosures({
    kind: 'threshold',
    label: measure.label,
    value: args.threshold_value,
    op: args.threshold_op === 'lte' ? 'lte' : 'gte',
    valueMax: isRange ? (args.threshold_value_max as number) : undefined,
    currency: measure.currency,
    window: measure.window,
    isVi,
  });
  if (extra.summary.length > 0) {
    disclosures.push(
      (isVi ? 'Kèm điều kiện: ' : 'Also requires: ') + extra.summary.join(isVi ? ' VÀ ' : ' AND '),
    );
  }

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

  // Resolve the measure members of the target cube so a measure smuggled into a
  // kind=query filter is rejected (with the corrected threshold/percentile call)
  // instead of silently producing a segment the refresh engine cannot evaluate.
  // Best-effort: a meta-fetch failure falls back to an empty set, which only
  // disables the measure-vs-dimension check — valid dimension filters still pass.
  let measureNames = new Set<string>();
  try {
    const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
    measureNames = cubeMetaCache.extractMeasureNames(meta, args.cube.trim());
  } catch {
    // leave measureNames empty — preserves prior behaviour on meta outages
  }

  // Translate the Cube filters array to a PredicateNode. cubeQueryToPredicateTree
  // enforces all segment-legality guardrails (no measure filters, no time-in-OR,
  // no order+limit without a ranked measure).
  const translateResult = cubeQueryToPredicateTree({ filters: args.filters }, measureNames);
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
