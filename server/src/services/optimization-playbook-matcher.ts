/**
 * Pure matcher: classifier Verdict → applicable optimization playbooks.
 *
 * The matcher is the LLM gate. A "specific" playbook (anything but the generic
 * accept-or-raise-timeout fallback) means we have a real structural remedy → NO
 * LLM call. `needsLlm` is true only when the sole match is the generic fallback
 * — i.e. no structural remedy fits — which is exactly when the P6 LLM fallback
 * earns its cost.
 *
 * Refinement vs the original sketch: rather than returning `bestPlaybook=null`
 * for an uncovered verdict, we always return at least the generic fallback so
 * the admin gets advice, and gate the LLM on `needsLlm` instead. Same intent,
 * better UX, identical cost guard.
 */

import { OPTIMIZATION_PLAYBOOKS, type OptimizationPlaybook } from './optimization-playbooks.js';
import type { Verdict } from './query-perf-classifier.js';

export const GENERIC_FALLBACK_ID = 'accept-or-raise-timeout';

/** Is this a specific structural remedy (not the generic catch-all)? */
function isSpecific(p: OptimizationPlaybook): boolean {
  return p.id !== GENERIC_FALLBACK_ID;
}

/** All playbooks whose predicate matches, in catalog (specificity) order. */
export function matchPlaybooks(verdict: Verdict): OptimizationPlaybook[] {
  return OPTIMIZATION_PLAYBOOKS.filter((p) => p.appliesWhen(verdict));
}

/** Top match: first specific remedy, else the generic fallback, else null. */
export function bestPlaybook(verdict: Verdict): OptimizationPlaybook | null {
  const matches = matchPlaybooks(verdict);
  return matches.find(isSpecific) ?? matches[0] ?? null;
}

/** True when no specific structural remedy fits — the genuine LLM-fallback gap. */
export function needsLlm(verdict: Verdict): boolean {
  return !matchPlaybooks(verdict).some(isSpecific);
}

export interface SuggestionResult {
  verdict: Verdict;
  playbooks: OptimizationPlaybook[];
  best: OptimizationPlaybook | null;
  needsLlm: boolean;
}

/** Bundle the full suggestion for a verdict (used by the read route). */
export function buildSuggestion(verdict: Verdict): SuggestionResult {
  return {
    verdict,
    playbooks: matchPlaybooks(verdict),
    best: bestPlaybook(verdict),
    needsLlm: needsLlm(verdict),
  };
}
