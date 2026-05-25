/**
 * Cube query execution for Live KPI tiles.
 *
 * All functions accept `cubeHasGameDim` as a parameter — callers supply the
 * meta-driven predicate (see use-cube-has-game-dim.ts). No hardcoded cube
 * names here; game-dimension filtering is fully delegated to that predicate.
 */

import type { Query } from '@cubejs-client/core';
import { applyGameFilter } from '../../shared/game-scoping/apply-game-filter';
import type { KpiSpec } from './kpi-config';
import type { KpiTileData, RawRow, CubeApiLike } from './use-live-kpis-types';
import { formatValue, formatDelta, deltaTone, computeDelta } from './kpi-format';

export type { RawRow, CubeApiLike };

const SPARKLINE_DAYS = 14;

// ── Row parsing ────────────────────────────────────────────────────────────

export function extractTimeSeries(
  rows: RawRow[],
  measureKey: string,
  timeDimKey: string,
): Array<{ date: string; value: number }> {
  return rows
    .map((row) => {
      const rawDate = row[timeDimKey] ?? row[`${timeDimKey}.day`];
      const rawVal = row[measureKey];
      if (rawDate == null || rawVal == null) return null;
      const value = Number(rawVal);
      if (!isFinite(value)) return null;
      return { date: String(rawDate).slice(0, 10), value };
    })
    .filter((x): x is { date: string; value: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Query builder ──────────────────────────────────────────────────────────

function buildQuery(
  kpi: KpiSpec,
  measures: string[],
  gameId: string,
  cubeHasGameDim: (cube: string) => boolean,
): Query | null {
  const baseQuery: Query = {
    measures,
    timeDimensions: [
      {
        dimension: kpi.timeDim,
        granularity: 'day',
        dateRange: `last ${SPARKLINE_DAYS} days`,
      },
    ],
  };
  return applyGameFilter(baseQuery, gameId, cubeHasGameDim);
}

// ── Per-KPI fetchers ───────────────────────────────────────────────────────

async function fetchSimpleKpi(
  api: CubeApiLike,
  kpi: KpiSpec,
  gameId: string,
  cubeHasGameDim: (cube: string) => boolean,
): Promise<KpiTileData> {
  const measure = kpi.measure!;
  const query = buildQuery(kpi, [measure], gameId, cubeHasGameDim);
  if (!query) throw new Error('Failed to build query');

  const rs = await api.load(query as never);
  const rows = rs.rawData();
  const series = extractTimeSeries(rows, measure, `${kpi.timeDim}.day`);
  const values = series.map((s) => s.value);

  const latest = values[values.length - 1] ?? null;
  const delta = computeDelta(values, kpi.deltaWindow);

  return {
    id: kpi.id,
    label: kpi.label,
    value: latest != null ? formatValue(latest, kpi.format) : '—',
    delta: delta != null ? formatDelta(delta) : null,
    tone: delta != null ? deltaTone(delta, kpi.invertDelta) : 'neutral',
    sparkline: values,
    unavailable: false,
    error: null,
  };
}

async function fetchDerivedKpi(
  api: CubeApiLike,
  kpi: KpiSpec,
  gameId: string,
  cubeHasGameDim: (cube: string) => boolean,
): Promise<KpiTileData> {
  const { numerator, denominator } = kpi.derived!;

  // Numerator query (recharge cube — timeDim inferred from numerator cube name)
  const numCube = numerator.split('.')[0];
  const numTimeDim = `${numCube}.recharge_date`;
  const numQuery = buildQuery(
    { ...kpi, timeDim: numTimeDim },
    [numerator],
    gameId,
    cubeHasGameDim,
  );
  // Denominator query (active_daily cube)
  const denQuery = buildQuery(kpi, [denominator], gameId, cubeHasGameDim);

  if (!numQuery || !denQuery) throw new Error('Failed to build derived query');

  const [numRs, denRs] = await Promise.all([
    api.load(numQuery as never),
    api.load(denQuery as never),
  ]);

  const numSeries = extractTimeSeries(
    numRs.rawData(),
    numerator,
    `${numCube}.recharge_date.day`,
  );
  const denSeries = extractTimeSeries(denRs.rawData(), denominator, `${kpi.timeDim}.day`);

  // Merge by date — inner join on date key
  const denMap = new Map(denSeries.map((d) => [d.date, d.value]));
  const merged = numSeries
    .map((n) => {
      const den = denMap.get(n.date);
      if (den == null || den === 0) return null;
      return { date: n.date, value: n.value / den };
    })
    .filter((x): x is { date: string; value: number } => x !== null);

  const values = merged.map((m) => m.value);
  const latest = values[values.length - 1] ?? null;
  const delta = computeDelta(values, kpi.deltaWindow);

  return {
    id: kpi.id,
    label: kpi.label,
    value: latest != null ? formatValue(latest, kpi.format) : '—',
    delta: delta != null ? formatDelta(delta) : null,
    tone: delta != null ? deltaTone(delta, kpi.invertDelta) : 'neutral',
    sparkline: values,
    unavailable: false,
    error: null,
  };
}

export async function fetchKpi(
  api: CubeApiLike,
  kpi: KpiSpec,
  gameId: string,
  activeDailyAvailable: boolean,
  cubeHasGameDim: (cube: string) => boolean,
): Promise<KpiTileData> {
  const needsActiveDaily =
    kpi.measure?.startsWith('active_daily') ||
    kpi.derived?.denominator.startsWith('active_daily') ||
    kpi.derived?.numerator.startsWith('active_daily');

  if (needsActiveDaily && !activeDailyAvailable) {
    return {
      id: kpi.id,
      label: kpi.label,
      value: '—',
      delta: null,
      tone: 'neutral',
      sparkline: [],
      unavailable: true,
      unavailableReason: 'metric not defined for this game',
      error: null,
    };
  }

  try {
    if (kpi.derived) {
      return await fetchDerivedKpi(api, kpi, gameId, cubeHasGameDim);
    }
    return await fetchSimpleKpi(api, kpi, gameId, cubeHasGameDim);
  } catch (err) {
    return {
      id: kpi.id,
      label: kpi.label,
      value: '—',
      delta: null,
      tone: 'neutral',
      sparkline: [],
      unavailable: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
