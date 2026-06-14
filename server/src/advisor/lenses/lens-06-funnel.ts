/**
 * Lens 6 — Funnel / Conversion (lazy).
 *
 * Measures stage-conversion rates through the revenue funnel:
 *   engaged users → payers → repeat payers → whales
 *
 * A low engaged→payer rate signals acquisition/monetisation friction.
 * A low payer→repeat rate signals single-purchase churn (ARPPU ceiling).
 * A low repeat→whale rate signals depth-of-spend ceiling.
 *
 * Lazy: only executed when caller includes lens id 6.
 * Source: mf_users dimensions (is_paying_user, payer_tier, total_active_days).
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Minimum acceptable engaged→payer conversion rate. */
const MIN_ENGAGEMENT_TO_PAYER = 0.05; // 5%

interface FunnelLensInput {
  scope: ScopeRef;
  asOf: Date;
}

export async function runLens06Funnel(
  input: FunnelLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Fetch all user counts in one query using available mf_users measures.
    const result = await readWithProvenance(
      {
        measures: [
          'mf_users.user_count',
          'mf_users.paying_users',
          'mf_users.paying_users_30d',
          'mf_users.whales_count',
        ],
        filters: scopeFilters,
      },
      ctx,
      `mf_users / ${gameId} — funnel stages`,
      reader,
    );

    const total = extractScalar(result.rows, 'mf_users.user_count');
    const payers = extractScalar(result.rows, 'mf_users.paying_users');
    const recentPayers = extractScalar(result.rows, 'mf_users.paying_users_30d');
    const whales = extractScalar(result.rows, 'mf_users.whales_count');

    if (!total || total === 0) {
      return inconclusiveResult('Empty user cohort');
    }

    const engagedToPayer = payers !== null ? payers / total : null;
    const payerToRepeat = payers && payers > 0 && recentPayers !== null
      ? recentPayers / payers
      : null;
    const repeatToWhale = recentPayers && recentPayers > 0 && whales !== null
      ? whales / recentPayers
      : null;

    // Weak when the top-of-funnel conversion is below threshold.
    const weakConversion = engagedToPayer !== null && engagedToPayer < MIN_ENGAGEMENT_TO_PAYER;

    return {
      id: 6,
      name: 'Funnel / Conversion',
      verdict: weakConversion ? 'weak' : 'ok',
      factor: 'payers',
      inputs: {
        total,
        payers,
        recentPayers,
        whales,
        engagedToPayerPct: engagedToPayer !== null ? Math.round(engagedToPayer * 1000) / 10 : null,
        payerToRepeatPct: payerToRepeat !== null ? Math.round(payerToRepeat * 1000) / 10 : null,
        repeatToWhalePct: repeatToWhale !== null ? Math.round(repeatToWhale * 1000) / 10 : null,
      },
      method: `Funnel: ${total} users → ${payers} payers (${engagedToPayer !== null ? Math.round(engagedToPayer * 100) : '?'}%) → ${recentPayers} active-30d → ${whales} whales`,
      provenance: result.provenance,
    };
  } catch (err) {
    return inconclusiveResult((err as Error).message);
  }
}

function inconclusiveResult(reason: string): LensResult {
  return {
    id: 6,
    name: 'Funnel / Conversion',
    verdict: 'inconclusive',
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'funnel — unavailable' },
  };
}
