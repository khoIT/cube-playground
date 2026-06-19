/**
 * Benchmark resolver — joins a lever's two benchmark sources into one resolved
 * shape: the hand-authored EXTERNAL industry norm and the INTERNAL portfolio
 * percentile band (from the nightly snapshot).
 *
 * Fail-closed on the external side: a norm missing `source` or `citation` is
 * dropped, never surfaced. This is the invariant that stops an un-sourced
 * number from ever reaching an operator.
 */

import type { LeverBenchmark, ResolvedBenchmark, ExternalNorm } from './genre-levers/lever-types.js';
import { readPercentileSnapshot } from './percentile-snapshot-store.js';

/** True only if the norm carries non-empty source AND citation. */
export function isSourcedNorm(norm: ExternalNorm | undefined): norm is ExternalNorm {
  return (
    !!norm &&
    typeof norm.source === 'string' &&
    norm.source.trim().length > 0 &&
    typeof norm.citation === 'string' &&
    norm.citation.trim().length > 0
  );
}

/**
 * Resolve a lever's benchmark. The external norm is included only when sourced;
 * the internal band is the snapshot value at the lever's chosen percentile
 * (default p50), or null when no snapshot row exists yet.
 */
export function resolveBenchmark(b: LeverBenchmark): ResolvedBenchmark {
  const external = isSourcedNorm(b.externalNorm) ? b.externalNorm : undefined;

  const band = b.internalPercentileBand ?? 'p50';
  // Snapshot read is best-effort: a missing/unavailable store yields no internal
  // band rather than failing the whole lever resolution (external norm stands).
  let internal: ResolvedBenchmark['internal'] = null;
  try {
    const snap = readPercentileSnapshot(b.metricKey);
    if (snap) internal = { band, value: snap[band], computedAt: snap.computedAt };
  } catch {
    internal = null;
  }

  return { metricKey: b.metricKey, external, internal };
}
