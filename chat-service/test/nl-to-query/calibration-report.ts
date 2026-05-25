/**
 * Calibration helper for the eval suite. Given the per-case (overall
 * confidence, expected action, actual action under the run-time threshold)
 * tuples, computes how many auto/clarify decisions would have been correct
 * at a sweep of candidate thresholds. Used to inform — not change —
 * `CHAT_DISAMBIG_AUTO_THRESHOLD` in config.
 */

export interface EvalDecision {
  id: string;
  overallConfidence: number;
  expectedAction: 'auto' | 'clarify';
  mode: 'targeted' | 'aggressive';
  hadClarifications: boolean;
}

export interface CalibrationRow {
  threshold: number;
  autoCorrect: number;
  clarifyCorrect: number;
  totalCorrect: number;
  total: number;
}

const CANDIDATES = [0.6, 0.7, 0.75, 0.8, 0.85];

function decideAt(threshold: number, d: EvalDecision): 'auto' | 'clarify' {
  if (d.mode === 'targeted') return d.hadClarifications ? 'clarify' : 'auto';
  if (!d.hadClarifications) return 'auto';
  return d.overallConfidence >= threshold ? 'auto' : 'clarify';
}

export function calibrate(decisions: EvalDecision[]): CalibrationRow[] {
  return CANDIDATES.map((threshold) => {
    let autoCorrect = 0;
    let clarifyCorrect = 0;
    for (const d of decisions) {
      const got = decideAt(threshold, d);
      if (got === d.expectedAction) {
        if (got === 'auto') autoCorrect += 1;
        else clarifyCorrect += 1;
      }
    }
    return {
      threshold,
      autoCorrect,
      clarifyCorrect,
      totalCorrect: autoCorrect + clarifyCorrect,
      total: decisions.length,
    };
  });
}
