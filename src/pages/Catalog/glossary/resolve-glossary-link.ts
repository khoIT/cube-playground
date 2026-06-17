/**
 * Single source of truth for "where does a glossary term link to?"
 *
 * Routing rules (first match wins):
 *   1. `primaryCatalogId` matches `business_metrics/<slug>` → /catalog/metric/<slug>
 *      (lands on the metric detail page where the user can Open in Explore).
 *   2. `defaultMeasureRef` → /build pre-seeded with that measure (and the filter
 *      too, if present) — terms that name a quantity deep-link to a real query.
 *   3. Otherwise → /catalog/glossary#<id> — the index anchored to the term's own
 *      definition row (the index page scrolls/highlights the matching row on
 *      load). This is the destination for filter-only concept terms (whale,
 *      dolphin, minnow) and for plain terms (cohort, funnel): a term is a
 *      definition first, so landing on its glossary entry beats dropping the
 *      user into a near-empty query builder. The richer "open as a filtered
 *      query" affordance lives on that row's chip, not on the term click.
 *
 * Stays synchronous (returns a `string`) because it is called inline in JSX
 * `to={…}`. No network, no /meta lookup — operates purely on fields already
 * present on the client `GlossaryTerm`.
 */

import type { GlossaryFilter } from '../../../api/glossary-client';
import { hasKnownMetrics, isKnownMetricSlug } from './known-metrics-registry';

const BUSINESS_METRIC_PREFIX = 'business_metrics/';

/**
 * A `business_metrics/<slug>` ref should only route to the metric detail page
 * when that metric actually exists — otherwise the link 404s. We can only know
 * the metric universe once the registry has loaded; until then, fail open
 * (route to the metric) so a valid link is never degraded during first load.
 */
export function metricSlugResolves(slug: string): boolean {
  return !hasKnownMetrics() || isKnownMetricSlug(slug);
}

export interface ResolvableTerm {
  id: string;
  primaryCatalogId: string | null;
  /** Concept-tier predicate (e.g. mf_users.payer_tier = whale). Optional: chat
   *  segments may not carry it, in which case we fall back to the anchor. */
  defaultFilter?: GlossaryFilter | null;
  /** Concept-tier measure FQN (e.g. mf_users.user_count). */
  defaultMeasureRef?: string | null;
}

/** GlossaryFilter op symbols → Cube REST filter operators. */
const OP_TO_CUBE_OPERATOR: Record<GlossaryFilter['op'], string> = {
  '=': 'equals',
  '!=': 'notEquals',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  IN: 'equals',
  'NOT IN': 'notEquals',
};

export function toCubeFilter(f: GlossaryFilter): { member: string; operator: string; values: string[] } {
  const raw = Array.isArray(f.value) ? f.value : [f.value];
  return {
    member: f.member,
    operator: OP_TO_CUBE_OPERATOR[f.op] ?? 'equals',
    values: raw.map((v) => String(v)),
  };
}

/**
 * Builds a /build deep-link pre-seeded with the term's measure (and its filter,
 * when one is present). Only called for terms that carry a `defaultMeasureRef`,
 * so the query always has a measure — a filter-only term routes to its glossary
 * row instead (see `resolveGlossaryHref`).
 */
function buildExploreHref(term: ResolvableTerm): string {
  const measures = term.defaultMeasureRef ? [term.defaultMeasureRef] : [];
  const filters = term.defaultFilter ? [toCubeFilter(term.defaultFilter)] : [];
  const query = { measures, dimensions: [] as string[], filters };
  const search = new URLSearchParams();
  search.set('query', JSON.stringify(query));
  search.set('from', `glossary:${term.id}`);
  return `/build?${search.toString()}`;
}

export function resolveGlossaryHref(term: ResolvableTerm): string {
  const pid = term.primaryCatalogId;
  if (pid && pid.startsWith(BUSINESS_METRIC_PREFIX)) {
    const slug = pid.slice(BUSINESS_METRIC_PREFIX.length);
    // Only route to the metric page when the metric resolves; a dangling ref
    // falls through to the measure deep-link or the term's glossary row so the
    // chip never lands on a "no metric found" dead end.
    if (slug.length > 0 && metricSlugResolves(slug)) {
      return `/catalog/metric/${encodeURIComponent(slug)}`;
    }
  }
  if (term.defaultMeasureRef) {
    return buildExploreHref(term);
  }
  return `/catalog/glossary#${encodeURIComponent(term.id)}`;
}
