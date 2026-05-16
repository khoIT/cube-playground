import { useEffect, useRef, useState } from 'react';
import type { CubeApi } from '@cubejs-client/core';
import type { WizardCube } from '../../hooks/use-new-metric-meta';

export type CubeTimeRangeResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: 'no-time-dim' | 'no-cube-api' | 'view' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dimension: string; minDate: Date; maxDate: Date; spanDays: number };

const CACHE = new Map<string, { dimension: string; minDate: Date; maxDate: Date; spanDays: number }>();

// Pick the cube's "primary" time dimension. We prefer well-known event-time
// names (log_date, recharge_time, …) over attribute dates like install_date or
// first_login_date so the span reflects the cube's natural row-emission window.
const PREFERRED_TIME_NAMES = [
  'log_date',
  'recharge_time',
  'recharge_date',
  'event_time',
  'event_date',
  'date',
];

function resolveTimeDim(cube: WizardCube): string | null {
  const dims = (cube.dimensions ?? []).filter((d) => d.type === 'time' && d.public !== false);
  if (dims.length === 0) return null;
  for (const want of PREFERRED_TIME_NAMES) {
    const hit = dims.find((d) => d.name.split('.').slice(-1)[0] === want);
    if (hit) return hit.name;
  }
  return dims[0].name;
}

/**
 * Lazy "what date range does this cube cover?" via two cheap limit:1 queries
 * (asc + desc) against the primary time dimension. Lets the source card
 * surface the actual data window, so a 155.9K count visibly maps to "Apr 12 →
 * May 17, 2026 (35 days)" instead of looking like a misleading lifetime total.
 *
 * Concurrency: runIdRef stale-token guard (Cube SDK 1.6.46 `load()` does NOT
 * accept AbortSignal). Cache: in-memory, keyed by cube name (session lifetime).
 */
export function useCubeTimeRange(
  cube: WizardCube | null,
  cubeApi: CubeApi | null
): CubeTimeRangeResult {
  const [result, setResult] = useState<CubeTimeRangeResult>({ status: 'idle' });
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
    const dim = resolveTimeDim(cube);
    if (!dim) {
      setResult({ status: 'unavailable', reason: 'no-time-dim' });
      return;
    }

    const cached = CACHE.get(cube.name);
    if (cached) {
      setResult({ status: 'ready', ...cached });
      return;
    }

    const myRunId = ++runIdRef.current;
    setResult({ status: 'loading' });

    Promise.all([
      cubeApi.load({ dimensions: [dim], order: { [dim]: 'asc' }, limit: 1 } as any),
      cubeApi.load({ dimensions: [dim], order: { [dim]: 'desc' }, limit: 1 } as any),
    ])
      .then(([ascR, descR]) => {
        if (myRunId !== runIdRef.current) return;
        const minRaw = ascR.rawData()[0]?.[dim];
        const maxRaw = descR.rawData()[0]?.[dim];
        if (minRaw == null || maxRaw == null) {
          setResult({ status: 'unavailable', reason: 'no-time-dim' });
          return;
        }
        const minDate = new Date(String(minRaw));
        const maxDate = new Date(String(maxRaw));
        if (Number.isNaN(minDate.getTime()) || Number.isNaN(maxDate.getTime())) {
          setResult({ status: 'error', message: 'Time dim returned unparseable value' });
          return;
        }
        const spanDays = Math.max(
          0,
          Math.round((maxDate.getTime() - minDate.getTime()) / 86_400_000)
        );
        const ready = { dimension: dim, minDate, maxDate, spanDays };
        CACHE.set(cube.name, ready);
        setResult({ status: 'ready', ...ready });
      })
      .catch((err: unknown) => {
        if (myRunId !== runIdRef.current) return;
        setResult({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, [cube?.name, cube?.type, cubeApi]);

  return result;
}

const FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function formatTimeRange(minDate: Date, maxDate: Date, spanDays: number): string {
  return `${FMT.format(minDate)} — ${FMT.format(maxDate)} (${spanDays} day${spanDays === 1 ? '' : 's'})`;
}
