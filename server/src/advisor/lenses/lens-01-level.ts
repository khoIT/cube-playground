/**
 * Lens 1 — Level vs Population.
 *
 * Gauges where the segment's factor value sits relative to the game-wide value:
 * a RATIO-TO-POPULATION heuristic (segment aggregate ÷ population aggregate), not
 * a true distribution percentile. A ratio well below the population (< 25%) reads
 * as "weak". This is the absolute-position signal; Lens 3 (peers) gives the
 * relative-position signal across similar segments.
 *
 * Why a ratio, not a percentile: a genuine percentile rank needs the member-level
 * distribution (resolve a cutoff via the shared percentile resolver, then rank the
 * segment against it). For aggregate measures (e.g. an average ARPPU) the ratio is
 * a cheap, honest proxy for v1; a true member-distribution rank is a follow-up.
 *
 * Correlated-lens note: this level signal and a percentile of the same factor are
 * the same angle — lens-synthesis.ts treats them as ONE vote, not two.
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Ratio-to-population threshold (%) — segment below 25% of the population = weak. */
const WEAK_RATIO_PCT = 25;

/** Factor → Cube measure mapping for cfm_vn. */
const FACTOR_MEASURES: Record<string, string> = {
  payers: 'mf_users.paying_users',
  arppu: 'mf_users.arppu_vnd',
  lifespan: 'mf_users.avg_total_active_days',
};

interface LevelLensInput {
  scope: ScopeRef;
  factor: string;
  asOf: Date;
}

/**
 * Run Lens 1 for a single factor.
 * Returns verdict='inconclusive' on any Cube error so the engine doesn't abort.
 */
export async function runLens01Level(
  input: LevelLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const measure = FACTOR_MEASURES[input.factor];
  if (!measure) {
    return inconclusiveResult(input.factor, `No measure mapping for factor "${input.factor}"`);
  }

  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Step 1: measure the segment's aggregate value.
    const segResult = await readWithProvenance(
      {
        measures: [measure],
        filters: scopeFilters,
      },
      ctx,
      `mf_users / ${gameId} — segment level`,
      reader,
    );
    const segValue = extractScalar(segResult.rows, measure);

    // Step 2: measure the game-wide value (population baseline).
    const popResult = await readWithProvenance(
      {
        measures: [measure],
        // No scope filter = full game population
      },
      ctx,
      `mf_users / ${gameId} — population`,
      reader,
    );
    const popValue = extractScalar(popResult.rows, measure);

    if (segValue === null || popValue === null || popValue === 0) {
      return inconclusiveResult(input.factor, 'Could not read segment or population value');
    }

    // Ratio of the segment's aggregate to the population aggregate. Below 25% of
    // the population reads as "weak", at/above 75% as "strong". This is a level
    // heuristic, NOT a distribution percentile (see file header).
    const ratioToPopulation = segValue / popValue;
    const ratioPct = Math.round(ratioToPopulation * 100);
    const isWeak = ratioPct < WEAK_RATIO_PCT;

    return {
      id: 1,
      name: 'Level vs Population',
      verdict: isWeak ? 'weak' : ratioPct >= 75 ? 'strong' : 'ok',
      factor: input.factor,
      inputs: {
        segValue,
        popValue,
        ratioToPopulation: Math.round(ratioToPopulation * 1000) / 1000,
        ratioPct,
      },
      method: `Segment ${measure} = ${segValue}; population = ${popValue}; ratio ≈ ${ratioPct}% of population (level heuristic, not a percentile)`,
      provenance: segResult.provenance,
    };
  } catch (err) {
    return inconclusiveResult(input.factor, (err as Error).message);
  }
}

function inconclusiveResult(factor: string, reason: string): LensResult {
  return {
    id: 1,
    name: 'Level vs Population',
    verdict: 'inconclusive',
    factor,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: {
      measures: [],
      source: 'level-vs-population — unavailable',
    },
  };
}
