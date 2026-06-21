/**
 * Parity baseline: a frozen snapshot of the findings the team has accepted as
 * intentional or not-yet-actioned (documented divergences, name-alias parity,
 * source-blocked N/A). The regression gate compares a fresh run against it so a
 * NEWLY introduced finding stands out — and a new *correctness* finding fails
 * the build — while the accepted long tail stays quiet.
 *
 * Fingerprint is the stable identity of a finding independent of line numbers
 * or wording: game + cube + dimension + rootCauseKey.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/** Stable per-finding identity (ignores file:line / detail wording). */
export function fingerprint(f) {
  return `${f.game}|${f.cube}|${f.dimension}|${f.rootCauseKey ?? f.detail ?? ''}`;
}

/** Write the accepted-state baseline (counts + fingerprint→severity map). */
export function writeBaseline(findings, absPath, meta = {}) {
  const accepted = {};
  for (const f of findings) accepted[fingerprint(f)] = f.severity;
  const counts = { correctness: 0, parity: 0, cosmetic: 0 };
  for (const f of findings) if (f.severity in counts) counts[f.severity] += 1;
  const body = {
    // generatedAt is supplied by the caller (scripts can't call Date.now under
    // some runners); omitted when absent rather than faked.
    ...(meta.generatedAt ? { generatedAt: meta.generatedAt } : {}),
    note:
      'Accepted cube-parity findings. Regenerate with `audit-cube-parity.mjs --write-baseline` ONLY after a human has reviewed the drift. The gate fails on any NEW correctness finding regardless of this file.',
    counts,
    accepted,
  };
  writeFileSync(absPath, JSON.stringify(body, null, 2) + '\n');
  return { path: absPath, counts };
}

/** Load a baseline file; null when it does not exist yet. */
export function loadBaseline(absPath) {
  if (!existsSync(absPath)) return null;
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

/**
 * Diff a fresh finding set against the baseline's accepted set.
 * Returns added (new fingerprints), removed (cleared/baselined-but-gone), and
 * newCorrectness (the subset of `added` that are correctness-severity — the
 * only class that must fail the gate).
 */
export function diffAgainstBaseline(findings, baseline) {
  const acceptedKeys = new Set(Object.keys(baseline?.accepted ?? {}));
  const currentKeys = new Set();
  const added = [];
  for (const f of findings) {
    const k = fingerprint(f);
    currentKeys.add(k);
    if (!acceptedKeys.has(k)) added.push(f);
  }
  const removed = [...acceptedKeys].filter((k) => !currentKeys.has(k));
  const newCorrectness = added.filter((f) => f.severity === 'correctness');
  return { added, removed, newCorrectness };
}
