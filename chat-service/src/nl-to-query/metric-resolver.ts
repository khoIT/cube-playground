/**
 * Unified metric resolver. Replaces the longest-alias `pickMetric` heuristic
 * and the three flag-gated short-circuits (cube-ref / verbatim / leaderboard
 * concept) with ONE ranked pass that returns ONE contract: which cube member
 * the user meant, how confident we are, and how close the runner-up was.
 *
 * Three signals feed one confidence (highest wins, no intent gating):
 *   1. fully-qualified cube ref in the message  → 1.0  (matchedOn 'cube-ref')
 *   2. whole message equals an id/label/alias    → 1.0  (matchedOn 'exact')
 *   3. alias span inside a phrase                 → 0.85 (matchedOn 'alias'),
 *      dropped toward clarify when two DISTINCT metric terms tie (gap small).
 *
 * Ratio terms return `ratioRef` (auto-route as a two-measure query); the
 * expression/unknown case returns null refs plus a `reason` for clarify.
 * Engine principle: pure + LLM-free.
 */

import type { MetricResolution, OfficialTerm } from './types.js';
import { resolveTerms, findExactMatch, memberOrNull } from './synonym-resolver.js';
import { firstCubeRef } from './recognise-cube-ref.js';
import { classifyTerm } from './term-classifier.js';

const ALIAS_CONFIDENCE = 0.85;
/** Below the auto threshold: forces a clarify when the metric is ambiguous. */
const AMBIGUOUS_CONFIDENCE = 0.5;

function refOf(term: OfficialTerm): string | null {
  // `primaryCatalogId` is a cube member for dimension/user terms but a catalog
  // path for metric terms — only a member is a valid query ref (see
  // memberOrNull). A path here would leak into the /meta gate and clarify.
  return term.measureRef ?? memberOrNull(term.primaryCatalogId);
}

/** Build a resolution from a matched glossary term (exact or alias path). */
function fromTerm(
  term: OfficialTerm,
  confidence: number,
  gap: number,
  matchedOn: 'exact' | 'alias',
  alias: string | undefined,
  span: [number, number] | undefined,
  alternatives: MetricResolution['alternatives'],
): MetricResolution {
  const base = { termId: term.id, confidence, gap, matchedOn, alias, span, alternatives };

  if (term.refKind === 'ratio' && term.ratioRef) {
    return { ...base, ref: null, ratioRef: term.ratioRef, refKind: 'ratio' };
  }
  if (term.refKind === 'expression') {
    return {
      ...base,
      ref: null,
      ratioRef: null,
      refKind: 'expression',
      reason: `"${term.label}" is a derived expression with no single cube measure`,
    };
  }

  const ref = refOf(term);
  if (!ref) {
    return {
      ...base,
      ref: null,
      ratioRef: null,
      refKind: 'unknown',
      reason: `"${term.label}" has no resolved cube member`,
    };
  }
  return { ...base, ref, ratioRef: null, refKind: 'measure' };
}

export function resolveMetric(
  message: string,
  glossary: OfficialTerm[],
  knownMembers?: Set<string>,
): MetricResolution | null {
  // 1. Fully-qualified cube ref — the token IS the answer.
  const refHit = firstCubeRef(message, knownMembers);
  if (refHit) {
    return {
      ref: refHit.hit.cubeRef,
      ratioRef: null,
      refKind: 'measure',
      termId: null,
      confidence: refHit.confidence,
      gap: 1,
      alternatives: [],
      matchedOn: 'cube-ref',
      alias: refHit.hit.cubeRef,
      span: refHit.hit.span,
    };
  }

  // 2. Verbatim exact match — user typed a term id/label/alias as the whole message.
  const exact = findExactMatch(message, glossary);
  if (exact) {
    return fromTerm(exact.term, 1.0, 1, 'exact', message.trim(), undefined, []);
  }

  // 3. Alias hits ranked by span length; gap measured against the next DISTINCT term.
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const metricHits = resolveTerms(message, glossary).filter((h) => {
    const t = termById.get(h.termId);
    return t ? classifyTerm(t) === 'metric' : false;
  });
  if (metricHits.length === 0) return null;

  const ranked = [...metricHits].sort(
    (a, b) => b.span[1] - b.span[0] - (a.span[1] - a.span[0]),
  );
  const best = ranked[0]!;
  const bestTerm = termById.get(best.termId)!;
  const runnerUp = ranked.find((h) => h.termId !== best.termId) ?? null;

  const alternatives: MetricResolution['alternatives'] = [];
  const seen = new Set<string>([best.termId]);
  for (const h of ranked) {
    if (seen.has(h.termId)) continue;
    seen.add(h.termId);
    const t = termById.get(h.termId);
    if (t) alternatives.push({ id: t.id, ref: refOf(t), score: ALIAS_CONFIDENCE });
  }

  // Two distinct metric terms in one message → ambiguous: low confidence +
  // zero gap so the clarification builder surfaces the choice.
  const ambiguous = runnerUp !== null;
  const confidence = ambiguous ? AMBIGUOUS_CONFIDENCE : ALIAS_CONFIDENCE;
  const gap = ambiguous ? 0 : 1;

  return fromTerm(bestTerm, confidence, gap, 'alias', best.alias, best.span, alternatives);
}
