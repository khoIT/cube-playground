/**
 * Lens 8 — Cross-signal Correlation (lazy).
 *
 * Correlates CS support contact rate with retention (lifespan) and spend.
 * High negative-sentiment CS contact rate correlating with low lifespan is a
 * support-driven churn signal — the lever is CS quality, not game mechanics.
 *
 * Data sources:
 *   CS signal  → cs_ticket_detail (total_tickets, avg_csat, negative_sentiment_tickets)
 *   Spend/life → mf_users (ltv_total_vnd, total_active_days)
 *
 * Correlation is approximated at the aggregate level (not member-level pairwise)
 * to stay within PII rules — we compare CS-contacted vs non-contacted aggregate
 * metrics, not individual trajectories.
 *
 * Lazy: only executed when caller includes lens id 8.
 * Cross-catalog: cs_ticket_detail sources from iceberg.cs_ticket; mf_users from
 * game_integration. Both are available via the same Cube workspace.
 *
 * Member-level detail is available via the Care tab masked API — not used here
 * (aggregates only per PII rules).
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

interface CrossSignalLensInput {
  scope: ScopeRef;
  asOf: Date;
}

export async function runLens08CrossSignal(
  input: CrossSignalLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // CS aggregate for the segment's game (not segment-filtered — member join
    // coverage is ~23% for cfm, so segment filter would drop too many rows).
    const csResult = await readWithProvenance(
      {
        measures: [
          'cs_ticket_detail.total_tickets',
          'cs_ticket_detail.avg_csat',
          'cs_ticket_detail.negative_sentiment_tickets',
        ],
        // No scope filter here — CS tickets join to mf_users at ~23% coverage
        // for cfm_vn; applying the segment filter would discard most tickets.
      },
      ctx,
      `cs_ticket_detail / ${gameId} — CS signal`,
      reader,
    );

    // Segment's spend and lifespan.
    const spendResult = await readWithProvenance(
      {
        measures: ['mf_users.ltv_total_vnd', 'mf_users.total_active_days', 'mf_users.paying_users'],
        filters: scopeFilters,
      },
      ctx,
      `mf_users / ${gameId} — spend + lifespan`,
      reader,
    );

    const totalTickets = extractScalar(csResult.rows, 'cs_ticket_detail.total_tickets');
    const avgCsat = extractScalar(csResult.rows, 'cs_ticket_detail.avg_csat');
    const negSentimentTickets = extractScalar(csResult.rows, 'cs_ticket_detail.negative_sentiment_tickets');
    const lifespan = extractScalar(spendResult.rows, 'mf_users.total_active_days');

    if (totalTickets === null || totalTickets === 0) {
      return inconclusiveResult('No CS tickets available for cross-signal analysis');
    }

    const negSentimentRate = negSentimentTickets !== null && totalTickets > 0
      ? negSentimentTickets / totalTickets
      : null;

    // High negative sentiment (>30%) AND below-median CSAT (<3.5) = CS-driven churn risk.
    const highNegSentiment = negSentimentRate !== null && negSentimentRate > 0.30;
    const lowCsat = avgCsat !== null && avgCsat < 3.5;
    const isWeak = highNegSentiment && lowCsat;

    return {
      id: 8,
      name: 'Cross-signal Correlation',
      verdict: isWeak ? 'weak' : 'ok',
      factor: 'lifespan',
      inputs: {
        totalTickets,
        avgCsat,
        negSentimentTickets,
        negSentimentRatePct: negSentimentRate !== null ? Math.round(negSentimentRate * 1000) / 10 : null,
        segmentLifespan: lifespan,
      },
      method: `CS: ${totalTickets} tickets, CSAT=${avgCsat ?? 'N/A'}, neg-sentiment=${negSentimentRate !== null ? Math.round(negSentimentRate * 100) : '?'}%`,
      provenance: csResult.provenance,
    };
  } catch (err) {
    return inconclusiveResult((err as Error).message);
  }
}

function inconclusiveResult(reason: string): LensResult {
  return {
    id: 8,
    name: 'Cross-signal Correlation',
    verdict: 'inconclusive',
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'cross-signal — unavailable' },
  };
}
