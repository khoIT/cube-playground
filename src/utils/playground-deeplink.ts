/**
 * Playground deeplink utilities.
 *
 * Two flavours:
 *
 *   buildPlaygroundDeeplink   — legacy uid-IN path; retained for saved-analyses
 *                               callers that open a SAVED analysis query with
 *                               the uid list overlaid. The ?from-segment= param
 *                               it emits on overflow now has a real sessionStorage
 *                               consumer in QueryBuilderContainer.
 *
 *   buildDefinitionDeeplink   — definition-mode path (the primary segment
 *                               "Open in Playground" button). Carries the
 *                               segment's predicate tree → Cube filters +
 *                               timeDimensions, NOT the stored cube_query_json.
 *                               See WHY note in predicate-tree-to-cube-query.ts.
 *
 * Pure module — no React, no DOM globals besides sessionStorage / location.
 */

import type { PredicateNode } from '../types/segment-api';
import { treeToQueryFragment } from '../pages/Segments/predicate-tree-to-cube-query';

export interface DeeplinkInput {
  /** Optional starting Cube query (filters, measures, etc.). */
  baseQuery?: Record<string, unknown>;
  segmentId: string;
  segmentName: string;
  identityDim: string;
  primaryCube: string | null;
  uids: string[];
}

export interface DeeplinkResult {
  url: string;
  via: 'inline' | 'session-storage';
}

/** Returned when the deeplink cannot be constructed (e.g. manual segment with
 *  too many uids and no predicate tree to fall back on). */
export interface DeeplinkDisabled {
  disabled: true;
  reason: string;
}

// ── definition deeplink types ─────────────────────────────────────────────

export interface DefinitionDeeplinkInput {
  segment: {
    id: string;
    name: string;
    type: 'manual' | 'predicate';
    cube: string | null;
    /** Parsed predicate tree (the FE field; mirrors predicate_tree_json). */
    predicate_tree: PredicateNode | null;
    /** Stored cube_query_json string; we extract only the segments[] sidecar. */
    cube_query_json: string | null;
    uid_list: string[];
    game_id: string;
  };
  /** Identity dimension to include in query dimensions (e.g. mf_users.user_id).
   *  Including it satisfies the save-bar's uid/expansion mode gate — the bar
   *  renders only when the query contains the identity dimension, enabling
   *  per-user row exploration and the eventual "Update segment" action. */
  identityDim: string;
  /** Cube-level segment names extracted from cube_query_json.segments; injected
   *  as the query's segments[] sidecar. Caller is responsible for parsing. */
  cubeSegments?: string[];
  /** Active game ID at the time of deeplink emission. Stored in the edit
   *  context so QueryBuilderContainer can guard against workspace mismatches. */
  gameId: string;
}

/**
 * The edit context stashed in sessionStorage alongside an oversize definition
 * query, or recorded inline in the URL alongside ?edit-segment=<id>.
 *
 * The save-back flow reads this to:
 *   - Display the editing banner.
 *   - Strip echo filters (identity dim injection, game-scoping filter) by
 *     exact structural match before diffing the modified query against the
 *     original predicate, so injected plumbing isn't mistaken for user edits.
 *   - Guard against game/workspace mismatches on boot.
 */
export interface SegmentEditContext {
  segmentId: string;
  segmentName: string;
  gameId: string;
  /**
   * Filters that were injected by the deeplink builder and are NOT part of the
   * user's predicate. Save-back must strip these by exact structural match
   * before interpreting the modified query as user intent.
   *
   * Currently populated with:
   *   - { member: identityDim, operator: 'equals', values: ['__uid__'] }
   *     (placeholder — identity dim is in dimensions[], not filters[])
   *   - Any { member: '<cube>.gameId', operator: 'equals', values: [gameId] }
   *     filters injected by applyGameFilter.
   *
   * We record them structurally (not by member name) so the strip is
   * deterministic even if the query member naming evolves.
   */
  echoFilters: Array<{ member: string; operator: string; values?: string[] }>;
  returnedFrom: 'segment-detail';
}

export interface DefinitionDeeplinkResult {
  url: string;
  via: 'inline' | 'session-storage';
  /** Serialised edit context — also written to sessionStorage on the session-
   *  storage path; on the inline path it is embedded in the ?edit-context=
   *  param so QueryBuilderContainer can read it without a storage round-trip. */
  editContext: SegmentEditContext;
}

const URL_LIMIT = 8000;
const STORAGE_KEY_PREFIX = 'gds-cube:pending-deeplink:';
const EDIT_CTX_KEY_PREFIX = 'gds-cube:pending-edit-ctx:';

// ── uid-IN helpers (legacy / saved-analyses path) ─────────────────────────

