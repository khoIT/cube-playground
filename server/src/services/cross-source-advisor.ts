/**
 * Cross-source capability advisor — a PURE verdict function. Given two source
 * types, it answers honestly what Cube's engine can do with a link between cubes
 * on different dataSources:
 *
 *   - `executable` is ALWAYS false: Cube cannot run a live SQL join across
 *     dataSources. Full stop. This is the engine truth the whole Phase C stance
 *     is built on — a declared link is advisory, never compiled to YAML.
 *   - `rollupJoinEligible` is true only when BOTH sources can back a cross-source
 *     pre-aggregation (`caps.crossSourceRollupJoin`), in which case a `rollupJoin`
 *     over matching pre-aggs is the supported path forward.
 *   - otherwise the path forward is ETL into a shared store.
 *
 * No DB, no I/O — just the registry caps. Unit-tested as a matrix.
 */

import { getSourceType } from './source-type-registry.js';

export interface CrossSourceVerdict {
  /** Cube cannot execute a cross-dataSource SQL join — always false. */
  executable: false;
  /** Both sources can back a cross-source rollupJoin (pre-agg) path. */
  rollupJoinEligible: boolean;
  leftSourceType: string;
  rightSourceType: string;
  /** Human-readable engine limit + recommended next step. */
  note: string;
}

export function crossSourceVerdict(leftSourceType: string, rightSourceType: string): CrossSourceVerdict {
  const left = getSourceType(leftSourceType);
  const right = getSourceType(rightSourceType);
  const rollupJoinEligible = Boolean(left?.caps.crossSourceRollupJoin && right?.caps.crossSourceRollupJoin);

  const note = rollupJoinEligible
    ? 'Not executable as a live SQL join — the two cubes are on different dataSources. Both sources can back a pre-aggregation, so a rollupJoin over matching pre-aggs is the supported path.'
    : 'Not executable as a live SQL join — the two cubes are on different dataSources, and at least one source cannot back a cross-source rollupJoin. The path forward is ETL into a shared store.';

  return { executable: false, rollupJoinEligible, leftSourceType, rightSourceType, note };
}
