/**
 * Known-metric-slug registry — a tiny module-level set the link resolver
 * consults so a glossary term never renders a clickable link to a
 * `business_metrics/<slug>` that doesn't exist in the registry.
 *
 * `useBusinessMetrics` feeds every fetched registry id in here (accumulating
 * across the games a session visits). The resolver fails OPEN until the set is
 * populated (`hasKnownMetrics()` false) so a valid link is never degraded
 * during the first registry load — the guard only fires once we actually know
 * the metric universe and the slug is provably absent.
 */

const known = new Set<string>();

export function registerKnownMetricSlugs(ids: Iterable<string>): void {
  for (const id of ids) known.add(id);
}

export function isKnownMetricSlug(slug: string): boolean {
  return known.has(slug);
}

export function hasKnownMetrics(): boolean {
  return known.size > 0;
}

/** Test-only: reset between cases. */
export function __resetKnownMetrics(): void {
  known.clear();
}
