/**
 * Smart-search types. v1 = local substring engine over the in-memory
 * business-metrics registry + Cube /meta concepts. v2 (deferred) will plug
 * a remote agent into the same `SearchResult` shape.
 */

export type SearchKind = 'metric' | 'concept';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  label: string;
  sublabel: string;
  routeTo: string;
  score: number;
}

export interface SearchEngine {
  /** Pure: takes a query + the input pool, returns sorted results. */
  search(query: string): SearchResult[];
}
