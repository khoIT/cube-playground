/**
 * Detects whether the connected Cube backend exposes an ordered-funnel cube.
 *
 * Detection contract (matches docs/ordered-funnel-cube-template.md):
 *   hasOrderedFunnel = meta has a cube with ALL THREE of:
 *     - a measure ending in `.step_count`
 *     - a dimension ending in `.step_index`
 *     - a dimension ending in `.step_name`
 *
 * When found, `cubeName` holds the matched cube name so callers can build
 * fully-qualified member references (e.g. `<cubeName>.step_count`).
 *
 * Memoised per `metaVersion` string so re-renders don't re-allocate the result.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';

interface MetaMeasure { name: string }
interface MetaDimension { name: string }
interface MetaCube {
  name: string;
  measures?: MetaMeasure[];
  dimensions?: MetaDimension[];
}

function metaToCubes(raw: {
  cubes?: MetaCube[];
  cubesMap?: Record<string, MetaCube>;
}): MetaCube[] {
  if (raw.cubes && Array.isArray(raw.cubes)) return raw.cubes;
  if (raw.cubesMap) return Object.values(raw.cubesMap);
  return [];
}

function detectOrderedCube(cubes: MetaCube[]): string | null {
  for (const cube of cubes) {
    const hasMeasure = (cube.measures ?? []).some((m) => m.name.endsWith('.step_count'));
    const hasStepIndex = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_index'));
    const hasStepName = (cube.dimensions ?? []).some((d) => d.name.endsWith('.step_name'));
    if (hasMeasure && hasStepIndex && hasStepName) return cube.name;
  }
  return null;
}

export type FunnelDetectionState =
  | { status: 'loading' }
  | { status: 'found'; cubeName: string }
  | { status: 'absent' }
  | { status: 'error'; message: string };

/** Module-level memo: metaVersion → detected cube name (null = absent) */
const detectionCache = new Map<string, string | null>();

export function useFunnelDetection(): FunnelDetectionState {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);

  // Use token as a proxy for "meta version" — changes whenever auth rotates.
  const metaVersion = currentToken ?? '';

  const [state, setState] = useState<FunnelDetectionState>({ status: 'loading' });
  const lastVersion = useRef<string | null>(null);

  // Sync hit — avoids loading flash when hook remounts with same token
  const cachedResult = useMemo(() => {
    if (detectionCache.has(metaVersion)) return detectionCache.get(metaVersion);
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaVersion]);

  useEffect(() => {
    if (!cubejsApi || !metaVersion) {
      setState({ status: 'loading' });
      return;
    }

    // Sync: already cached
    if (detectionCache.has(metaVersion)) {
      const cached = detectionCache.get(metaVersion) ?? null;
      setState(cached ? { status: 'found', cubeName: cached } : { status: 'absent' });
      return;
    }

    // Prevent re-fetch when re-rendered with same version before fetch resolves
    if (lastVersion.current === metaVersion) return;
    lastVersion.current = metaVersion;

    setState({ status: 'loading' });

    let cancelled = false;
    (async () => {
      try {
        const raw = await (cubejsApi as unknown as {
          meta(): Promise<{ cubes?: MetaCube[]; cubesMap?: Record<string, MetaCube> }>;
        }).meta();
        const cubes = metaToCubes(raw);
        const found = detectOrderedCube(cubes);
        detectionCache.set(metaVersion, found);
        if (!cancelled) {
          setState(found ? { status: 'found', cubeName: found } : { status: 'absent' });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: (err as Error).message });
        }
      }
    })();

    return () => { cancelled = true; };
  // cachedResult used only for sync path above; cubejsApi changes with token
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubejsApi, metaVersion]);

  // Sync fast-path when cache already populated
  if (cachedResult !== undefined) {
    const result = cachedResult ?? null;
    if (result) return { status: 'found', cubeName: result };
    return { status: 'absent' };
  }

  return state;
}
