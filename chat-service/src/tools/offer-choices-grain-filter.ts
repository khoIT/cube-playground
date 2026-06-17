/**
 * Grain gate for the free-form path (P5 follow-up).
 *
 * The deterministic engine drops per-head ratio metrics (ARPU/ARPDAU/LTV — a
 * sum ÷ a head-count) from leaderboard metric options when ranking individuals
 * (see clarification-builder `metricOptions`). The agent's `offer_choices` tool
 * bypasses that path, so the same rule was guidance-only there. This applies it
 * in code: when the session's resolved entity is an individual, strip option
 * chips whose label names a ratio metric — using the glossary's `refKind` as
 * the source of truth, not a hardcoded list.
 *
 * Conservative by construction: only acts when the entity is KNOWN individual,
 * only removes options that match a real ratio term, and never strips below two
 * options (a chip set needs choices) — otherwise it leaves the set untouched.
 */

import type { OfficialTerm } from '../nl-to-query/types.js';

export interface ChoiceOption {
  label: string;
  pinText: string;
}

/**
 * Normalise a label/alias for loose matching: lowercase, collapse runs of
 * non-alphanumerics to single spaces. Note: diacritics are NOT transliterated
 * (Vietnamese aliases land as fragmented tokens) — matching VI labels relies on
 * whole-string equality, which still works since the alias normalises the same
 * way. English labels (the common case) match cleanly.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Build the set of normalised labels/aliases for ratio-kind glossary terms.
 * These are the per-head averages that cannot rank a single individual.
 */
export function ratioLabelSet(glossary: OfficialTerm[]): Set<string> {
  const set = new Set<string>();
  for (const t of glossary) {
    if (t.refKind !== 'ratio') continue;
    if (t.id) set.add(norm(t.id));
    if (t.label) set.add(norm(t.label));
    for (const a of t.aliases ?? []) set.add(norm(a));
    for (const a of t.aliasesVi ?? []) set.add(norm(a));
  }
  set.delete('');
  return set;
}

/**
 * True when an option label names a ratio metric. Three match levels, each
 * tuned to keep false-positives near-zero (stripping a valid chip is the
 * costly mistake):
 *  1. exact normalised equality ("ARPU" === alias "arpu");
 *  2. multi-word alias as a contiguous substring ("D7 retention rate" contains
 *     "retention rate") — multi-word phrases are specific, so this is safe;
 *  3. single-token (≥3 char) whole-word match ("LTV (lifetime value)" → token
 *     "ltv") — acronyms only; short common words can't false-trigger.
 */
function isRatioOption(label: string, ratioLabels: Set<string>): boolean {
  const n = norm(label);
  if (!n) return false;
  if (ratioLabels.has(n)) return true;
  const tokens = new Set(n.split(' '));
  for (const member of ratioLabels) {
    if (member.includes(' ')) {
      if (n.includes(member)) return true; // multi-word phrase substring
    } else if (member.length >= 3 && tokens.has(member)) {
      return true; // single acronym/word as a whole token
    }
  }
  return false;
}

export interface GrainFilterResult {
  options: ChoiceOption[];
  dropped: string[];
}

/**
 * Remove ratio-metric options when ranking an individual entity. Returns the
 * original list unchanged when: the entity isn't individual, nothing matches,
 * or dropping would leave fewer than two options.
 */
export function filterIndividualRatioOptions(
  options: ChoiceOption[],
  isIndividual: boolean,
  ratioLabels: Set<string>,
): GrainFilterResult {
  if (!isIndividual || ratioLabels.size === 0) return { options, dropped: [] };
  const kept: ChoiceOption[] = [];
  const dropped: string[] = [];
  for (const o of options) {
    if (isRatioOption(o.label, ratioLabels)) dropped.push(o.label);
    else kept.push(o);
  }
  // Never break the chip set: if the gate would leave <2 options, keep all.
  if (dropped.length === 0 || kept.length < 2) return { options, dropped: [] };
  return { options: kept, dropped };
}
