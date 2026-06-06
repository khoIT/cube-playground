/**
 * Resolves a segment's preset_id (or hubCube fallback) to a Preset object.
 *
 * Lookup order:
 *   1. Curated preset by `segment.preset_id`
 *   2. Curated preset by `segment.cube` matching `preset.hubCube`
 *   3. PIVOT — the segment's identity field is join-inherited from a cube
 *      with a curated preset (identity map) → reuse the anchor's preset
 *   4. Auto-synthesized preset from live Cube /meta (cached per cube name)
 *
 * The pivot/auto paths are async — we briefly return `null` while the
 * identity map / meta is fetched, then re-render. Empty-state UI already
 * handles `preset == null` gracefully, so the transient null is not
 * visually disruptive.
 */

import { useEffect, useMemo, useState } from 'react';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';
import { useIdentityMap } from '../../../hooks/use-identity-map';
import { getPreset, getPresetByHubCube, resolvePivotPreset } from '../presets/registry';
import { synthesizeAutoPreset } from '../presets/auto-preset';
import type { CubeMetaCube } from '../presets/auto-preset';
import type { Segment } from '../../../types/segment-api';
import type { Preset } from '../presets/types';

// Module-level cache: cubeName → synthesized preset (or null when unbuildable).
const autoPresetCache = new Map<string, Preset | null>();
const inFlight = new Map<string, Promise<Preset | null>>();

interface CubeMetaResponse {
  cubes: CubeMetaCube[];
}

interface CubejsLike {
  meta(): Promise<{ cubesMap?: Record<string, CubeMetaCube>; cubes?: CubeMetaCube[] }>;
}

function curated(segment: Segment): Preset | null {
  const direct = getPreset((segment as Segment & { preset_id?: string }).preset_id ?? null);
  if (direct) return direct;
  return getPresetByHubCube(segment.cube);
}

function metaToResponse(meta: {
  cubesMap?: Record<string, CubeMetaCube>;
  cubes?: CubeMetaCube[];
}): CubeMetaResponse {
  if (meta.cubes && Array.isArray(meta.cubes)) return { cubes: meta.cubes };
  if (meta.cubesMap) return { cubes: Object.values(meta.cubesMap) };
  return { cubes: [] };
}

async function loadAutoPreset(
  cubejsApi: CubejsLike,
  cubeName: string,
): Promise<Preset | null> {
  if (autoPresetCache.has(cubeName)) return autoPresetCache.get(cubeName) ?? null;
  const existing = inFlight.get(cubeName);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const meta = await cubejsApi.meta();
      const synthesized = synthesizeAutoPreset(metaToResponse(meta), cubeName);
      autoPresetCache.set(cubeName, synthesized);
      return synthesized;
    } catch {
      autoPresetCache.set(cubeName, null);
      return null;
    } finally {
      inFlight.delete(cubeName);
    }
  })();
  inFlight.set(cubeName, promise);
  return promise;
}

export function usePreset(segment: Segment | null): Preset | null {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);
  const { mappings, loading: identityLoading } = useIdentityMap();

  const curatedPreset = useMemo(
    () => (segment ? curated(segment) : null),
    [segment],
  );

  // Identity-anchor pivot: cube has no curated preset, but its identity is
  // join-inherited from a cube that has one — reuse the anchor's preset.
  // While the shared identity map is still loading we return null below
  // (NOT auto) to avoid flashing the best-effort auto preset and then
  // swapping it for the pivoted one.
  const pivotedPreset = useMemo(() => {
    if (!segment || curatedPreset || !segment.cube) return null;
    const row = mappings.find((m) => m.cube === segment.cube);
    return resolvePivotPreset(segment.cube, row?.identity_field ?? null);
  }, [segment, curatedPreset, mappings]);

  const [auto, setAuto] = useState<Preset | null>(null);

  useEffect(() => {
    setAuto(null);
    if (!segment || curatedPreset || pivotedPreset || identityLoading || !segment.cube || !cubejsApi) return;
    const cube = segment.cube;
    // Sync hit on cache to avoid the null flicker when revisiting same cube.
    if (autoPresetCache.has(cube)) {
      setAuto(autoPresetCache.get(cube) ?? null);
      return;
    }
    let cancelled = false;
    loadAutoPreset(cubejsApi as unknown as CubejsLike, cube).then((p) => {
      if (!cancelled) setAuto(p);
    });
    return () => {
      cancelled = true;
    };
  }, [segment, curatedPreset, pivotedPreset, identityLoading, cubejsApi]);

  return curatedPreset ?? pivotedPreset ?? auto;
}
