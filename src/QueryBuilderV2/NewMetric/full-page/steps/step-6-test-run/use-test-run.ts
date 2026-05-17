import { useEffect, useMemo, useRef, useState } from 'react';
import type { CubeApi } from '@cubejs-client/core';
import { postSchemaWrite, deleteSchemaWrite } from '../../../api';

const DEBOUNCE_MS = 500;

export type TestRunStatus =
  | 'idle'
  | 'discarding-prior'
  | 'writing'
  | 'loading'
  | 'success'
  | 'error';

export type DimensionRow = { label: string; value: number; share: number };
export type DimensionResult = {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows: DimensionRow[];
  total: number;
  error: string | null;
};

interface UseTestRunArgs {
  cubejsApi: CubeApi | null;
  cubeName: string | null;
  measureName: string;
  yamlPatch: string;
  timeDimension: string | null;
  range: '7d' | '30d';
  breakdownDimension: string | null;
  /** Bumped by the Re-run button to force a fresh fetch. */
  refreshKey: number;
}

/**
 * Step 6 (Test run) orchestrator hook. Owns the write-then-preview lifecycle
 * for the full-page wizard, which is mounted OUTSIDE `QueryBuilderProvider`
 * and therefore cannot use `useLivePreview` (that hook reads the QueryBuilder
 * context). Uses the wizard's own `cubejsApi` instance built by
 * `useNewMetricMeta` from `useAppContext`.
 *
 * Sequence on input change (debounced 500ms):
 *   1. If a prior measure was committed under a different identity → DELETE
 *      to restore the `.bak`.
 *   2. POST the new YAML fragment to `/api/playground/schema/write`.
 *   3. Run `cubejsApi.load({ measures, timeDimensions? })` to populate
 *      scalar + series.
 *   4. If a breakdown dimension is set, run a second `cubejsApi.load` with
 *      a `dimensions` clause for the by-dimension table.
 */
