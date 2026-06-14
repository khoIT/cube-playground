/**
 * Candidate ranker: turns Opportunity[] + context → ranked ExperimentCandidate[].
 *
 * Scoring formula (all inputs deterministic — no LLM in the ranking path):
 *   score = addressableN × effectValue × valueFactor × feasibilityWeight × confidenceWeight ÷ effort
 *
 * Weights:
 *   feasibilityWeight: feasible=1.0, nearest-feasible=0.6, infeasible=0.0
 *   confidenceWeight:  measured=1.0, benchmark=0.8,        assumption=0.6
 *   valueFactor:       incrementalVnd/1_000_000 when known; else effectValue×N (dimensionless)
 *   effort:            1.0 (uniform for CS levers today; effort can later vary by SLA)
 *
 * Underpowered candidates are INCLUDED in output with power.status='underpowered'
 * and are NOT silently ranked to the bottom — their score stands. the Advisor UI renders
 * the flag visibly so the user decides whether to proceed with an underpowered arm.
 *
 * When ₫/unit is TBD, valueFactor = effectValue × addressableN so relative
 * ordering between candidates is preserved without fabricating a money number.
 */

import type { Opportunity } from './diagnosis-types.js';
import type {
  ExperimentCandidate,
  RankerInput,
  EffectPrior,
  MoneyEstimate,
} from './candidate-types.js';
import { mapLevers } from './lever-map.js';
import { checkPower } from './power-check.js';
import { expectedIncremental } from './money-model.js';
import { getPrior } from './treatment-effect-library.js';

// ─── Weights ──────────────────────────────────────────────────────────────────

const FEASIBILITY_WEIGHT: Record<string, number> = {
  feasible: 1.0,
  'nearest-feasible': 0.6,
  infeasible: 0.0,
};

const CONFIDENCE_WEIGHT: Record<string, number> = {
  measured: 1.0,
  benchmark: 0.8,
  assumption: 0.6,
};

// Fallback prior when the Library has no entry for (game, shape, lever)
const FALLBACK_PRIOR: EffectPrior = {
  value: 0.03,
  confidence: 'assumption',
  source: 'no library entry — conservative fallback prior',
};

// ─── Segment-shape inference ──────────────────────────────────────────────────

/**
 * Infer a normalised segment_shape string from the opportunity factor.
 * Used to look up the Treatment-Effect Library.
 * Conservative heuristic — the caller can later supply an explicit shape from the caller.
 */
function inferSegmentShape(factorKey: string): string {
  const map: Record<string, string> = {
    lifespan: 'churn-risk',
    payers: 'spend-drop',
    arppu: 'spend-drop',
    session_freq: 'low-session',
    session_length: 'low-session',
  };
  return map[factorKey] ?? factorKey;
}

// ─── Score computation ────────────────────────────────────────────────────────

function computeScore(
  addressableN: number,
  effectValue: number,
  money: MoneyEstimate,
  feasibilityStatus: string,
  confidenceLabel: string,
): number {
  const fw = FEASIBILITY_WEIGHT[feasibilityStatus] ?? 0;
  const cw = CONFIDENCE_WEIGHT[confidenceLabel] ?? 0.5;
  const effort = 1.0; // uniform today; can later vary by SLA / channel cost

  // When ₫ incremental is available, scale by VND millions for magnitude
  const valueFactor =
    money.incrementalVnd != null
      ? money.incrementalVnd / 1_000_000
      : effectValue * addressableN;

  return addressableN * effectValue * valueFactor * fw * cw / effort;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rank opportunities into experiment candidates.
 *
 * One candidate is emitted per (opportunity × lever-family) pair.
 * Infeasible candidates are included with score=0 so the Advisor UI can explain why
 * a factor has no actionable lever yet. The caller may filter them if desired.
 *
 * Output is sorted by score descending (highest first).
 */
export function rankCandidates(inputs: RankerInput[]): ExperimentCandidate[] {
  const candidates: ExperimentCandidate[] = [];

  for (const input of inputs) {
    const { opportunity, addressableN, reachablePct, windowDays, baselineRate, gameId } = input;
    const mappedLevers = mapLevers(opportunity);
    const segmentShape = inferSegmentShape(opportunity.factor);

    for (const { family, verdict, primaryPlaybookId } of mappedLevers) {
      // Library lookup — falls back to conservative default
      const prior =
        getPrior(gameId, segmentShape, family.family) ?? FALLBACK_PRIOR;

      // Power check
      const power = checkPower({
        N: addressableN,
        reachablePct,
        windowDays,
        baselineRate,
      });

      // Money estimate
      const money = expectedIncremental({
        effectFraction: prior.value,
        addressableN,
        valuePerUnit: input.valuePerUnitVnd ?? null,
        currency: 'VND',
      });

      const score = computeScore(
        addressableN,
        prior.value,
        money,
        verdict.status,
        prior.confidence,
      );

      const id = `${opportunity.factor}::${family.family}`;

      const rankReason = buildRankReason({
        family: family.family,
        prior,
        power,
        money,
        score,
        addressableN,
      });

      candidates.push({
        id,
        opportunityFactor: opportunity.factor,
        lever: verdict.lever,
        playbookId: primaryPlaybookId,
        feasibility: verdict,
        power,
        expectedEffect: prior,
        money,
        score,
        rankReason,
      });
    }
  }

  // Sort by score descending — deterministic given same inputs
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ─── Rank reason builder ─────────────────────────────────────────────────────

function buildRankReason(opts: {
  family: string;
  prior: EffectPrior;
  power: ReturnType<typeof checkPower>;
  money: MoneyEstimate;
  score: number;
  addressableN: number;
}): string {
  const { family, prior, power, money, score, addressableN } = opts;
  const pct = (prior.value * 100).toFixed(0);
  const conf = prior.confidence;
  const powerStr = power.status === 'powered' ? `powered (MDE=${power.mde}pp)` : `UNDERPOWERED (MDE=${power.mde}pp)`;
  const moneyStr =
    money.incrementalVnd != null
      ? `₫${(money.incrementalVnd / 1_000_000).toFixed(1)}M est.`
      : '₫ TBD';

  return (
    `${family} (+${pct}pp ${conf}): N=${addressableN} ${powerStr}, ` +
    `${moneyStr}, score=${score.toFixed(1)}. Prior=${conf}.`
  );
}
