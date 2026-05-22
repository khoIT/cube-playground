/**
 * Resolves a segment's preset_id (or hubCube fallback) to a Preset object.
 *
 * Lookup order:
 *   1. Curated preset by `segment.preset_id`
 *   2. Curated preset by `segment.cube` matching `preset.hubCube`
 *   3. Auto-synthesized preset from live Cube /meta (cached per cube name)
 *
 * The auto-preset path is async — we briefly return `null` while the meta is
 * fetched, then re-render. Empty-state UI already handles `preset == null`
 * gracefully, so the transient null is not visually disruptive.
 */

import { useEffect, useMemo, useState } from 'react';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';
import { getPreset, getPresetByHubCube } from '../presets/registry';
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

  const curatedPreset = useMemo(
    () => (segment ? curated(segment) : null),
    [segment],
  );

  const [auto, setAuto] = useState<Preset | null>(null);

  useEffect(() => {
    setAuto(null);
    if (!segment || curatedPreset || !segment.cube || !cubejsApi) return;
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
  }, [segment, curatedPreset, cubejsApi]);

  return curatedPreset ?? auto;
}
