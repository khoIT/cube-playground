/**
 * Fetches and structures the /meta member catalog for the predicate builder.
 *
 * Returns dimensions + filterable measures grouped by cube: the segment's
 * primary cube and every cube reachable through its joins. Powers the
 * member-field dropdown so users pick a fully qualified member (cube.field)
 * rather than typing it free-form.
 *
 * Join reachability is determined via `connectedComponent` from the raw
 * `/meta?extended=true` response — cubes sharing the primary cube's component
 * are considered joinable. The SDK `.meta()` call strips this field, so we
 * fetch raw JSON directly (same pattern as use-catalog-meta.ts in the Catalog
 * page). The SDK call is never used for catalog construction.
 *
 * Meta is fetched once per (workspace, game) session and cached at module level,
 * following the same pattern as the auto-preset loader so the heavy meta payload
 * is never double-fetched within a session.
 */

import { useEffect, useState } from 'react';
import { useAppContext } from '../../../../hooks';
import { useWorkspaceContext, WORKSPACE_HEADER } from '../../../../components/workspace-context';
import { useActiveGameId } from '../../../../components/Header/use-game-context';
import type { LeafValueType } from '../../../../types/segment-api';

export interface CatalogMember {
  name: string;
  title: string;
  /** Normalised to the predicate leaf types. */
  type: LeafValueType;
  /** 'dimension' | 'measure' — measure entries are always numeric/filterable. */
  kind: 'dimension' | 'measure';
}

export interface CatalogGroup {
  cube: string;
  title: string;
  members: CatalogMember[];
}

export interface ModelSegmentEntry {
  name: string;
  title: string;
  cube: string;
}

export interface MemberCatalog {
  groups: CatalogGroup[];
  /** Flat map member-name → entry for O(1) type lookup on pick. */
  byName: Map<string, CatalogMember>;
  /** Model-defined segments across primary + joined cubes (for chip panel). */
  modelSegments: ModelSegmentEntry[];
}

interface RawMetaMember {
  name: string;
  title?: string;
  type?: string;
}

export interface RawMetaCube {
  name: string;
  title?: string;
  /** Present in /meta?extended=true; absent in SDK meta(). Used for join reachability. */
  connectedComponent?: number;
  measures?: RawMetaMember[];
  dimensions?: RawMetaMember[];
  segments?: Array<{ name: string; title?: string }>;
}

/** Map Cube meta type strings to the four predicate leaf value types. */
function toCatalogType(raw: string | undefined): LeafValueType {
  if (!raw) return 'string';
  if (
    raw === 'number' || raw === 'count' || raw === 'sum' || raw === 'avg' ||
    raw === 'min' || raw === 'max' || raw === 'countDistinct' || raw === 'runningTotal'
  ) return 'number';
  if (raw === 'time') return 'time';
  if (raw === 'boolean') return 'boolean';
  return 'string';
}

// Module-level cache keyed by `${workspaceId}::${gameId}` — workspace-level
// since the raw meta covers all cubes in the workspace. Primary-cube filtering
// happens client-side in buildCatalog after the raw response arrives.
const rawMetaCache = new Map<string, RawMetaCube[]>();
const rawMetaInFlight = new Map<string, Promise<RawMetaCube[] | null>>();

// Catalog cache keyed by `${workspaceId}::${gameId}::${primaryCube}`.
const catalogCache = new Map<string, MemberCatalog>();

function buildEmptyCatalog(): MemberCatalog {
  return { groups: [], byName: new Map(), modelSegments: [] };
}

/**
 * Builds the member catalog from a list of raw meta cubes and a primary cube.
 *
 * Inclusion logic: the primary cube is always included. Every cube sharing the
 * primary cube's `connectedComponent` (from /meta?extended=true) is included as
 * a "joined" group. If the primary cube has no connectedComponent, it is included
 * alone (degraded path: primary-only). The primary cube group is always first;
 * additional component-peers are sorted alphabetically.
 *
 * Guard: if every cube in the workspace shares one component (single-component
 * workspace), all will be listed — intentional and acceptable per spec.
 */
