/**
 * Lens 9 — Anomaly / Change-point (lazy).
 *
 * Detects whether a factor's value changed significantly in a recent window
 * compared to a longer historical baseline. A change-point (sudden drop) on
 * payers or revenue signals an event-driven problem (game patch, billing
 * outage, competitive shock) rather than a structural weakness — the
 * intervention lever is different.
 *
 * Method: compare the 7-day trailing mean against the 30–90-day trailing mean.
 * If the ratio drops >20% it is flagged as an anomaly ("weak" = structurally
 * below baseline AND recently deteriorated).
 *
 * Lazy: only executed when caller includes lens id 9.
 * Source: billing_detail (order_date time dimension, cash_charged_gross measure).
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope, trailingWindowFilter } from '../scope-helpers.js';

/** Drop ratio that triggers the anomaly flag. */
const ANOMALY_DROP_THRESHOLD = -0.20; // 20% decline in 7d vs 30-90d mean

interface AnomalyLensInput {
  scope: ScopeRef;
  factor: string;
  asOf: Date;
}

/** Factor → time-dimension + measure for change-point queries. */
const FACTOR_ANOMALY: Record<string, { measure: string; timeDimension: string }> = {
  payers: {
    measure: 'billing_detail.paying_users',
    timeDimension: 'billing_detail.order_date',
  },
  arppu: {
    measure: 'billing_detail.cash_charged_gross',
    timeDimension: 'billing_detail.order_date',
  },
  lifespan: {
    // Proxy: recently-active user count using last_active_date.
    measure: 'mf_users.user_count',
    timeDimension: 'mf_users.last_active_date',
  },
};

export async function runLens09Anomaly(
  input: AnomalyLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const mapping = FACTOR_ANOMALY[input.factor];
  if (!mapping) {
    return inconclusiveResult(input.factor, `No anomaly mapping for factor "${input.factor}"`);
  }

  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Recent window (7d) vs historical baseline (30–90d ago).
    // Historical = value in the 30–90d window, daily-averaged to normalize length.
    const [recent7d, hist30d] = await Promise.all([
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 7),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — trailing 7d`,
        reader,
      ),
      readWithProvenance(
        {
          measures: [mapping.measure],
          filters: [
            ...scopeFilters,
            trailingWindowFilter(mapping.timeDimension, input.asOf, 30),
          ],
        },
        ctx,
        `${mapping.measure} / ${gameId} — trailing 30d baseline`,
        reader,
      ),
    ]);

    const val7 = extractScalar(recent7d.rows, mapping.measure);
    const val30 = extractScalar(hist30d.rows, mapping.measure);

    if (val7 === null || val30 === null || val30 === 0) {
      return inconclusiveResult(input.factor, 'Insufficient time-series data for anomaly detection');
    }

    // Normalise by window length so 7d totals are comparable to 30d totals.
    const daily7 = val7 / 7;
    const daily30 = val30 / 30;

    const changeRatio = (daily7 - daily30) / daily30;
    const isAnomaly = changeRatio < ANOMALY_DROP_THRESHOLD;

    return {
      id: 9,
      name: 'Anomaly / Change-point',
      verdict: isAnomaly ? 'weak' : 'ok',
      factor: input.factor,
      inputs: {
        val7,
        val30,
        daily7: Math.round(daily7 * 100) / 100,
        daily30: Math.round(daily30 * 100) / 100,
        changeRatioPct: Math.round(changeRatio * 1000) / 10,
      },
      method: `7d daily avg=${Math.round(daily7)} vs 30d daily avg=${Math.round(daily30)}; change=${Math.round(changeRatio * 100)}%`,
      provenance: recent7d.provenance,
    };
  } catch (err) {
    return inconclusiveResult(input.factor, (err as Error).message);
  }
}

function inconclusiveResult(factor: string, reason: string): LensResult {
  return {
    id: 9,
    name: 'Anomaly / Change-point',
    verdict: 'inconclusive',
    factor,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'anomaly — unavailable' },
  };
}
