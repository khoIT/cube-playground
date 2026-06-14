/**
 * Lens 2 — Trajectory (C).
 *
 * Measures whether the factor is trending up or down month-over-month: the last
 * 30 days vs the preceding 30 days (days 30–60 ago). A declining slope signals
 * "weak" even when the absolute level appears acceptable.
 * Direction = (value_recent − value_prior) / value_prior.
 *
 * Source: billing_detail.order_date provides the time dimension for revenue
 * factors. For lifespan/engagement the mf_users cube has no time dimension so
 * we proxy via last_active_date-filtered active user counts.
 *
 * asOf is threaded through so windows are reproducible against lagging data.
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult } from '../diagnosis-types.js';
import type { ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope, trailingWindowFilter } from '../scope-helpers.js';

/** Decline threshold: factor dropped > 10% from 90d to 30d window = weak. */
const DECLINE_THRESHOLD = -0.10;

/** Map factor key → { cube, measure, timeDimension } for trajectory queries. */
const FACTOR_TRAJECTORY: Record<string, { measure: string; timeDimension: string }> = {
  payers: {
    measure: 'billing_detail.paying_users',
    timeDimension: 'billing_detail.order_date',
  },
  arppu: {
    measure: 'billing_detail.cash_charged_gross',
    timeDimension: 'billing_detail.order_date',
  },
  lifespan: {
    // Proxy: count of users active in the trailing window (last_active_date).
    measure: 'mf_users.user_count',
    timeDimension: 'mf_users.last_active_date',
  },
};

interface TrajectoryLensInput {
  scope: ScopeRef;
  factor: string;
  asOf: Date;
}

export async function runLens02Trajectory(
  input: TrajectoryLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const mapping = FACTOR_TRAJECTORY[input.factor];
  if (!mapping) {
    return inconclusiveResult(input.factor, `No trajectory mapping for factor "${input.factor}"`);
  }

  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Compare two equal-length 30-day windows: the recent one (last 30d) vs the
    // one before it (days 30–60 ago). Equal lengths keep the comparison
    // dimensionally honest for additive measures (a 30d-sum vs 90d-sum is not),
    // and each window stays within the 31-day max span that high-volume cubes
    // like billing_detail enforce (a 90-day span hard-errors there).
    const [resultRecent, resultPrior] = await Promise.all([
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 30),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — last 30d`,
        reader,
      ),
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 30, 30),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — prior 30d (30–60d ago)`,
        reader,
      ),
    ]);

    const valRecent = extractScalar(resultRecent.rows, mapping.measure);
    const valPrior = extractScalar(resultPrior.rows, mapping.measure);

    if (valRecent === null || valPrior === null || valPrior === 0) {
      return inconclusiveResult(input.factor, 'Insufficient time-series data');
    }

    const slope = (valRecent - valPrior) / valPrior;
    const isWeak = slope < DECLINE_THRESHOLD;
    const verdict = isWeak ? 'weak' : slope > 0.05 ? 'strong' : 'ok';

    return {
      id: 2,
      name: 'Trajectory',
      verdict,
      factor: input.factor,
      inputs: { valRecent, valPrior, slopePct: Math.round(slope * 1000) / 10 },
      method: `${mapping.measure} last-30d=${valRecent} vs prior-30d=${valPrior}; slope=${Math.round(slope * 1000) / 10}%`,
      provenance: resultRecent.provenance,
    };
  } catch (err) {
    return inconclusiveResult(input.factor, (err as Error).message);
  }
}

function inconclusiveResult(factor: string, reason: string): LensResult {
  return {
    id: 2,
    name: 'Trajectory',
    verdict: 'inconclusive',
    factor,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'trajectory — unavailable' },
  };
}
