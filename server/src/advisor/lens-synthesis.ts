/**
 * Lens synthesis — map lens verdicts onto goal-tree factors and rank opportunities.
 *
 * Confidence = count of independently agreeing lenses on the same factor key.
 *
 * De-duplication rule: Lens 1 (Level) and "percentile of Lens 1" are the same
 * underlying signal — both tell you the segment is at the bottom of a distribution.
 * To avoid double-counting, correlated lens pairs are collapsed to ONE vote.
 * The independent signal groups are:
 *   Group A (absolute position): lens 1
 *   Group B (relative position):  lens 3 (peer)
 *   Group C (direction):          lens 2 (trajectory), lens 9 (anomaly)
 *   Group D (structure):          lens 4 (decomposition), lens 5 (Pareto)
 *   Group E (funnel depth):       lens 6 (funnel)
 *   Group F (lifecycle):          lens 7 (lifecycle)
 *   Group G (cross-signal):       lens 8 (CS correlation)
 *
 * Within each group only ONE "weak" vote is counted regardless of how many
 * lenses in the group agree. Across groups, each group contributes at most 1.
 * Max confidence = 7 (one per group).
 *
 * Opportunities are ranked by gapPct × confidence (largest impact × most evidence
 * comes first).
 */

import type { LensResult, Opportunity, GoalTree } from './diagnosis-types.js';
import { factorGap } from './goal-tree.js';

/** Correlated lens groups — within a group only one "weak" vote is counted. */
const LENS_GROUPS: number[][] = [
  [1],        // Group A: absolute position
  [3],        // Group B: relative position (peer)
  [2, 9],     // Group C: directional (trajectory + anomaly are correlated)
  [4, 5],     // Group D: structural (decomposition + pareto — both measure revenue shape)
  [6],        // Group E: funnel depth
  [7],        // Group F: lifecycle
  [8],        // Group G: cross-signal (CS quality)
];

/**
 * For each factor key: count how many independent lens groups report "weak".
 * Returns a map of factorKey → { confidence, agreeingLenses }.
 */
export function synthesizeConfidence(
  lenses: LensResult[],
): Map<string, { confidence: number; agreeingLenses: number[] }> {
  // Index weak lens ids by factor.
  const weakByFactor = new Map<string, Set<number>>();
  for (const lens of lenses) {
    if (lens.verdict !== 'weak') continue;
    const key = lens.factor;
    if (!key) continue;
    if (!weakByFactor.has(key)) weakByFactor.set(key, new Set());
    weakByFactor.get(key)!.add(lens.id);
  }

  const result = new Map<string, { confidence: number; agreeingLenses: number[] }>();

  for (const [factorKey, weakIds] of weakByFactor) {
    // Count one vote per group where at least one lens in the group is weak.
    let confidence = 0;
    const agreeingLenses: number[] = [];

    for (const group of LENS_GROUPS) {
      const groupWeakIds = group.filter((id) => weakIds.has(id));
      if (groupWeakIds.length > 0) {
        confidence += 1;
        // Record only the first agreeing lens per group (avoid inflating the list).
        agreeingLenses.push(groupWeakIds[0]!);
      }
    }

    // Include lenses that aren't in any defined group (future lenses).
    for (const id of weakIds) {
      const inAGroup = LENS_GROUPS.some((g) => g.includes(id));
      if (!inAGroup && !agreeingLenses.includes(id)) {
        agreeingLenses.push(id);
        confidence += 1;
      }
    }

    result.set(factorKey, { confidence, agreeingLenses });
  }

  return result;
}

/**
 * Build ranked Opportunity list from goal trees + synthesis confidence map.
 * Rank = gapPct × confidence (descending). Only weak factors become opportunities.
 */
export function buildOpportunities(
  goalTrees: GoalTree[],
  confidenceMap: Map<string, { confidence: number; agreeingLenses: number[] }>,
): Opportunity[] {
  const opportunities: Opportunity[] = [];

  for (const tree of goalTrees) {
    for (const factor of tree.factors) {
      if (!factor.weak) continue;

      const { gapPct, gapValue } = factorGap(factor);
      const syn = confidenceMap.get(factor.key) ?? { confidence: 0, agreeingLenses: [] };

      opportunities.push({
        factor: factor.key,
        gapPct,
        gapValue,
        confidence: syn.confidence,
        agreeingLenses: syn.agreeingLenses,
        levers: [], // populated by the lever-mapping pass
      });
    }
  }

  // Sort: highest (gapPct × confidence) first; break ties by gapPct.
  opportunities.sort((a, b) => {
    const scoreA = a.gapPct * a.confidence;
    const scoreB = b.gapPct * b.confidence;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.gapPct - a.gapPct;
  });

  return opportunities;
}
