/**
 * Lens 5 — Concentration / Pareto (lazy).
 *
 * Measures revenue concentration: what share of total revenue comes from the
 * top-decile payers? High concentration (>80% from top 10%) signals that
 * lifespan/engagement of mid-tier payers is the lever — losing one whale
 * is catastrophic, so diversification depth matters.
 *
 * Lazy: only executed when caller passes lenses:[5,...] in options.
 * Source: billing_lifetime — payers + lifetime_vnd_total (gateway-charged,
 * reconciliation-grade; good enough for concentration shape even if absolute
 * level differs from mf_users.ltv_total_vnd).
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Above this concentration the revenue base is fragile — weak signal. */
const HIGH_CONCENTRATION_THRESHOLD = 0.80;

interface ParetoLensInput {
  scope: ScopeRef;
  asOf: Date;
}

export async function runLens05Pareto(
  input: ParetoLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Total revenue for the segment.
    const totalResult = await readWithProvenance(
      {
        measures: ['billing_lifetime.lifetime_vnd_total', 'billing_lifetime.payers'],
        filters: scopeFilters,
      },
      ctx,
      `billing_lifetime / ${gameId} — total revenue`,
      reader,
    );

    const totalRevenue = extractScalar(totalResult.rows, 'billing_lifetime.lifetime_vnd_total');
    const totalPayers = extractScalar(totalResult.rows, 'billing_lifetime.payers');

    if (!totalRevenue || !totalPayers || totalPayers < 10) {
      return inconclusiveResult('Insufficient payer count for Pareto analysis');
    }

    // Top-decile revenue: users with lifetime_vnd >= P90 cutoff.
    // We approximate by filtering to payer_tier=whale (top 10% heuristic for cfm_vn).
    const whaleFilter = { member: 'mf_users.payer_tier', operator: 'equals', values: ['whale'] };
    const topResult = await readWithProvenance(
      {
        measures: ['billing_lifetime.lifetime_vnd_total'],
        filters: [...scopeFilters, whaleFilter],
      },
      ctx,
      `billing_lifetime / ${gameId} — whale tier revenue`,
      reader,
    );

    const topRevenue = extractScalar(topResult.rows, 'billing_lifetime.lifetime_vnd_total') ?? 0;
    const concentrationRatio = totalRevenue > 0 ? topRevenue / totalRevenue : 0;

    const isHighConcentration = concentrationRatio > HIGH_CONCENTRATION_THRESHOLD;

    return {
      id: 5,
      name: 'Concentration / Pareto',
      verdict: isHighConcentration ? 'weak' : 'ok',
      factor: 'payers',
      inputs: { totalRevenue, topRevenue, concentrationRatio: Math.round(concentrationRatio * 1000) / 10 },
      method: `Top-whale revenue share = ${Math.round(concentrationRatio * 100)}% of total`,
      provenance: totalResult.provenance,
    };
  } catch (err) {
    return inconclusiveResult((err as Error).message);
  }
}

function inconclusiveResult(reason: string): LensResult {
  return {
    id: 5,
    name: 'Concentration / Pareto',
    verdict: 'inconclusive',
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'pareto — unavailable' },
  };
}
