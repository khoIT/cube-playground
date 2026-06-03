/**
 * URL (de)serialization for the glossary index filters, so a filtered view is
 * shareable/bookmarkable and survives reload. Kept pure + separate from the page
 * so the param grammar is unit-testable.
 *
 * Param grammar (all optional; absent = no constraint):
 *   q       free-text query
 *   status  csv of draft|official
 *   wiring  csv of wired|definition
 *   cat     csv of category slugs
 *
 * The `#<id>` glossary anchor lives in location.hash and is untouched by this.
 */

import type { GlossaryStatus } from '../../../api/glossary-client';
import type { WiringFacet } from './glossary-filter';

export interface GlossaryUrlState {
  query: string;
  statuses: Set<GlossaryStatus>;
  wiring: Set<WiringFacet>;
  categories: Set<string>;
}

function csv(params: URLSearchParams, key: string): string[] {
  return (params.get(key)?.split(',').map((s) => s.trim()).filter(Boolean)) ?? [];
}

export function parseFilterParams(search: string): GlossaryUrlState {
  const p = new URLSearchParams(search);
  const statuses = new Set(
    csv(p, 'status').filter((v): v is GlossaryStatus => v === 'draft' || v === 'official'),
  );
  const wiring = new Set(
    csv(p, 'wiring').filter((v): v is WiringFacet => v === 'wired' || v === 'definition'),
  );
  const categories = new Set(csv(p, 'cat'));
  return { query: p.get('q') ?? '', statuses, wiring, categories };
}

export function serializeFilterParams(state: GlossaryUrlState): string {
  const p = new URLSearchParams();
  const q = state.query.trim();
  if (q) p.set('q', q);
  if (state.statuses.size) p.set('status', [...state.statuses].join(','));
  if (state.wiring.size) p.set('wiring', [...state.wiring].join(','));
  if (state.categories.size) p.set('cat', [...state.categories].join(','));
  const str = p.toString();
  return str ? `?${str}` : '';
}
