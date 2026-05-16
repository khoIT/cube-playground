import { useEffect, useRef, useState } from 'react';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../hooks/use-new-metric-meta';
import type { Operation } from '../../types';

export type ColumnStats = {
  count: number | null;
  nullCount: number | null;
  nullPct: number | null;
  distinct: number | null;
  samples: string[];
  min: number | null;
  avg: number | null;
  max: number | null;
};

export type ColumnStatsResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: 'no-count-measure' | 'no-cube-api' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ColumnStats };

// Simple LRU cache capped at 50 entries.
const CACHE = new Map<string, ColumnStats>();
const CACHE_CAP = 50;

function cacheKey(cube: string, col: string, op: Operation): string {
  return `${cube}|${col}|${op}`;
}

function rememberInCache(key: string, value: ColumnStats): void {
  if (CACHE.has(key)) CACHE.delete(key);
  CACHE.set(key, value);
  while (CACHE.size > CACHE_CAP) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
}

function cubeHasCountMeasure(cube: WizardCube): boolean {
  return (cube.measures ?? []).some((m) => m.name === `${cube.name}.count`);
}

/**
 * Lazy per-column stats via Cube /load queries.
 *
 * Concurrency: `runIdRef` stale-token guard (Cube SDK 1.6.46 `load()` does NOT
 * accept AbortSignal — mirrors `use-live-preview.ts` pattern). In-flight
 * requests for prior columns complete but their `setState` is skipped.
 *
 * Cache: in-memory LRU 50, keyed `${cube}|${col}|${op}`.
 *
 * Gates on `<cube>.count` presence: when absent, returns `unavailable` without
 * firing any query (red-team finding #14).
 */
export function useColumnStats(
  cube: WizardCube | null,
  column: string | null,
  op: Operation,
  cubeApi: CubeApi | null
): ColumnStatsResult {
  const [result, setResult] = useState<ColumnStatsResult>({ status: 'idle' });
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!cube || !column) {
      setResult({ status: 'idle' });
      return;
    }
    if (!cubeApi) {
      setResult({ status: 'unavailable', reason: 'no-cube-api' });
      return;
    }
    if (!cubeHasCountMeasure(cube)) {
      setResult({ status: 'unavailable', reason: 'no-count-measure' });
      return;
    }

    const myRunId = ++runIdRef.current;
    const key = cacheKey(cube.name, column, op);
    const cached = CACHE.get(key);
    if (cached) {
      setResult({ status: 'ready', data: cached });
      return;
    }

    setResult({ status: 'loading' });

    (async () => {
      try {
        const countQ = { measures: [`${cube.name}.count`] };
        const nullQ = {
          measures: [`${cube.name}.count`],
          filters: [{ member: column, operator: 'notSet' as const }],
        };
        const distinctQ = { dimensions: [column], limit: 1000 };
        const sampleQ = { dimensions: [column], limit: 5 };

        const [countR, nullR, distinctR, sampleR] = await Promise.all([
          cubeApi.load(countQ as any),
          cubeApi.load(nullQ as any),
          cubeApi.load(distinctQ as any),
          cubeApi.load(sampleQ as any),
        ]);
        if (myRunId !== runIdRef.current) return; // stale — discard

        const count = Number(countR.rawData()[0]?.[`${cube.name}.count`] ?? 0);
        const nullCount = Number(nullR.rawData()[0]?.[`${cube.name}.count`] ?? 0);
        const distinct = distinctR.rawData().length;
        const samples = sampleR.rawData().map((r) => String(r[column] ?? '')).filter(Boolean);

        const data: ColumnStats = {
          count,
          nullCount,
          nullPct: count > 0 ? (nullCount / count) * 100 : null,
          distinct,
          samples,
          min: null,
          avg: null,
          max: null,
        };
        rememberInCache(key, data);
        setResult({ status: 'ready', data });
      } catch (err) {
        if (myRunId !== runIdRef.current) return;
        setResult({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [cube?.name, column, op, cubeApi]);

  return result;
}
