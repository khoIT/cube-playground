/**
 * Compute the cohort size for a candidate predicate tree WITHOUT creating a
 * segment — the "dry-run count" behind the chat propose card's pre-confirm size.
 *
 * It deliberately uses the SAME building blocks `refreshSegment` uses to size a
 * live cohort — identity-field resolution, percentile-cutoff resolution,
 * predicate→Cube-filters translation, and a Cube `/load` with `total: true` —
 * so the previewed number matches what the segment will report after its first
 * refresh. (Refresh has a `sizeMeasure` fast-path that returns the same count
 * faster; `total: true` is its universal fallback, so a preview that uses only
 * `total: true` is exact, just one extra group-count plan.) Sharing the
 * underlying services — rather than extracting refresh's monolith — keeps the
 * critical refresh path untouched while still giving one translation of intent.
 */

import type { PredicateNode } from '../types/predicate-tree.js';
import { treeToCubeFilters } from './translator.js';
import { resolveIdentityDetailed } from './resolve-identity-field.js';
import { loadWithContinueWait } from './load-with-continue-wait.js';
import { collectPercentileLeaves, resolveSegmentCutoffs } from './segment-cutoff-resolver.js';
import { withCubeSegments } from './cube-query-segments.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';

const DEFAULT_PREVIEW_TIMEOUT_MS = 60_000;

/** A structural failure the caller should surface as a 4xx, not retry. */
export class SegmentSizeError extends Error {
  kind: 'uncohortable' | 'introspection-failed';
  constructor(kind: SegmentSizeError['kind'], message: string) {
    super(message);
    this.name = 'SegmentSizeError';
    this.kind = kind;
  }
}

export interface ComputeSegmentSizeOpts {
  cube: string;
  gameId: string | null;
  workspace?: string;
  predicateTree: PredicateNode;
  /** Cube-level segments to AND onto the query (rare; explore artifacts only). */
  cubeSegments?: string[];
  timeoutMs?: number;
  /** Override the game-scoped Cube token (tests / specific tenants). */
  tokenOverride?: string;
}

/** Injectable seams so the size logic is unit-testable without Cube/Trino. */
export interface ComputeSegmentSizeDeps {
  loadFn?: (query: unknown, token: string | undefined, timeoutMs: number) => Promise<unknown>;
  resolveIdentity?: typeof resolveIdentityDetailed;
  resolveCutoffs?: typeof resolveSegmentCutoffs;
}

export interface SegmentSizeResult {
  count: number;
  identityField: string;
}

export async function computeSegmentSize(
  opts: ComputeSegmentSizeOpts,
  deps: ComputeSegmentSizeDeps = {},
): Promise<SegmentSizeResult> {
  const loadFn = deps.loadFn ?? loadWithContinueWait;
  const resolveIdentity = deps.resolveIdentity ?? resolveIdentityDetailed;
  const resolveCutoffs = deps.resolveCutoffs ?? resolveSegmentCutoffs;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS;

  // 1. The cohort is keyed by the cube's identity dimension — same field the
  //    refresh materializes uids from. No identity field ⇒ uncohortable.
  const identity = await resolveIdentity(opts.cube, opts.gameId, { workspaceId: opts.workspace });
  if (!identity.field) {
    if (identity.reason === 'introspection-failed') {
      // Transient: Cube unreachable. Let the caller treat it as retry/timeout.
      throw new SegmentSizeError('introspection-failed', `could not introspect ${opts.cube}`);
    }
    throw new SegmentSizeError('uncohortable', `no identity-field mapping for ${opts.cube}`);
  }
  const identityField = identity.field;

  // 2. Rolling percentile leaves resolve their live cutoff before translation,
  //    exactly as refresh does — a "top quartile" preview tracks today's data.
  let resolvedPercentiles: Map<string, number> | undefined;
  if (collectPercentileLeaves(opts.predicateTree).length > 0) {
    resolvedPercentiles = await resolveCutoffs(opts.predicateTree);
  }

  // 3. Predicate tree → Cube filters; project only the identity dim and ask Cube
  //    for the grouped row count via `total: true` (one row per user, counted).
  const filters = treeToCubeFilters(opts.predicateTree, resolvedPercentiles ? { resolvedPercentiles } : {});
  const baseQuery: Record<string, unknown> = {
    filters,
    dimensions: [identityField],
    total: true,
    limit: 1,
  };
  const query =
    opts.cubeSegments && opts.cubeSegments.length > 0
      ? withCubeSegments(baseQuery, opts.cubeSegments)
      : baseQuery;

  const token =
    opts.tokenOverride ?? (opts.gameId ? resolveCubeTokenForGame(opts.gameId) ?? undefined : undefined);

  const result = (await loadFn(query, token, timeoutMs)) as {
    total?: number;
    results?: Array<{ total?: number }>;
  };
  const count = result.total ?? result.results?.[0]?.total ?? 0;
  return { count, identityField };
}
