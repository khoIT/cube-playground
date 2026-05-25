/**
 * useCohortGrid — data hook for the cohort retention grid.
 *
 * Dual-path implementation:
 *
 * PATH A (server-side): If Cube /meta exposes a cube with measures
 *   `cohort_size`, `retained_d1`…`retained_d30` and dimension `install_date`,
 *   a single aggregated query is issued. Header badge → "Server-side retention".
 *
 * PATH B (client-side, default): Queries active_daily for user_id + log_date
 *   over a window, then pivots client-side via pivotCohortRows(). Cap = 28 days
 *   to keep payload manageable. Header badge → "Client-side compute (≤28d only)".
 *
 * Detection: on every cubejsApi change (new token / game switch), probe /meta
 * for the server-side contract. Result is cached for the lifetime of the api
 * instance so repeated renders don't re-probe.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '../../../hooks';
import { useSecurityContext } from '../../../hooks/security-context';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useCubeTokenBootstrap } from '../../../hooks/use-cube-token-bootstrap';
import { pivotCohortRows } from './pivot-cohort-rows';
import type { CohortRow, RawCohortRow } from './pivot-cohort-rows';

// ── Types ────────────────────────────────────────────────────────────────────

export type CohortWindow = 7 | 14 | 28;

export type DataPath = 'server' | 'client' | 'detecting';

export interface UseCohortGridResult {
  rows: CohortRow[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  /** Which data path is active — drives the header badge. */
  dataPath: DataPath;
}

// ── Server-side detection contract ──────────────────────────────────────────

interface CubeMeasure { name: string }
interface CubeDimension { name: string }
interface MetaCube {
  name: string;
  measures?: CubeMeasure[];
  dimensions?: CubeDimension[];
}

const SERVER_REQUIRED_MEASURES = [
  'cohort_size', 'retained_d1', 'retained_d3', 'retained_d7', 'retained_d14', 'retained_d30',
];
const SERVER_REQUIRED_DIM = 'install_date';

/**
 * Returns the retention cube name if the server-side contract is satisfied,
 * otherwise null (triggers client-side path).
 */
