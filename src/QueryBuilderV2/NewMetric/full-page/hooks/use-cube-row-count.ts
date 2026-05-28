import { useEffect, useRef, useState } from 'react';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../hooks/use-new-metric-meta';
import { onWorkspaceChange } from '../../../../shared/workspace-cache-bus';

export type CubeRowCountResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: 'no-count-measure' | 'no-cube-api' | 'view' }
  | { status: 'error'; message: string }
  | { status: 'ready'; count: number };

const CACHE = new Map<string, number>();

// Row counts depend on the live Cube backend — invalidate on workspace switch.
onWorkspaceChange(() => CACHE.clear());

function cubeCountMeasure(cube: WizardCube): string | null {
  const ms = cube.measures ?? [];
  // Prefer the canonical <cube>.count if it exists; otherwise fall back to any
  // measure with aggType: 'count'. Cubes in this project commonly name their
  // primary count measure something domain-specific (e.g. `user_count`).
  return (
    ms.find((m) => m.name === `${cube.name}.count`)?.name ??
    ms.find((m) => m.aggType === 'count')?.name ??
    null
  );
}

/**
 * Lazy row-count for a single cube via Cube /load.
 * Views are skipped (row count is ill-defined for projections).
 * Cached in-memory keyed by cube name (lifetime: page session).
 */
export function useCubeRowCount(
  cube: WizardCube | null,
  cubeApi: CubeApi | null
): CubeRowCountResult {
  const [result, setResult] = useState<CubeRowCountResult>({ status: 'idle' });
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!cube) {
      setResult({ status: 'idle' });
      return;
    }
    if (cube.type === 'view') {
      setResult({ status: 'unavailable', reason: 'view' });
      return;
    }
    if (!cubeApi) {
      setResult({ status: 'unavailable', reason: 'no-cube-api' });
      return;
    }
    const measure = cubeCountMeasure(cube);
    if (!measure) {
      setResult({ status: 'unavailable', reason: 'no-count-measure' });
      return;
    }

    const cached = CACHE.get(cube.name);
    if (cached !== undefined) {
      setResult({ status: 'ready', count: cached });
      return;
    }

    const myRunId = ++runIdRef.current;
    setResult({ status: 'loading' });

    cubeApi
      .load({ measures: [measure] } as any)
      .then((r) => {
        if (myRunId !== runIdRef.current) return;
        const n = Number(r.rawData()[0]?.[measure] ?? 0);
        CACHE.set(cube.name, n);
        setResult({ status: 'ready', count: n });
      })
      .catch((err: unknown) => {
        if (myRunId !== runIdRef.current) return;
        setResult({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, [cube?.name, cube?.type, cubeApi]);

  return result;
}

export function formatRowCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
