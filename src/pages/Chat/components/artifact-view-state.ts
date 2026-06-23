/**
 * Per-artifact view-state cache — remembers a user's chart/table toggle, chart
 * type, axis pick, and comparison mode for each query artifact, keyed by its
 * stable id.
 *
 * The main chat surface and the right-side chat panel render *separate*
 * QueryArtifactCard instances for the same artifact (independent React trees,
 * independent useState). Without a bridge, a chart→table toggle made in one
 * surface is lost when the same artifact mounts in the other. This module-level
 * cache is that bridge: cards read it at mount and write it on every change, so
 * the last-chosen view follows the artifact across surfaces.
 *
 * In-memory only (per page session) — cross-reload persistence is not intended.
 */
import type { ChartSpec } from '../../../api/chat-sse-client';
import type { ComparisonView } from './comparison-view-toggle';

export interface ArtifactViewState {
  view: 'chart' | 'table';
  overrideType?: ChartSpec['type'];
  overrideEncoding?: ChartSpec['encoding'];
  comparisonView: ComparisonView;
}

const cache = new Map<string, ArtifactViewState>();

/** Last-remembered view state for an artifact, or undefined if never toggled. */
export function getArtifactViewState(id: string): ArtifactViewState | undefined {
  return cache.get(id);
}

/** Persist the current view state so the other surface picks it up on mount. */
export function rememberArtifactViewState(id: string, state: ArtifactViewState): void {
  cache.set(id, state);
}

/** Test seam — clear the cache between cases. */
export function __resetArtifactViewStateForTests(): void {
  cache.clear();
}