async function detectRetentionCube(
  api: { meta(): Promise<{ cubes?: MetaCube[]; cubesMap?: Record<string, MetaCube> }> },
): Promise<string | null> {
  try {
    const meta = await api.meta();
    const cubes: MetaCube[] =
      meta.cubes ?? (Object.values(meta.cubesMap ?? {}) as MetaCube[]);

    for (const cube of cubes) {
      if (!/retention/i.test(cube.name)) continue;
      const measureNames = (cube.measures ?? []).map((m) => m.name.split('.').pop()!);
      const dimNames     = (cube.dimensions ?? []).map((d) => d.name.split('.').pop()!);
      const hasMeasures  = SERVER_REQUIRED_MEASURES.every((m) => measureNames.includes(m));
      const hasDim       = dimNames.includes(SERVER_REQUIRED_DIM);
      if (hasMeasures && hasDim) return cube.name;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Client-side path B query ─────────────────────────────────────────────────

const MAX_CLIENT_WINDOW: CohortWindow = 28;
// Extra days appended to the date range so D30 retention can be measured for
// cohorts within the requested window.
const D30_LOOKBACK_BUFFER = 30;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCohortGrid(
  gameId: string,
  cohortWindow: CohortWindow,
): UseCohortGridResult {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);
  const { tokenGame } = useCubeTokenBootstrap();

  const [rows, setRows]       = useState<CohortRow[]>([]);
  const [status, setStatus]   = useState<UseCohortGridResult['status']>('idle');
  const [error, setError]     = useState<string | null>(null);
  const [dataPath, setDataPath] = useState<DataPath>('detecting');

  // Cache detection result per api instance to avoid repeated /meta calls.
  const retentionCubeRef = useRef<string | null | undefined>(undefined);

  // Track the latest effective window — capped at MAX_CLIENT_WINDOW for client path.
  const effectiveWindow = Math.min(cohortWindow, MAX_CLIENT_WINDOW) as CohortWindow;

  const runQuery = useCallback(
    async (signal: AbortSignal) => {
      if (!cubejsApi) return;
      if (tokenGame !== gameId) return;

      setStatus('loading');
      setError(null);

      try {
        // Detection: probe meta once per api instance.
        if (retentionCubeRef.current === undefined) {
          setDataPath('detecting');
          retentionCubeRef.current = await detectRetentionCube(
            // CubeApi's meta() signature differs from our minimal interface; cast
            // through unknown to satisfy the structural check without a broad any.
            cubejsApi as unknown as Parameters<typeof detectRetentionCube>[0],
          );
        }
        if (signal.aborted) return;

        const retCube = retentionCubeRef.current;

        if (retCube) {
          // ── PATH A: server-side single query ──────────────────────────────
          setDataPath('server');
          const result = await (cubejsApi as any).load({
            measures: SERVER_REQUIRED_MEASURES.map((m) => `${retCube}.${m}`),
            timeDimensions: [{
              dimension: `${retCube}.install_date`,
              granularity: 'day',
              dateRange: `last ${effectiveWindow} days`,
            }],
          });
          if (signal.aborted) return;

          const raw = result.rawData() as Record<string, unknown>[];
          // Reshape server rows into CohortRow[] directly (no client pivot needed).
          const serverRows: CohortRow[] = raw.map((row) => {
            const installDate = String(row[`${retCube}.install_date.day`] ?? '').slice(0, 10);
            const size = Number(row[`${retCube}.cohort_size`] ?? 0);
            const d1   = Number(row[`${retCube}.retained_d1`]  ?? 0);
            const d3   = Number(row[`${retCube}.retained_d3`]  ?? 0);
            const d7   = Number(row[`${retCube}.retained_d7`]  ?? 0);
            const d14  = Number(row[`${retCube}.retained_d14`] ?? 0);
            const d30  = Number(row[`${retCube}.retained_d30`] ?? 0);
            const pct  = (n: number) => size > 0 ? Math.round(n / size * 1000) / 10 : 0;
            const today = new Date().toISOString().slice(0, 10);
            const addDays = (d: string, n: number) => {
              const ms = Date.UTC(
                parseInt(d.slice(0,4),10),
                parseInt(d.slice(5,7),10)-1,
                parseInt(d.slice(8,10),10),
              );
              return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
            };
            return {
              installDate,
              size,
              d1, d3, d7, d14, d30,
              d1Pct: pct(d1), d3Pct: pct(d3), d7Pct: pct(d7),
              d14Pct: pct(d14), d30Pct: pct(d30),
              matureMask: [1,3,7,14,30].map((n) => addDays(installDate, n) <= today) as [boolean,boolean,boolean,boolean,boolean],
            };
          });
          setRows(serverRows.sort((a, b) => a.installDate.localeCompare(b.installDate)));

        } else {
          // ── PATH B: client-side pivot from active_daily ───────────────────
          setDataPath('client');
          const totalDays = effectiveWindow + D30_LOOKBACK_BUFFER;
          const result = await (cubejsApi as any).load({
            measures: [],
            dimensions: ['active_daily.user_id'],
            timeDimensions: [{
              dimension: 'active_daily.log_date',
              granularity: 'day',
              dateRange: `last ${totalDays} days`,
            }],
            // Limit guard: server returns at most 50k rows; if > this, data is
            // truncated and the grid will show lower-bound estimates.
            limit: 50_000,
          });
          if (signal.aborted) return;

          const rawRows = result.rawData() as RawCohortRow[];
          const pivoted = pivotCohortRows(rawRows);

          // Only expose cohorts within the requested window (drop older ones
          // that were fetched only to compute D30 for in-window cohorts).
          const cutoff = (() => {
            const ms = Date.now() - effectiveWindow * 86_400_000;
            return new Date(ms).toISOString().slice(0, 10);
          })();
          setRows(pivoted.filter((r) => r.installDate >= cutoff));
        }

        setStatus('success');
      } catch (err: unknown) {
        if (signal.aborted) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    // cubejsApi instance identity changes on token/game switch → re-detect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cubejsApi, tokenGame, gameId, effectiveWindow],
  );

  // Reset detection cache when the api instance changes.
  useEffect(() => {
    retentionCubeRef.current = undefined;
  }, [cubejsApi]);

  useEffect(() => {
    if (!cubejsApi) return;
    setRows([]);
    setStatus('idle');
    const controller = new AbortController();
    runQuery(controller.signal);
    return () => controller.abort();
  }, [cubejsApi, gameId, effectiveWindow, runQuery]);

  return { rows, status, error, dataPath };
}
