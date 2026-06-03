/**
 * Pure filtering for the glossary index — kept out of the page component so the
 * three-axis logic (status / wiring / category) plus free-text search is unit-
 * testable in isolation.
 *
 * Each axis Set is treated as "no constraint" when empty; a non-empty Set keeps
 * only terms whose value is in the Set (OR within an axis, AND across axes).
 */

import {
  isConceptTerm,
  type GlossaryStatus,
  type GlossaryTerm,
} from '../../../api/glossary-client';

/** Whether a term is bound to live data (a cube/measure/filter) or prose-only. */
export type WiringFacet = 'wired' | 'definition';

export interface GlossaryFilterCriteria {
  query: string;
  statuses: Set<GlossaryStatus>;
  wiring: Set<WiringFacet>;
  categories: Set<string>;
}

const NAMESPACED_REF = /^(business_metrics|data_model|segments)\//;

/**
 * A term is "wired" when it resolves to live data, by ANY of:
 *   - concept-tier fields (entity_cube / entity_pk / default_measure_ref),
 *   - a default filter predicate,
 *   - a primaryCatalogId pointing at a metric (business_metrics/*) or a cube
 *     member (e.g. mf_users.country) — i.e. clicking it lands on real data.
 * This matches the user-facing "resolves to a cube, measure, or filter" promise;
 * isConceptTerm alone undercounts metric-linked terms (ARPU, DAU, …) that bind
 * via primaryCatalogId rather than the concept-tier fields.
 */
function resolvesToData(term: GlossaryTerm): boolean {
  if (isConceptTerm(term)) return true;
  if (term.defaultFilter) return true;
  const pid = term.primaryCatalogId;
  if (pid && (NAMESPACED_REF.test(pid) || (pid.includes('.') && !pid.includes('/')))) return true;
  return false;
}

/** Maps a term to its wiring axis value. */
export function wiringFacetOf(term: GlossaryTerm): WiringFacet {
  return resolvesToData(term) ? 'wired' : 'definition';
}

function matchesQuery(term: GlossaryTerm, q: string): boolean {
  if (!q) return true;
  const hay = [
    term.label,
    term.description,
    term.labelVi ?? '',
    term.descriptionVi ?? '',
    ...term.aliases,
    ...term.aliasesVi,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function filterGlossaryTerms(
  terms: ReadonlyArray<GlossaryTerm>,
  { query, statuses, wiring, categories }: GlossaryFilterCriteria,
): GlossaryTerm[] {
  const q = query.trim().toLowerCase();
  return terms.filter((t) => {
    if (statuses.size > 0 && !statuses.has(t.status)) return false;
    if (wiring.size > 0 && !wiring.has(wiringFacetOf(t))) return false;
    if (categories.size > 0 && !(t.category && categories.has(t.category))) return false;
    return matchesQuery(t, q);
  });
}