export function useTestRun(args: UseTestRunArgs) {
  const {
    cubejsApi,
    cubeName,
    measureName,
    yamlPatch,
    timeDimension,
    range,
    breakdownDimension,
    refreshKey,
  } = args;

  const [status, setStatus] = useState<TestRunStatus>('idle');
  const [scalar, setScalar] = useState<number | null>(null);
  const [series, setSeries] = useState<Array<{ x: string; y: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryMs, setQueryMs] = useState<number | null>(null);

  const lastWrittenRef = useRef<{ cubeName: string; measureName: string } | null>(null);
  const runIdRef = useRef(0);

  async function discard(): Promise<{ ok: boolean; reason?: string }> {
    const prior = lastWrittenRef.current;
    if (!prior) return { ok: true };
    const result = await deleteSchemaWrite(prior);
    if (result.ok) {
      lastWrittenRef.current = null;
      setStatus('idle');
      setScalar(null);
      setSeries(null);
      setError(null);
      return { ok: true };
    }
    return { ok: false, reason: (result as { reason?: string }).reason };
  }

  // Main lifecycle: write → load scalar + series.
  useEffect(() => {
    if (!cubejsApi || !cubeName || !measureName || !yamlPatch) return;

    const myRunId = ++runIdRef.current;
    const timer = setTimeout(() => void run(), DEBOUNCE_MS);

    async function run() {
      if (myRunId !== runIdRef.current) return;
      const prior = lastWrittenRef.current;
      const incoming = { cubeName: cubeName as string, measureName };
      const identityChanged =
        prior && (prior.cubeName !== incoming.cubeName || prior.measureName !== incoming.measureName);

      if (identityChanged) {
        setStatus('discarding-prior');
        const deleted = await deleteSchemaWrite(prior);
        if (myRunId !== runIdRef.current) return;
        const dStatus = (deleted as { status?: number }).status;
        if (!deleted.ok && dStatus !== 404) {
          setStatus('error');
          setError(`Discard failed: ${(deleted as { reason?: string }).reason}`);
          return;
        }
        lastWrittenRef.current = null;
      }

      setStatus('writing');
      setError(null);
      const writeResult = await postSchemaWrite({
        cubeName: incoming.cubeName,
        measureName: incoming.measureName,
        yamlPatch,
      });
      if (myRunId !== runIdRef.current) return;
      if (!writeResult.ok) {
        setStatus('error');
        const reason = (writeResult as { reason?: string }).reason ?? 'write failed';
        setError(`Schema write failed: ${reason}`);
        return;
      }
      lastWrittenRef.current = incoming;

      setStatus('loading');
      const qualified = `${incoming.cubeName}.${incoming.measureName}`;
      const query: Record<string, unknown> = { measures: [qualified] };
      if (timeDimension) {
        query.timeDimensions = [
          {
            dimension: timeDimension,
            granularity: 'day',
            dateRange: range === '7d' ? 'last 7 days' : 'last 30 days',
          },
        ];
      }

      try {
        const started = Date.now();
        const result = await cubejsApi!.load(query as never);
        if (myRunId !== runIdRef.current) return;
        setQueryMs(Date.now() - started);
        const data = result.rawData();

        if (timeDimension) {
          const rows = data.map((row: Record<string, unknown>) => ({
            x: pickDateKey(row, qualified) ?? '',
            y: Number(row[qualified] ?? 0),
          }));
          setSeries(rows);
          setScalar(rows.reduce((acc, r) => acc + (Number.isFinite(r.y) ? r.y : 0), 0));
        } else {
          setSeries(null);
          setScalar(data[0] ? Number(data[0][qualified] ?? 0) : 0);
        }
        setStatus('success');
      } catch (err) {
        if (myRunId !== runIdRef.current) return;
        setStatus('error');
        setError(`Preview load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cubejsApi, cubeName, measureName, yamlPatch, timeDimension, range, refreshKey]);

  // Dimension breakdown — runs only after main load succeeded.
  const [dimension, setDimension] = useState<DimensionResult>({
    status: 'idle',
    rows: [],
    total: 0,
    error: null,
  });

  useEffect(() => {
    if (status !== 'success' || !cubejsApi || !cubeName || !measureName || !breakdownDimension) return;
    let aborted = false;
    setDimension((s) => ({ ...s, status: 'loading', error: null }));

    const qualified = `${cubeName}.${measureName}`;
    const query: Record<string, unknown> = {
      measures: [qualified],
      dimensions: [breakdownDimension],
      order: { [qualified]: 'desc' },
      limit: 25,
    };
    if (timeDimension) {
      query.timeDimensions = [
        {
          dimension: timeDimension,
          dateRange: range === '7d' ? 'last 7 days' : 'last 30 days',
        },
      ];
    }

    (async () => {
      try {
        const result = await cubejsApi.load(query as never);
        if (aborted) return;
        const data = result.rawData();
        const rows = data.map((row: Record<string, unknown>) => ({
          label: String(row[breakdownDimension] ?? '—'),
          value: Number(row[qualified] ?? 0),
        }));
        const total = rows.reduce((acc, r) => acc + (Number.isFinite(r.value) ? r.value : 0), 0);
        setDimension({
          status: 'success',
          rows: rows.map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 })),
          total,
          error: null,
        });
      } catch (err) {
        if (aborted) return;
        setDimension({
          status: 'error',
          rows: [],
          total: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cubejsApi, cubeName, measureName, breakdownDimension, timeDimension, range, refreshKey]);

  const stats = useMemo(
    () => ({ scalar, pointsReturned: series?.length ?? 0, queryMs }),
    [scalar, series, queryMs],
  );

  return {
    previewStatus: status,
    previewError: error,
    series,
    lastWritten: lastWrittenRef.current,
    discard,
    stats,
    dimension,
  };
}

function pickDateKey(row: Record<string, unknown>, qualifiedMeasure: string): string | null {
  for (const key of Object.keys(row)) {
    if (key === qualifiedMeasure) continue;
    if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
      const v = row[key];
      return v == null ? null : String(v);
    }
  }
  for (const key of Object.keys(row)) {
    if (key !== qualifiedMeasure) return String(row[key]);
  }
  return null;
}
