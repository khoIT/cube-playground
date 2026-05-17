import { useEffect, useMemo, useRef, useState } from 'react';
import { useLivePreview, LivePreviewStatus } from '../../../hooks/use-live-preview';
import { useQueryBuilderContext } from '../../../../context';

export type DimensionRow = {
  label: string;
  value: number;
  share: number;
};

export type DimensionResult = {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows: DimensionRow[];
  total: number;
  error: string | null;
};

type CtxLike = { apiUrl?: string | null; apiToken?: string | null };

interface UseTestRunArgs {
  cubeName: string | null;
  measureName: string;
  yamlPatch: string;
  timeDimension: string | null;
  range: '7d' | '30d';
  /** Qualified dimension name for the by-dimension breakdown, e.g. "mf_users.tier". */
  breakdownDimension: string | null;
  /** Bumped by the Re-run button to force a fresh fetch. */
  refreshKey: number;
}

/**
 * Composite hook for Step 6 (Test run).
 *
 * Wraps `useLivePreview` (which writes the YAML to disk and loads scalar +
 * time-series) and adds a second `/v1/load` for a grouped-by-dimension
 * breakdown. The breakdown query runs only after the live preview has
 * committed the measure to disk — otherwise Cube has nothing to query.
 *
 * Re-run is implemented as a bumped `refreshKey` that re-triggers the
 * breakdown effect; the underlying live preview re-debounces on its own
 * inputs.
 */
export function useTestRun(args: UseTestRunArgs) {
  const { cubeName, measureName, yamlPatch, timeDimension, range, breakdownDimension, refreshKey } = args;
  const ctx = useQueryBuilderContext() as unknown as CtxLike;

  const preview = useLivePreview({
    enabled: !!cubeName && !!measureName && !!yamlPatch,
    cubeName,
    measureName,
    yamlPatch,
    timeDimension,
    range,
  });

  const queryStartRef = useRef<number>(0);
  const [queryMs, setQueryMs] = useState<number | null>(null);

  // Capture round-trip duration as a proxy for "compile time". We measure it
  // around the preview's loading→success transition since useLivePreview does
  // not surface its own timing.
  useEffect(() => {
    if (preview.status === 'loading') {
      queryStartRef.current = Date.now();
    } else if (preview.status === 'success' && queryStartRef.current > 0) {
      setQueryMs(Date.now() - queryStartRef.current);
      queryStartRef.current = 0;
    }
  }, [preview.status]);

  const [dimension, setDimension] = useState<DimensionResult>({
    status: 'idle',
    rows: [],
    total: 0,
    error: null,
  });

  // Dimension breakdown — runs after live preview commits and the user has
  // chosen a breakdown dimension. Re-fires when `refreshKey` ticks.
  useEffect(() => {
    if (preview.status !== 'success' || !cubeName || !measureName || !breakdownDimension) {
      return;
    }
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
        const data = await runCubeLoad(ctx, query);
        if (aborted) return;
        const rows = data.map((row) => ({
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
  }, [preview.status, cubeName, measureName, breakdownDimension, timeDimension, range, refreshKey]);

  const stats = useMemo(
    () => ({
      scalar: preview.scalar,
      pointsReturned: preview.series?.length ?? 0,
      queryMs,
    }),
    [preview.scalar, preview.series, queryMs],
  );

  return {
    previewStatus: preview.status as LivePreviewStatus,
    previewError: preview.error,
    series: preview.series,
    lastWritten: preview.lastWritten,
    discard: preview.discard,
    stats,
    dimension,
  };
}

async function runCubeLoad(
  ctx: CtxLike,
  query: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.apiUrl || !ctx.apiToken) throw new Error('cube api not configured');
  const base = ctx.apiUrl.endsWith('/v1') ? ctx.apiUrl : `${ctx.apiUrl}/v1`;
  const resp = await fetch(`${base}/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ctx.apiToken },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = (await resp.json()) as { data?: Array<Record<string, unknown>> };
  return json.data ?? [];
}
