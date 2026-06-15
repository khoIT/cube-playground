/**
 * Deterministic treatment/hold-out split. Pure, no I/O.
 *
 * The arm for a (experimentId, uid) pair is a stable function of the inputs — no
 * RNG, no stored bucket needed for recompute. Same inputs → same arm across
 * calls and process restarts, so an arm can be re-derived if ever needed. We
 * still PERSIST the frozen arms (the cohort snapshot can drift), but the
 * derivation itself is reproducible.
 *
 * Hash: sha256(experimentId + ':' + uid), first 8 hex digits → integer mod 100.
 * Salting by experimentId means the same uid lands in different arms across
 * experiments (no systematic correlation between experiments).
 */

import { createHash } from 'node:crypto';
import type { ExperimentArm } from './experiment-types.js';

/** Stable bucket 0–99 for a (experiment, uid) pair. */
export function bucketFor(experimentId: string, uid: string): number {
  const hex = createHash('sha256').update(`${experimentId}:${uid}`).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
}

/**
 * Arm for a uid given the treatment share (whole percent, 0–100). Buckets below
 * splitPct are treatment; the rest are the untouched control (hold-out).
 */
export function armFor(experimentId: string, uid: string, splitPct: number): ExperimentArm {
  return bucketFor(experimentId, uid) < splitPct ? 'treatment' : 'control';
}

/** Split a uid list into frozen {uid, arm} rows. Order preserved. */
export function splitCohort(
  experimentId: string,
  uids: string[],
  splitPct: number,
): { uid: string; arm: ExperimentArm }[] {
  return uids.map((uid) => ({ uid, arm: armFor(experimentId, uid, splitPct) }));
}
