/**
 * Recommendation orchestration — the Recommend posture's data path.
 *
 * recommend() chains the existing engines deterministically:
 *   diagnose() → Opportunity[] → RankerInput[] → rankCandidates() → [phrase]
 *
 * Numbers come from the ranker (deterministic); the optional LLM pass adds
 * WORDING only and never reorders. Power/baseline inputs the diagnosis cannot
 * derive (reachable %, experiment window, baseline conversion rate) are passed
 * as explicit params with documented defaults — never silently invented.
 */

import type { WorkspaceCtx } from '../services/cube-client.js';
import type { CubeReaderFn } from './cube-read.js';
import type { DiagnosisInput, Diagnosis, Opportunity } from './diagnosis-types.js';
import type { ExperimentCandidate, RankerInput } from './candidate-types.js';
import { diagnose } from './diagnosis-engine.js';
import { rankCandidates } from './candidate-ranker.js';
import { phraseHypotheses, type LlmCallerFn } from './llm-phrasing.js';

/** Fraction of the cohort reachable by a CS-actuated lever when not specified. */
const DEFAULT_REACHABLE_PCT = 0.75;
/** Default treatment/hold-out window. */
const DEFAULT_WINDOW_DAYS = 14;
/**
 * Default baseline conversion rate for the MDE check. The revenue
 * decomposition does not expose a per-factor conversion rate, so we default to
 * a mid-range rate and let the caller override. Surfaced honestly — not a
 * fabricated metric, an explicit power-check assumption.
 */
const DEFAULT_BASELINE_RATE = 0.4;

export interface RecommendParams {
  /** Total addressable member count for the scope (from the diagnosis / segment size). */
  addressableN: number;
  /** Fraction of addressableN reachable by the lever (0–1). Default 0.75. */
  reachablePct?: number;
  /** Experiment window in days. Default 14. */
  windowDays?: number;
  /** Baseline conversion rate for the power check (0–1). Default 0.4. */
  baselineRate?: number;
  /** ₫ revenue per addressed unit; omit to leave money TBD (ranks by effect×N×confidence). */
  valuePerUnitVnd?: number;
  /** When true, run the LLM phrasing pass on the top candidates (additive wording). */
  phrase?: boolean;
  /** How many top candidates to phrase (default 3). */
  phraseTopN?: number;
}

export interface Recommendation {
  diagnosis: Diagnosis;
  candidates: ExperimentCandidate[];
}

/** Build one RankerInput per opportunity from shared params. */
function toRankerInputs(
  opportunities: Opportunity[],
  gameId: string,
  params: RecommendParams,
): RankerInput[] {
  return opportunities.map((opportunity) => ({
    opportunity,
    addressableN: params.addressableN,
    reachablePct: params.reachablePct ?? DEFAULT_REACHABLE_PCT,
    windowDays: params.windowDays ?? DEFAULT_WINDOW_DAYS,
    baselineRate: params.baselineRate ?? DEFAULT_BASELINE_RATE,
    valuePerUnitVnd: params.valuePerUnitVnd,
    gameId,
  }));
}

/**
 * Diagnose then rank into experiment candidates.
 *
 * @param input   Diagnosis input (scope, goal, asOf, options).
 * @param ctx     Workspace context for live Cube.
 * @param params  Power/money inputs the diagnosis cannot derive.
 * @param reader  Optional injected Cube reader (tests).
 * @param llm     Optional injected LLM caller (phrasing); template fallback if absent.
 */
export async function recommend(
  input: DiagnosisInput,
  ctx: WorkspaceCtx,
  params: RecommendParams,
  reader?: CubeReaderFn,
  llm?: LlmCallerFn,
): Promise<Recommendation> {
  const diagnosis = await diagnose(input, ctx, reader);

  const gameId = input.scope.gameId;
  const rankerInputs = toRankerInputs(diagnosis.opportunities, gameId, params);
  const candidates = rankCandidates(rankerInputs);

  // Optional additive phrasing pass on the top-N — wording only, never reorders.
  if (params.phrase && candidates.length > 0) {
    const topN = params.phraseTopN ?? 3;
    const top = candidates.slice(0, topN);
    await Promise.all(
      top.map(async (c) => {
        try {
          c.hypotheses = await phraseHypotheses(diagnosis, c, llm);
        } catch {
          // Phrasing is additive; a failure leaves hypotheses absent, never blocks ranking.
        }
      }),
    );
  }

  return { diagnosis, candidates };
}
