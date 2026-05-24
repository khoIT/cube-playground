/**
 * useMetricSparkline — fetches a 30-day daily time-series for a business
 * metric, used as the overview-tab sparkline.
 *
 * Behaviour:
 *   - `measure` formula  → query that single measure.
 *   - `ratio` formula    → query numerator + denominator in ONE Cube call,
 *     then compute `numerator / denominator` per bucket so the trend is
 *     genuinely the metric (e.g. ARPDAU), not just the numerator.
 *   - `expression` formula → query all `inputs[]` if present and surface
 *     the first as a proxy trend. (Arbitrary SQL cannot be evaluated
 *     client-side; we expose the leading input so the chart is at least
 *     a representative signal.)
 *   - Skips entirely when refs unresolved (disabled), no Cube client, or
 *     when no time dim can be picked from /meta.
 *   - Caches results for 5 min keyed by (metricId, gameId, measures, timeDim).
 *
 * The hook also returns the human label used in the caption — for a ratio
 * this is the metric label (e.g. "ARPDAU"), not the leading measure FQN,
 * which would have been misleading.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CubeApi } from '@cubejs-client/core';

import { useAppContext } from '../../../hooks';
import { useCubejsApi } from '../../../hooks/cubejs-api';
import { useSecurityContext } from '../../../hooks/security-context';
import { useActiveGameId } from '../../../components/Header/use-game-context';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import type { CatalogCube } from '../use-catalog-meta';
import { timeDimensionFor } from './explore-query-builder';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SparklinePoint {
  x: string;
  y: number;
}

export type SparklineStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface SparklineResult {
  status: SparklineStatus;
  points: SparklinePoint[];
  error: string | null;
  /** Aggregate (sum) over the window — meaningful for additive measures only. */
  summary: number | null;
  /** Percent change first non-zero vs last bucket. */
  deltaPct: number | null;
  /** Human caption for the series — metric label for ratios, FQN for measures. */
  seriesLabel: string;
}

interface CacheEntry {
  fetchedAt: number;
  data: SparklineResult;
}

const cache = new Map<string, CacheEntry>();

interface SeriesPlan {
  measures: string[];
  /** Compute the y value for a single Cube row. */
  compute: (row: Record<string, unknown>) => number;
  seriesLabel: string;
}

function planSeries(metric: BusinessMetric): SeriesPlan | null {
  const f = metric.formula;
  if (f.type === 'measure') {
    return {
      measures: [f.ref],
      compute: (row) => Number(row[f.ref] ?? 0),
      seriesLabel: f.ref,
    };
  }
  if (f.type === 'ratio') {
    return {
      measures: [f.numerator, f.denominator],
      compute: (row) => {
        const n = Number(row[f.numerator] ?? 0);
        const d = Number(row[f.denominator] ?? 0);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
        return n / d;
      },
      seriesLabel: metric.label,
    };
  }
  if (f.type === 'expression') {
    const inputs = f.inputs ?? [];
    if (inputs.length === 0) return null;
    return {
      measures: inputs,
      compute: (row) => Number(row[inputs[0]] ?? 0),
      seriesLabel: `${metric.label} (proxy: ${inputs[0]})`,
    };
  }
  return null;
}

function deriveSummary(points: SparklinePoint[]): { summary: number | null; deltaPct: number | null } {
  if (points.length === 0) return { summary: null, deltaPct: null };
  const sum = points.reduce((acc, p) => acc + (Number.isFinite(p.y) ? p.y : 0), 0);
  const first = points.find((p) => Number.isFinite(p.y) && p.y !== 0)?.y ?? points[0]?.y ?? 0;
  const last = points[points.length - 1]?.y ?? 0;
  const deltaPct = first !== 0 && Number.isFinite(first) ? ((last - first) / Math.abs(first)) * 100 : null;
  return { summary: sum, deltaPct };
}

interface Args {
  metric: BusinessMetric;
  cubes: CatalogCube[];
  disabled?: boolean;
}

export function useMetricSparkline({ metric, cubes, disabled = false }: Args): SparklineResult {
  const { apiUrl } = useAppContext();
  const { currentToken } = useSecurityContext();
  const cubejsApi = useCubejsApi(apiUrl ?? null, currentToken ?? null);
  const gameId = useActiveGameId();

  const plan = useMemo(() => planSeries(metric), [metric]);
  const timeDim = useMemo(() => timeDimensionFor(metric, cubes), [metric, cubes]);

  const [result, setResult] = useState<SparklineResult>({
    status: 'idle',
    points: [],
    error: null,
    summary: null,
    deltaPct: null,
    seriesLabel: plan?.seriesLabel ?? metric.label,
  });

  useEffect(() => {
    if (disabled || !plan || !timeDim || !cubejsApi) {
      setResult({
        status: 'idle',
        points: [],
        error: null,
        summary: null,
        deltaPct: null,
        seriesLabel: plan?.seriesLabel ?? metric.label,
      });
      return;
    }

    const cacheKey = `${gameId}::${metric.id}::${plan.measures.join(',')}::${timeDim}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setResult(cached.data);
      return;
    }

    let cancelled = false;
    setResult((prev) => ({ ...prev, status: 'loading', error: null }));

    void runSparklineQuery(cubejsApi, plan, timeDim)
      .then((points) => {
        if (cancelled) return;
        const { summary, deltaPct } = deriveSummary(points);
        const next: SparklineResult = {
          status: points.length === 0 ? 'empty' : 'success',
          points,
          error: null,
          summary,
          deltaPct,
          seriesLabel: plan.seriesLabel,
        };
        cache.set(cacheKey, { fetchedAt: Date.now(), data: next });
        setResult(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          status: 'error',
          points: [],
          error: err instanceof Error ? err.message : String(err),
          summary: null,
          deltaPct: null,
          seriesLabel: plan.seriesLabel,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cubejsApi, gameId, metric.id, metric.label, plan, timeDim, disabled]);

  return result;
}

async function runSparklineQuery(
  api: CubeApi,
  plan: SeriesPlan,
  timeDim: string,
): Promise<SparklinePoint[]> {
  const query = {
    measures: plan.measures,
    timeDimensions: [
      {
        dimension: timeDim,
        granularity: 'day',
        dateRange: 'last 30 days',
      },
    ],
    order: { [timeDim]: 'asc' },
  };
  const result = await api.load(query as never);
  const raw = (result as unknown as { rawData: () => Array<Record<string, unknown>> }).rawData();
  const measureSet = new Set(plan.measures);

  return raw.map((row) => {
    const dateKey =
      Object.keys(row).find(
        (k) => !measureSet.has(k) && (k.toLowerCase().includes('date') || k.toLowerCase().includes('time')),
      ) ?? null;
    return {
      x: dateKey ? String(row[dateKey] ?? '') : '',
      y: plan.compute(row),
    };
  });
}

/** Test-only — clear in-memory cache between tests. */
export function __resetMetricSparklineCache(): void {
  cache.clear();
}
