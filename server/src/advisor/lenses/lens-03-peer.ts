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
import { readWithProvenance, extractScalar, type CubeReaderFn, type CubeRow } from '../cube-read.js';
import { scopeToFilters, gameIdFromScope } from '../scope-helpers.js';

/** Factor → measure for peer comparison (segment value vs same-tier cohort). */
const FACTOR_MEASURES: Record<string, string> = {
  payers: 'mf_users.paying_users',
  arppu: 'mf_users.arppu_vnd',
  lifespan: 'mf_users.avg_total_active_days',
};

/**
 * Denominator for extensive count factors so the peer comparison is a rate, not
 * a slice-size artefact (mirrors lens-01). Without it, the segment's payer count
 * vs the whole tier's payer count always reads as a smaller slice → "weak".
 */
const FACTOR_DENOMINATOR: Record<string, string> = {
  payers: 'mf_users.user_count',
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
  const denominator = FACTOR_DENOMINATOR[input.factor];
  const measures = denominator ? [measure, denominator] : [measure];

  try {
    // Segment value (+ denominator for count factors).
    const segResult = await readWithProvenance(
      { measures, filters: scopeFilters },
      ctx,
      `mf_users / ${gameId} — segment`,
      reader,
    );

    // Peer (same-tier) value — population filtered to same payer_tier.
    const peerFilter = {
      member: 'mf_users.payer_tier',
      operator: 'equals',
      values: [input.dominantTier],
    };
    const peerResult = await readWithProvenance(
      { measures, filters: [peerFilter] },
      ctx,
      `mf_users / ${gameId} — ${input.dominantTier} tier peers`,
      reader,
    );

    // Compare conversion RATE for count factors so a smaller cohort isn't read
    // as a weaker one; intensive factors compare their aggregate directly.
    const segValue = ratioValue(segResult.rows, measure, denominator);
    const peerValue = ratioValue(peerResult.rows, measure, denominator);

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

/**
 * Extract `measure`, dividing by `denominator` when supplied (count → rate).
 * Returns null on a missing numerator or missing/zero denominator.
 */
function ratioValue(rows: CubeRow[], measure: string, denominator?: string): number | null {
  const num = extractScalar(rows, measure);
  if (num === null) return null;
  if (!denominator) return num;
  const den = extractScalar(rows, denominator);
  if (den === null || den === 0) return null;
  return num / den;
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
