/**
 * Concept resolver — phase 02a.
 *
 * Glossary terms with `entityCube`, `defaultMeasureRef`, or `ranking` carry
 * concept-tier metadata. This module finds the highest-confidence concept
 * mention in a user message so the leaderboard-path / aggregate-path can
 * build a query without asking "rank what by which measure?".
 *
 * Scoring is intentionally coarse — exact full-message match (case + trim)
 * is 1.0, alias appearing as a standalone token inside a longer phrase is
 * 0.85. The disambig tool checks `confidence ≥ threshold AND gap ≥ 0.2`
 * before auto-routing; otherwise it falls back to the existing clarify list.
 */

import type { OfficialTerm } from './types.js';
import { resolveTerms } from './synonym-resolver.js';

const EXACT_SCORE = 1.0;
const SUBSTRING_SCORE = 0.85;

export interface ConceptHit {
  conceptId: string;
  term: OfficialTerm;
  alias: string;
  span: [number, number];
  score: number;
  lang: 'en' | 'vi';
}

export interface ConceptResolution {
  best: ConceptHit;
  secondBest: ConceptHit | null;
  /** confidence = best.score, surfaced for the assumption disclosure. */
  confidence: number;
  /** Gap to the next candidate; defaults to 1 (clear win) when no sibling. */
  gap: number;
}

/** A glossary term is a "concept" when it carries any of the concept-tier fields. */
export function isConceptTerm(t: OfficialTerm): boolean {
  return !!(t.entityCube || t.defaultMeasureRef || t.ranking);
}

/**
 * Find every concept hit in the message. Reuses the existing alias scanner
 * (so word-boundary + longest-match semantics stay identical) but restricted
 * to terms in the concept tier.
 */
export function resolveConcepts(message: string, glossary: OfficialTerm[]): ConceptHit[] {
  if (!message || message.trim() === '') return [];
  const conceptTerms = glossary.filter(isConceptTerm);
  if (conceptTerms.length === 0) return [];

  const aliasHits = resolveTerms(message, conceptTerms);
  const norm = message.trim().toLowerCase();

  const out: ConceptHit[] = [];
  for (const h of aliasHits) {
    const term = conceptTerms.find((t) => t.id === h.termId);
    if (!term) continue;
    const exact = norm === h.alias.toLowerCase();
    out.push({
      conceptId: term.id,
      term,
      alias: h.alias,
      span: h.span,
      score: exact ? EXACT_SCORE : SUBSTRING_SCORE,
      lang: h.lang,
    });
  }

  // Highest score first; longer alias wins ties so "first time payer" beats
  // a stray "payer" sub-hit.
  out.sort((a, b) => b.score - a.score || b.alias.length - a.alias.length);
  return out;
}

/**
 * Pick the best concept + gap to the next distinct concept. Caller compares
 * `confidence` against the threshold (default 0.8) and `gap` against the
 * second-best margin (default 0.2) to decide auto-route vs clarify.
 */
export function pickBestConcept(hits: ConceptHit[]): ConceptResolution | null {
  if (hits.length === 0) return null;
  const best = hits[0]!;

  // Gap is measured against the next concept with a different id — a second
  // alias of the same concept is the same answer, not a disambiguation risk.
  const secondBest = hits.find((h) => h.conceptId !== best.conceptId) ?? null;
  const gap = secondBest ? best.score - secondBest.score : 1;

  return { best, secondBest, confidence: best.score, gap };
}

/**
 * Combined helper — resolve + pick in one call. The disambig tool uses this
 * directly; tests cover the individual pieces above.
 */
export function resolveBestConcept(
  message: string,
  glossary: OfficialTerm[],
): ConceptResolution | null {
  return pickBestConcept(resolveConcepts(message, glossary));
}
