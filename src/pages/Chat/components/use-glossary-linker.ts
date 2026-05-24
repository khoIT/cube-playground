/**
 * useGlossaryLinker — fetches the glossary once, builds a case-insensitive
 * alias → term lookup, and exposes a `link(text)` helper that splits a
 * string into plain text + glossary-anchor segments.
 *
 * Word-boundary matching only — "whale" matches, "whales" does NOT
 * (avoids surprising substring matches inside other words).
 */

import { useEffect, useMemo, useState } from 'react';
import { listGlossary, type GlossaryTerm } from '../../../api/glossary-client';

export interface LinkedSegment {
  /** Either plain text or a glossary anchor. */
  kind: 'text' | 'term';
  text: string;
  termId?: string;
}

/**
 * Module-level cache so multiple AssistantMessage instances share one fetch
 * within a tab. Falls back to empty list on error.
 */
let cachedTermsPromise: Promise<GlossaryTerm[]> | null = null;
function getGlossaryOnce(): Promise<GlossaryTerm[]> {
  if (!cachedTermsPromise) {
    cachedTermsPromise = listGlossary().catch(() => []);
  }
  return cachedTermsPromise;
}

interface AliasIndex {
  /** Aliases in priority order (longest first to avoid "DAU" eating "DAU/MAU"). */
  aliases: Array<{ alias: string; termId: string }>;
  /** Compiled global regex matching any alias on word boundaries. */
  regex: RegExp | null;
}

function buildIndex(terms: GlossaryTerm[]): AliasIndex {
  const flat: Array<{ alias: string; termId: string }> = [];
  for (const term of terms) {
    for (const alias of term.aliases.length > 0 ? term.aliases : [term.label]) {
      if (alias.length < 2) continue;
      flat.push({ alias, termId: term.id });
    }
  }
  flat.sort((a, b) => b.alias.length - a.alias.length);
  if (flat.length === 0) return { aliases: flat, regex: null };
  const escaped = flat
    .map((a) => a.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`(?<![\\w])(${escaped})(?![\\w])`, 'gi');
  return { aliases: flat, regex };
}

export function useGlossaryLinker() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);

  useEffect(() => {
    let cancelled = false;
    getGlossaryOnce().then((list) => {
      if (!cancelled) setTerms(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const index = useMemo(() => buildIndex(terms), [terms]);
  const byAliasLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of index.aliases) map.set(a.alias.toLowerCase(), a.termId);
    return map;
  }, [index]);

  function link(text: string): LinkedSegment[] {
    if (!index.regex) return [{ kind: 'text', text }];
    const out: LinkedSegment[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    index.regex.lastIndex = 0;
    while ((match = index.regex.exec(text)) !== null) {
      if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) });
      const termId = byAliasLower.get(match[1].toLowerCase());
      if (termId) {
        out.push({ kind: 'term', text: match[1], termId });
      } else {
        out.push({ kind: 'text', text: match[1] });
      }
      last = index.regex.lastIndex;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
    return out;
  }

  return { link, terms };
}

/** Test helper — wipes module-level cache between suites. */
export function _resetGlossaryCache(): void {
  cachedTermsPromise = null;
}