export function mergeUidFilter(
  baseQuery: Record<string, unknown> | undefined,
  identityDim: string,
  uids: string[],
): Record<string, unknown> {
  const filters = Array.isArray(baseQuery?.filters) ? [...(baseQuery!.filters as unknown[])] : [];
  filters.push({ member: identityDim, operator: 'in', values: uids });
  return { ...baseQuery, filters };
}

/**
 * Build a uid-IN deeplink for a saved analysis (legacy path).
 *
 * Still used by saved-analyses-tab to open a previously-saved exploration
 * query with the segment's current uid list applied as an IN filter.
 * The sessionStorage overflow path now has a real consumer in
 * QueryBuilderContainer — see ?from-segment= handling there.
 */
export function buildPlaygroundDeeplink(input: DeeplinkInput): DeeplinkResult {
  // No synthetic fallback measure: cube models name their count measures
  // differently (rows / events / transactions), so guessing `<cube>.count`
  // produces a Cube UserError at boot. A filters-only query boots fine.
  const base = input.baseQuery ?? {};
  const merged = mergeUidFilter(base, input.identityDim, input.uids);
  const encoded = encodeURIComponent(JSON.stringify(merged));

  const inlineUrl = `#/build?query=${encoded}`;

  if (inlineUrl.length <= URL_LIMIT) {
    return { url: inlineUrl, via: 'inline' };
  }

  // Overflow: stash query in sessionStorage; QueryBuilderContainer reads it
  // via the ?from-segment= consumer pattern.
  const key = `${STORAGE_KEY_PREFIX}${input.segmentId}`;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(key, JSON.stringify(merged));
    } catch {
      // sessionStorage full / unavailable — caller's UI surfaces failure.
    }
  }
  return { url: `#/build?from-segment=${encodeURIComponent(input.segmentId)}`, via: 'session-storage' };
}

// ── definition deeplink (primary segment button) ──────────────────────────

/**
 * Build a definition-mode deeplink for the segment's "Open in Playground"
 * button.
 *
 * For predicate segments: maps predicate_tree → {filters, timeDimensions};
 * For manual segments with a small uid list: builds an IN filter inline;
 * For manual segments with a large uid list (no tree): returns
 *   { disabled, reason } so the caller can render a disabled button.
 *
 * Query shape:
 *   {
 *     measures:        [],              ← cube count-measure names vary
 *                                         (rows/events/transactions); a
 *                                         guessed name errors at boot
 *     dimensions:      [identityDim],   ← satisfies save-bar uid-mode gate
 *     filters:         <from tree>,
 *     timeDimensions:  <from tree>,
 *     segments:        <sidecar>,
 *     limit:           100,
 *   }
 *
 * WHY identityDim in dimensions: the save-bar renders the "Update segment"
 * button only in uid/expansion mode, which requires the identity dimension to
 * be present. Including it here ensures the CTA is reachable immediately after
 * boot without manual dimension selection. Trade-off: the boot query returns
 * one row per matching user (up to limit:100) rather than a simple aggregate —
 * this is acceptable because the user's intent is to explore members and
 * edit the predicate, not to see a rolled-up count.
 */
