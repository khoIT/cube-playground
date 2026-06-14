/**
 * Lens 3 — Peer / Look-alike (B).
 *
 * Compares the segment's factor value against similar segments in the same game
 * (same payer-tier bracket). Uses the derived-date + percentile
 * operators via mf_users payer_tier dimension for peer bucketing.
 *
 * Peer definition: users in the same payer_tier as the median of the segment.
 * This gives a "within-tier" relative position — a whale segment that's weak
 * vs other whale segments is a different problem than a segment that's weak vs
 * all users.
 *
 * When peer data is unavailable (small game, missing tier dimension), degrades
 * to 'inconclusive' with an explanatory note.
 */

import type { WorkspaceCtx } from '../../services/cube-client.js';
import type { LensResult, ScopeRef } from '../diagnosis-types.js';
import { readWithProvenance, extractScalar, type CubeReaderFn } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Factor → measure for peer comparison (segment value vs same-tier cohort). */
const FACTOR_MEASURES: Record<string, string> = {
  payers: 'mf_users.paying_users',
  arppu: 'mf_users.arppu_vnd',
  lifespan: 'mf_users.total_active_days',
};

/** Payer tiers available in mf_users.payer_tier dimension. */
const PAYER_TIERS = ['whale', 'dolphin', 'minnow', 'non_payer'] as const;
type PayerTier = typeof PAYER_TIERS[number];

interface PeerLensInput {
  scope: ScopeRef;
  factor: string;
  /** Dominant payer tier of this segment (e.g. "whale"). Supplied by engine. */
  dominantTier?: PayerTier;
  asOf: Date;
}

export async function runLens03Peer(
  input: PeerLensInput,
  ctx: WorkspaceCtx,
  reader?: CubeReaderFn,
): Promise<LensResult> {
  const measure = FACTOR_MEASURES[input.factor];
  if (!measure) {
    return inconclusiveResult(input.factor, `No peer measure for factor "${input.factor}"`);
  }

  // If no dominant tier is supplied the peer population is undefined — skip.
  if (!input.dominantTier) {
    return inconclusiveResult(input.factor, 'Dominant payer tier not determined for this segment');
  }

  const gameId = gameIdFromScope(input.scope);
  const scopeFilters = scopeToFilters(input.scope);

  try {
    // Segment value.
    const segResult = await readWithProvenance(
      { measures: [measure], filters: scopeFilters },
      ctx,
      `mf_users / ${gameId} — segment`,
      reader,
    );
    const segValue = extractScalar(segResult.rows, measure);

    // Peer (same-tier) value — population filtered to same payer_tier.
    const peerFilter = {
      member: 'mf_users.payer_tier',
      operator: 'equals',
      values: [input.dominantTier],
    };
    const peerResult = await readWithProvenance(
      { measures: [measure], filters: [peerFilter] },
      ctx,
      `mf_users / ${gameId} — ${input.dominantTier} tier peers`,
      reader,
    );
    const peerValue = extractScalar(peerResult.rows, measure);

    if (segValue === null || peerValue === null || peerValue === 0) {
      return inconclusiveResult(input.factor, 'Insufficient data for peer comparison');
    }

    // Gap vs same-tier peers.
    const ratioPct = (segValue / peerValue) * 100;
    const isWeak = ratioPct < 80; // below 80% of peers = weak
    const isStrong = ratioPct >= 110;

    return {
      id: 3,
      name: 'Peer / Look-alike',
      verdict: isWeak ? 'weak' : isStrong ? 'strong' : 'ok',
      factor: input.factor,
      inputs: {
        segValue,
        peerValue,
        tier: input.dominantTier,
        ratioPct: Math.round(ratioPct * 10) / 10,
      },
      method: `${measure}: segment=${segValue} vs ${input.dominantTier}-tier peers=${peerValue}; ratio=${Math.round(ratioPct)}%`,
      provenance: {
        ...peerResult.provenance,
        filters: [peerFilter],
      },
    };
  } catch (err) {
    return inconclusiveResult(input.factor, (err as Error).message);
  }
}

function inconclusiveResult(factor: string, reason: string): LensResult {
  return {
    id: 3,
    name: 'Peer / Look-alike',
    verdict: 'inconclusive',
    factor,
    inputs: { reason },
    method: `Inconclusive: ${reason}`,
    provenance: { measures: [], source: 'peer-lookalike — unavailable' },
  };
}
