/**
 * Maps Vietnamese / English / code-switched aliases to canonical glossary
 * terms (and therefore to Cube member ids). Strategy: build a length-sorted
 * alias list once per glossary snapshot, then scan the message left-to-right
 * with a non-overlapping greedy longest-match. Sufficient for the ~100-term
 * Official glossary; revisit if the catalogue explodes.
 */

import type { AliasEntry, OfficialTerm } from './types.js';

export interface AliasHit {
  termId: string;
  alias: string;
  cubeRef: string | null;
  span: [number, number];
  lang: 'en' | 'vi';
  confidence: number;
}

interface CompiledIndex {
  terms: Map<string, OfficialTerm>;
  aliases: AliasEntry[];
}

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

export function compileAliasIndex(glossary: OfficialTerm[]): CompiledIndex {
  const terms = new Map<string, OfficialTerm>();
  const aliases: AliasEntry[] = [];

  for (const t of glossary) {
    terms.set(t.id, t);
    // Pin the cube member, not the catalog path. INVARIANT: the /meta gate
    // accepts cube members only, so an alias hit's ref must already be a
    // member — `measureRef` (catalog formula, resolved at load) is that
    // member; `primaryCatalogId` (a catalog path) is the legacy fallback.
    const ref = t.measureRef ?? t.primaryCatalogId;

    // Label EN + label VI both count as aliases — that's how users tend to
    // type. Filter duplicates so the same alias doesn't show up twice with
    // different langs (lang matters less when both spellings are identical).
    const seen = new Set<string>();

    function push(raw: string, lang: 'en' | 'vi') {
      const a = normalise(raw);
      if (!a || seen.has(a)) return;
      seen.add(a);
      aliases.push({ alias: a, termId: t.id, cubeRef: ref, lang });
    }

    push(t.label, 'en');
    if (t.labelVi) push(t.labelVi, 'vi');
    for (const a of t.aliases) push(a, 'en');
    for (const a of t.aliasesVi) push(a, 'vi');
  }

  // Longest first so greedy scan never picks a substring when a longer
  // match starts at the same position.
  aliases.sort((a, b) => b.alias.length - a.alias.length);

  return { terms, aliases };
}

const WORD_BOUNDARY = /[^\p{L}\p{N}]/u;

function isWordBoundary(text: string, idx: number): boolean {
  if (idx < 0 || idx >= text.length) return true;
  return WORD_BOUNDARY.test(text[idx]);
}

export function resolveTerms(message: string, glossary: OfficialTerm[]): AliasHit[] {
  const lower = message.toLowerCase();
  const { aliases } = compileAliasIndex(glossary);
  const hits: AliasHit[] = [];
  const consumed = new Array<boolean>(message.length).fill(false);

  for (const entry of aliases) {
    const needle = entry.alias;
    if (needle.length < 2) continue;
    let from = 0;
    while (from <= lower.length - needle.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      from = idx + 1;

      // Word-boundary check at both ends so "user" doesn't match inside "users".
      if (!isWordBoundary(message, idx - 1)) continue;
      if (!isWordBoundary(message, idx + needle.length)) continue;

      // Skip if any character in this span is already covered by a longer alias.
      let overlap = false;
      for (let i = idx; i < idx + needle.length; i += 1) {
        if (consumed[i]) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      for (let i = idx; i < idx + needle.length; i += 1) consumed[i] = true;
      hits.push({
        termId: entry.termId,
        alias: entry.alias,
        cubeRef: entry.cubeRef,
        span: [idx, idx + needle.length],
        lang: entry.lang,
        confidence: 1,
      });
    }
  }

  hits.sort((a, b) => a.span[0] - b.span[0]);
  return hits;
}

/**
 * Phase 02a — exact-match short-circuit.
 *
 * When the trimmed, lowercased message equals one of a term's id / label /
 * aliases verbatim (case-insensitive), we treat it as conf=1.0 and the
 * disambig tool skips the ranking + clarify step. This is what stops the
 * "user typed `payers` and we still asked them to pick between 5 sibling
 * metrics" failure mode.
 *
 * Returns null when no exact match, or when two distinct terms match the
 * same string (ambiguous — caller must clarify). The id check happens first
 * so explicit ids like `recharge.revenue_vnd` resolved via
 * `recognise-cube-ref` always win.
 */
export interface ExactMatch {
  termId: string;
  term: OfficialTerm;
  matchedOn: 'id' | 'label' | 'alias';
}

export function findExactMatch(
  message: string,
  glossary: OfficialTerm[],
): ExactMatch | null {
  const norm = normalise(message);
  if (!norm) return null;

  const matches: ExactMatch[] = [];
  for (const t of glossary) {
    if (normalise(t.id) === norm) {
      matches.push({ termId: t.id, term: t, matchedOn: 'id' });
      continue;
    }
    if (normalise(t.label) === norm) {
      matches.push({ termId: t.id, term: t, matchedOn: 'label' });
      continue;
    }
    if (t.labelVi && normalise(t.labelVi) === norm) {
      matches.push({ termId: t.id, term: t, matchedOn: 'label' });
      continue;
    }
    for (const a of t.aliases) {
      if (normalise(a) === norm) {
        matches.push({ termId: t.id, term: t, matchedOn: 'alias' });
        break;
      }
    }
    for (const a of t.aliasesVi) {
      if (normalise(a) === norm) {
        matches.push({ termId: t.id, term: t, matchedOn: 'alias' });
        break;
      }
    }
  }

  if (matches.length === 0) return null;
  // Ambiguous (two unrelated terms share the same alias) → caller clarifies.
  const distinct = new Set(matches.map((m) => m.termId));
  if (distinct.size > 1) return null;
  return matches[0]!;
}

export function unresolvedSpans(message: string, hits: AliasHit[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const h of hits) {
    const gap = message.slice(cursor, h.span[0]).trim();
    if (gap.length > 2) out.push(gap);
    cursor = h.span[1];
  }
  const tail = message.slice(cursor).trim();
  if (tail.length > 2) out.push(tail);
  return out;
}
