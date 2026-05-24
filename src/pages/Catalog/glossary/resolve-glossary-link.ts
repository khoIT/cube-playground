/**
 * Single source of truth for "where does a glossary term link to?"
 *
 * Routing rules:
 *   1. `primaryCatalogId` matches `business_metrics/<slug>` → /catalog/metric/<slug>
 *      (lands on the metric detail page where the user can Open in Explore).
 *   2. Otherwise → /catalog/glossary (the index — keeps the click meaningful
 *      for terms without a metric binding like `cohort`, `funnel`, `engagement`).
 */

const BUSINESS_METRIC_PREFIX = 'business_metrics/';

export interface ResolvableTerm {
  id: string;
  primaryCatalogId: string | null;
}

export function resolveGlossaryHref(term: ResolvableTerm): string {
  const pid = term.primaryCatalogId;
  if (pid && pid.startsWith(BUSINESS_METRIC_PREFIX)) {
    const slug = pid.slice(BUSINESS_METRIC_PREFIX.length);
    if (slug.length > 0) return `/catalog/metric/${encodeURIComponent(slug)}`;
  }
  return '/catalog/glossary';
}
