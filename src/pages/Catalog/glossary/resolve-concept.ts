/**
 * Concept resolver — sync routing + typed action builder.
 *
 * `resolveConceptHref` is a thin re-export of the P0 anchor router so all
 * callers can import from one place without splitting the dependency.
 *
 * `conceptTypedActions` derives the ordered action list purely from the term
 * fields already present on the client — no network call. Cross-layer actions
 * (segments discovered via the relations endpoint) are handled by the hover-card's
 * async path, NOT here.
 *
 * Action order — fixed per affordance spec:
 *   1. Define  (always)
 *   2. Slice by field  (only when defaultFilter present, no measure required)
 *   3. See metric  (only when primaryCatalogId is a business_metrics/<slug>)
 */

import {
  resolveGlossaryHref,
  metricSlugResolves,
  toCubeFilter,
  type ResolvableTerm,
} from './resolve-glossary-link';
import type { GlossaryFilter } from '../../../api/glossary-client';

// Re-export so callers only need one import.
export { resolveGlossaryHref as resolveConceptHref };
export type { ResolvableTerm };

const BUSINESS_METRIC_PREFIX = 'business_metrics/';

export type TypedActionKind = 'define' | 'slice' | 'metric' | 'segment';

export interface TypedAction {
  kind: TypedActionKind;
  label: string;
  to: string;
  /** Unicode glyph matching the affordance vocabulary (no SVG needed). */
  glyph: string;
}

/** Maps a GlossaryFilter into a /build deep-link with the filter but no measure.
 *  Reuses the single op→Cube-operator translation from the P0 resolver so the
 *  two deep-link builders can never diverge. */
function buildSliceHref(termId: string, filter: GlossaryFilter): string {
  const query = { measures: [] as string[], dimensions: [] as string[], filters: [toCubeFilter(filter)] };
  const search = new URLSearchParams();
  search.set('query', JSON.stringify(query));
  search.set('from', `glossary:${termId}`);
  return `/build?${search.toString()}`;
}

/**
 * Returns the ordered list of typed actions that can be derived synchronously
 * from a term's already-fetched fields. Never returns dead actions — each
 * action only appears when its prerequisite ref exists.
 *
 * "Open segment" is intentionally absent here: it requires the async
 * relations endpoint (cross-layer). The hover-card appends those rows.
 */
export function conceptTypedActions(term: ResolvableTerm & { description?: string }): TypedAction[] {
  const actions: TypedAction[] = [];

  // 1. Define — always present; anchors the specific glossary row.
  const defineHref = `/catalog/glossary#${encodeURIComponent(term.id)}`;
  actions.push({ kind: 'define', label: 'Define', to: defineHref, glyph: 'ⓘ' });

  // 2. Slice by field — only when the term carries a filter predicate.
  //    Filter-only terms (whale, dolphin, minnow) get this affordance on
  //    the hover-card but their primary href still lands on the glossary row.
  if (term.defaultFilter) {
    actions.push({
      kind: 'slice',
      label: `Slice by ${term.defaultFilter.member.split('.').pop() ?? 'field'}`,
      to: buildSliceHref(term.id, term.defaultFilter),
      glyph: '＃',
    });
  }

  // 3. See metric — only when primaryCatalogId is a business_metrics/<slug>.
  const pid = term.primaryCatalogId;
  if (pid && pid.startsWith(BUSINESS_METRIC_PREFIX)) {
    const slug = pid.slice(BUSINESS_METRIC_PREFIX.length);
    // Drop the dead action when the metric doesn't resolve (same guard the
    // primary href uses) — never offer "See metric" for a non-existent metric.
    if (slug.length > 0 && metricSlugResolves(slug)) {
      actions.push({
        kind: 'metric',
        label: 'See metric',
        to: `/catalog/metric/${encodeURIComponent(slug)}`,
        glyph: '▦',
      });
    }
  }

  return actions;
}

const REF_NAMESPACE_PREFIXES = ['business_metrics/', 'data_model/', 'segments/'];

/**
 * Canonical namespaced ref for the cross-layer relations endpoint, or null when
 * the term carries nothing to relate. Normalizes the three shapes a term can
 * carry into the `<namespace>/<id>` grammar the server expects:
 *   - already-namespaced primaryCatalogId (business_metrics/<slug>) → as-is
 *   - bare cube member primaryCatalogId (mf_users.country)          → data_model/<member>
 *   - filter-only / measure-only concept (whale → mf_users.payer_tier) → data_model/<member>
 * Without this, payer-tier terms (primaryCatalogId = null) would never fetch
 * relations, and bare-member terms would form an invalid (namespace-less) ref.
 */
export function toConceptRef(
  term: ResolvableTerm & { defaultMeasureRef?: string | null },
): string | null {
  const pid = term.primaryCatalogId;
  if (pid) {
    if (REF_NAMESPACE_PREFIXES.some((p) => pid.startsWith(p))) return pid;
    if (pid.includes('.') && !pid.includes('/')) return `data_model/${pid}`;
  }
  const member = term.defaultFilter?.member ?? term.defaultMeasureRef ?? null;
  if (member) return `data_model/${member}`;
  return null;
}