export function buildCatalog(cubes: RawMetaCube[], primaryCube: string): MemberCatalog {
  const primary = cubes.find((c) => c.name === primaryCube);
  if (!primary) return buildEmptyCatalog();

  const primaryComponent = primary.connectedComponent;

  // Primary always first; component-peers sorted alphabetically after.
  let includedCubes: RawMetaCube[];
  if (primaryComponent !== undefined && primaryComponent !== null) {
    const peers = cubes
      .filter((c) => c.name !== primaryCube && c.connectedComponent === primaryComponent)
      .sort((a, b) => a.name.localeCompare(b.name));
    includedCubes = [primary, ...peers];
  } else {
    // No connectedComponent available — degrade to primary cube only.
    includedCubes = [primary];
  }

  const groups: CatalogGroup[] = [];
  const byName = new Map<string, CatalogMember>();
  const modelSegments: ModelSegmentEntry[] = [];

  for (const cube of includedCubes) {
    const members: CatalogMember[] = [];

    for (const dim of cube.dimensions ?? []) {
      const entry: CatalogMember = {
        name: dim.name,
        title: dim.title ?? (dim.name.split('.').pop() ?? dim.name),
        type: toCatalogType(dim.type),
        kind: 'dimension',
      };
      members.push(entry);
      byName.set(dim.name, entry);
    }

    // Numeric measures are filterable in Cube query `filters` arrays.
    for (const m of cube.measures ?? []) {
      if (toCatalogType(m.type) === 'number') {
        const entry: CatalogMember = {
          name: m.name,
          title: m.title ?? (m.name.split('.').pop() ?? m.name),
          type: 'number',
          kind: 'measure',
        };
        members.push(entry);
        byName.set(m.name, entry);
      }
    }

    // Model-defined named SQL segments (e.g. mf_users.whales) — used by the chip panel.
    for (const seg of cube.segments ?? []) {
      modelSegments.push({
        name: seg.name,
        title: seg.title ?? (seg.name.split('.').pop() ?? seg.name),
        cube: cube.name,
      });
    }

    if (members.length > 0) {
      groups.push({
        cube: cube.name,
        title: cube.title ?? cube.name,
        members,
      });
    }
  }

  return { groups, byName, modelSegments };
}

/**
 * Fetches the raw /meta?extended=true JSON for a workspace+game pair.
 * Returns the cubes array, or null on network/parse error.
 * Failures are NOT cached so a workspace reconnect retries on the next mount.
 */
async function fetchRawMeta(
  apiUrl: string,
  token: string | null,
  workspaceId: string | null,
  gameId: string | null,
  cacheKey: string,
): Promise<RawMetaCube[] | null> {
  if (rawMetaCache.has(cacheKey)) return rawMetaCache.get(cacheKey)!;
  const inflight = rawMetaInFlight.get(cacheKey);
  if (inflight) return inflight;

  const promise: Promise<RawMetaCube[] | null> = (async () => {
    try {
      const base = apiUrl.endsWith('/v1') ? apiUrl : `${apiUrl}/v1`;
      const url = `${base}/meta?extended=true`;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = token;
      if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
      if (gameId) headers['x-cube-game'] = gameId;

      // 10s timeout — matches use-catalog-meta.ts defensive pattern.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);

      let cubes: RawMetaCube[];
      try {
        const resp = await fetch(url, { headers, signal: ctl.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as { cubes?: RawMetaCube[] };
        cubes = json.cubes ?? [];
      } finally {
        clearTimeout(timer);
      }

      rawMetaCache.set(cacheKey, cubes);
      return cubes;
    } catch {
      // Meta unavailable — callers degrade to primary-cube-only or free-text input.
      return null;
    } finally {
      rawMetaInFlight.delete(cacheKey);
    }
  })();

  rawMetaInFlight.set(cacheKey, promise);
  return promise;
}

export interface UseMemberCatalogResult {
  catalog: MemberCatalog | null;
  loading: boolean;
}

/**
 * Returns the member catalog for `primaryCube` (primary + component-peer cubes).
 * Returns `null` while loading or when /meta is unavailable — callers must
 * degrade gracefully (the predicate leaf shows a plain text Input instead).
 */
export function usePredicateMemberCatalog(primaryCube: string | null): UseMemberCatalogResult {
  // token from AppContext — matches the pattern in use-catalog-meta.ts.
  // Cast because the context shape exposes `token` but TypeScript infers
  // useAppContext() return type as ContextProps which already includes `token`.
  const { apiUrl, token } = useAppContext() as { apiUrl: string | null; token: string | null };
  const { workspaceId } = useWorkspaceContext();
  const gameId = useActiveGameId();

  const [catalog, setCatalog] = useState<MemberCatalog | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!primaryCube || !apiUrl) {
      setCatalog(null);
      setLoading(false);
      return;
    }

    const catalogKey = `${workspaceId ?? ''}::${gameId ?? ''}::${primaryCube}`;

    // Synchronous catalog cache hit avoids flicker on remount/step navigation.
    if (catalogCache.has(catalogKey)) {
      setCatalog(catalogCache.get(catalogKey)!);
      return;
    }

    const rawKey = `${workspaceId ?? ''}::${gameId ?? ''}`;

    // If raw meta is already in cache, build the catalog synchronously (no flicker).
    if (rawMetaCache.has(rawKey)) {
      const cubes = rawMetaCache.get(rawKey)!;
      const built = buildCatalog(cubes, primaryCube);
      catalogCache.set(catalogKey, built);
      setCatalog(built);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchRawMeta(apiUrl, token ?? null, workspaceId ?? null, gameId ?? null, rawKey).then(
      (cubes) => {
        if (!cancelled) {
          if (cubes) {
            const built = buildCatalog(cubes, primaryCube);
            catalogCache.set(catalogKey, built);
            setCatalog(built);
          } else {
            setCatalog(null);
          }
          setLoading(false);
        }
      },
    );

    return () => { cancelled = true; };
    // workspaceId / gameId changes invalidate both the raw and catalog caches
    // because the meta response is workspace+game scoped.
  }, [primaryCube, apiUrl, token, workspaceId, gameId]);

  return { catalog, loading };
}