export function buildDefinitionDeeplink(
  input: DefinitionDeeplinkInput,
): DefinitionDeeplinkResult | DeeplinkDisabled {
  const { segment, identityDim, cubeSegments = [], gameId } = input;
  const cube = segment.cube;

  // ── build the query ──────────────────────────────────────────────────────

  let query: Record<string, unknown>;

  if (segment.type === 'predicate' && segment.predicate_tree) {
    const { filters, timeDimensions } = treeToQueryFragment(segment.predicate_tree);
    query = {
      measures: [],
      dimensions: [identityDim],
      filters,
      timeDimensions,
      ...(cubeSegments.length > 0 ? { segments: cubeSegments } : {}),
      limit: 100,
    };
  } else if (segment.type === 'manual') {
    const uids = segment.uid_list ?? [];
    // Build inline uid-IN query for manual segments.
    // If the resulting URL would exceed the limit this path also falls through
    // to the disabled return below (we do the length check after encoding).
    query = {
      measures: [],
      dimensions: [identityDim],
      filters: uids.length > 0 ? [{ member: identityDim, operator: 'in', values: uids }] : [],
      timeDimensions: [],
      limit: 100,
    };
  } else {
    // predicate segment with no tree yet (draft / broken)
    query = {
      measures: [],
      dimensions: [identityDim],
      filters: [],
      timeDimensions: [],
      ...(cubeSegments.length > 0 ? { segments: cubeSegments } : {}),
      limit: 100,
    };
  }

  // ── echo filters record ──────────────────────────────────────────────────
  // applyGameFilter (QueryBuilderContainer) injects a { member: '<cube>.gameId',
  // operator: 'equals', values: [gameId] } filter for EVERY cube referenced
  // in the query that exposes a gameId dimension. We record an echo entry for
  // every cube referenced so the save-back stripper can remove all of them by
  // exact structural match — even when different cubes (e.g. identityDim cube
  // vs primary segment cube) each get their own injection.
  //
  // We record echoes conservatively: the stripper uses exact match (member +
  // operator + values), so entries for cubes that don't actually have a gameId
  // dim are harmless — applyGameFilter won't inject them and they'll never match.
  const echoFilters: SegmentEditContext['echoFilters'] = [];
  const referencedCubes = new Set<string>();
  function cubeOf(member: string): string {
    const dot = member.indexOf('.');
    return dot >= 0 ? member.slice(0, dot) : member;
  }
  // Collect cubes from all query members
  if (query.dimensions) (query.dimensions as string[]).forEach((d) => referencedCubes.add(cubeOf(d)));
  if (query.measures) (query.measures as string[]).forEach((m) => referencedCubes.add(cubeOf(m)));
  if (query.timeDimensions) {
    (query.timeDimensions as Array<{ dimension: string }>).forEach((td) =>
      referencedCubes.add(cubeOf(td.dimension)),
    );
  }
  if (query.segments) (query.segments as string[]).forEach((s) => referencedCubes.add(cubeOf(s)));
  // Also include the primary cube explicitly (in case it's only in filters)
  if (cube) referencedCubes.add(cube);
  // Emit one echo per referenced cube so all game-scoping injections are covered
  for (const refCube of referencedCubes) {
    if (!refCube) continue;
    echoFilters.push({ member: `${refCube}.gameId`, operator: 'equals', values: [gameId] });
  }

  const editContext: SegmentEditContext = {
    segmentId: segment.id,
    segmentName: segment.name,
    gameId,
    echoFilters,
    returnedFrom: 'segment-detail',
  };

  // ── URL assembly + edit-context persistence ──────────────────────────────
  //
  // The edit context is ALWAYS written to sessionStorage (keyed by segment id),
  // regardless of whether the query fits inline or overflows to the from-segment
  // path. This ensures:
  //   - QueryBuilderContainer always reads a full context (echoFilters,
  //     gameId from the deeplink-emission game) — never a minimal stub with
  //     echoFilters:[] and a faked gameId from the active game.
  //   - The game-mismatch guard and echo-strip work correctly on the inline
  //     path (the dominant case for small predicate segments).
  //
  // The ctxKey is cleared by clearDeeplinkStorage after QueryBuilderContainer
  // consumes it (same as the query overflow key).

  const ctxKey = `${EDIT_CTX_KEY_PREFIX}${segment.id}`;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(ctxKey, JSON.stringify(editContext));
    } catch {
      // sessionStorage full — context falls back to minimal reconstruction.
    }
  }

  const editSegmentParam = `edit-segment=${encodeURIComponent(segment.id)}`;
  const queryEncoded = encodeURIComponent(JSON.stringify(query));
  const inlineUrl = `#/build?query=${queryEncoded}&${editSegmentParam}`;

  if (inlineUrl.length <= URL_LIMIT) {
    return {
      url: inlineUrl,
      via: 'inline',
      editContext,
    };
  }

  // Oversize: manual segment with large uid list and no predicate → disable.
  if (segment.type === 'manual') {
    return {
      disabled: true,
      reason: 'cohort too large to explore by ids — convert to live first',
    };
  }

  // Oversize predicate definition: stash the query too (context already written above).
  const queryKey = `${STORAGE_KEY_PREFIX}${segment.id}`;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(queryKey, JSON.stringify(query));
    } catch {
      // sessionStorage full — caller falls back to a degraded message.
    }
  }

  return {
    url: `#/build?from-segment=${encodeURIComponent(segment.id)}&${editSegmentParam}`,
    via: 'session-storage',
    editContext,
  };
}

// ── storage helpers ───────────────────────────────────────────────────────

export function readDeeplinkFromStorage(segmentId: string): Record<string, unknown> | null {
  if (typeof sessionStorage === 'undefined') return null;
  const key = `${STORAGE_KEY_PREFIX}${segmentId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readEditContextFromStorage(segmentId: string): SegmentEditContext | null {
  if (typeof sessionStorage === 'undefined') return null;
  const key = `${EDIT_CTX_KEY_PREFIX}${segmentId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SegmentEditContext;
  } catch {
    return null;
  }
}

export function clearDeeplinkStorage(segmentId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${segmentId}`);
  sessionStorage.removeItem(`${EDIT_CTX_KEY_PREFIX}${segmentId}`);
}
