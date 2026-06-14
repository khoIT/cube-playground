/**
 * Lens 2 — Trajectory (C).
 *
 * Measures whether the factor is trending up or down over trailing 30/60/90-day
 * windows. A declining slope signals "weak" even when the absolute level appears
 * acceptable. Direction = (value_30d − value_90d) / value_90d.
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
    // Query 30-day and 90-day trailing windows and compare direction.
    const [result30, result90] = await Promise.all([
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 30),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — trailing 30d`,
        reader,
      ),
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 90),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — trailing 90d`,
        reader,
      ),
    ]);

    const val30 = extractScalar(result30.rows, mapping.measure);
    const val90 = extractScalar(result90.rows, mapping.measure);

    if (val30 === null || val90 === null || val90 === 0) {
      return inconclusiveResult(input.factor, 'Insufficient time-series data');
    }

    const slope = (val30 - val90) / val90;
    const isWeak = slope < DECLINE_THRESHOLD;
    const verdict = isWeak ? 'weak' : slope > 0.05 ? 'strong' : 'ok';

    return {
      id: 2,
      name: 'Trajectory',
      verdict,
      factor: input.factor,
      inputs: { val30, val90, slopePct: Math.round(slope * 1000) / 10 },
      method: `${mapping.measure} 30d=${val30} vs 90d=${val90}; slope=${Math.round(slope * 1000) / 10}%`,
      provenance: result30.provenance,
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
