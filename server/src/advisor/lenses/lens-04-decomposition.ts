/**
 * Lens 4 — Decomposition (growth accounting).
 *
 * The spine lens: decomposes Revenue = payers × ARPPU × lifespan and picks the
 * single bottleneck factor — the one with the largest relative gap vs the game
 * population. A/B/C (lenses 1–3) then corroborate whether that factor is
 * genuinely weak. Confidence = how many of 1/2/3 agree.
 *
 * Cube measures used (cfm_vn):
 *   payers    → mf_users.paying_users  (count_distinct paying users)
 *   arppu     → mf_users.arppu_vnd     (lifetime ARPPU in VND)
 *   lifespan  → mf_users.avg_total_active_days (avg total active days for payers)
 *
 * The segment's three factor values are fetched in one Cube query (single round
 * trip). The game-wide baseline is fetched in a second query with no filters.
 * pickBottleneckFactor() from goal-tree.ts selects the worst gap.
 *
 * Live smoke test on segment 5ee78131… (cfm_vn whale segment) is DEFERRED to
 * a host with Cube connectivity — this machine has no TRINO_PROFILER_HOST /
 * live Cube available. The test harness injects a stub reader; assertions
 * confirm payer-lifespan is picked as bottleneck given a fixture where lifespan
 * is below baseline.
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef, PlaygroundLink } from '../diagnosis-types.js';
import type { RevenueFactorValues, BaselineValues } from '../goal-tree.js';
import { buildRevenueGoalTree, pickBottleneckFactor, factorGap } from '../goal-tree.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/**
 * Measures fetched in one query for all three revenue factors, plus user_count
 * as the denominator that turns the payer COUNT into a payer conversion RATE
 * (see goal-tree.buildRevenueGoalTree). Without the denominator a sub-segment's
 * payer count is always smaller than the population's, flagging every cohort
 * weak by construction.
 */
const REVENUE_MEASURES = [
  'mf_users.paying_users',
  'mf_users.user_count',
  'mf_users.arppu_vnd',
  'mf_users.avg_total_active_days',
] as const;

interface DecompositionLensInput {
  scope: ScopeRef;
  asOf: Date;
}

export interface DecompositionLensResult extends LensResult {
  id: 4;
  /** The bottleneck factor key picked by decomposition (e.g. "lifespan"). */
  bottleneckFactor: string | null;
  /** All three gap metrics — used by synthesis to rank all factors, not just the worst. */
  allFactorGaps: Record<string, { gapPct: number; gapValue: number; weak: boolean }>;
}

export async function runLens04Decomposition(
  input: DecompositionLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<DecompositionLensResult> {
  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Single round-trip: all three measures for segment + population.
    const [segResult, popResult] = await Promise.all([
      readWithProvenance(
        { measures: [...REVENUE_MEASURES], filters: scopeFilters },
        ctx,
        `mf_users / ${gameId} — segment decomposition`,
        reader,
      ),
      readWithProvenance(
        { measures: [...REVENUE_MEASURES] },
        ctx,
        `mf_users / ${gameId} — population decomposition`,
        reader,
      ),
    ]);

    const observed: RevenueFactorValues = {
      payers: extractScalar(segResult.rows, 'mf_users.paying_users'),
      users: extractScalar(segResult.rows, 'mf_users.user_count'),
      arppu: extractScalar(segResult.rows, 'mf_users.arppu_vnd'),
      lifespan: extractScalar(segResult.rows, 'mf_users.avg_total_active_days'),
    };

    const baseline: BaselineValues = {
      payers: extractScalar(popResult.rows, 'mf_users.paying_users'),
      users: extractScalar(popResult.rows, 'mf_users.user_count'),
      arppu: extractScalar(popResult.rows, 'mf_users.arppu_vnd'),
      lifespan: extractScalar(popResult.rows, 'mf_users.avg_total_active_days'),
    };

    // Check for empty cohort: all measures null or zero.
    if (observed.payers === 0 || observed.payers === null) {
      return emptyResult('Empty cohort — no paying users in segment');
    }

    const tree = buildRevenueGoalTree(observed, baseline);
    const bottleneck = pickBottleneckFactor(tree);

    // Collect gaps for all factors so synthesis can rank even non-bottlenecks.
    const allFactorGaps: Record<string, { gapPct: number; gapValue: number; weak: boolean }> = {};
    for (const f of tree.factors) {
      const { gapPct, gapValue } = factorGap(f);
      allFactorGaps[f.key] = { gapPct, gapValue, weak: f.weak };
    }

    const bottleneckFactor = bottleneck?.key ?? null;

    const provenance: PlaygroundLink = {
      ...segResult.provenance,
      measures: [...REVENUE_MEASURES],
    };

    const methodParts = tree.factors.map(
      (f) => `${f.key}=${f.value ?? 'N/A'} (baseline=${f.baseline ?? 'N/A'})`,
    );

    return {
      id: 4,
      name: 'Decomposition',
      verdict: bottleneck?.weak ? 'weak' : 'ok',
      factor: bottleneckFactor ?? undefined,
      inputs: { observed, baseline, bottleneckFactor },
      method: `Growth accounting: ${methodParts.join('; ')}. Bottleneck: ${bottleneckFactor ?? 'none'}`,
      provenance,
      bottleneckFactor,
      allFactorGaps,
    };
  } catch (err) {
    return errorResult((err as Error).message);
  }
}

function emptyResult(reason: string): DecompositionLensResult {
  return {
    id: 4,
    name: 'Decomposition',
    verdict: 'inconclusive',
    factor: undefined,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [...REVENUE_MEASURES], source: 'decomposition — empty cohort' },
    bottleneckFactor: null,
    allFactorGaps: {},
  };
}

function errorResult(reason: string): DecompositionLensResult {
  return {
    id: 4,
    name: 'Decomposition',
    verdict: 'inconclusive',
    factor: undefined,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [...REVENUE_MEASURES], source: 'decomposition — error' },
    bottleneckFactor: null,
    allFactorGaps: {},
  };
}
