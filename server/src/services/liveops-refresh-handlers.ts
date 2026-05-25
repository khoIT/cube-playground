/**
 * Per-resource refresh handlers for the liveops cache.
 *
 * Each handler is async, pure-ish (no DB writes — caller persists the
 * returned payload via liveops-cache-store), and bounded by a per-call
 * timeout to keep the cron tick predictable.
 *
 * Game scoping: Cube JWT carries the `game` claim, so no `applyGameFilter`
 * is needed server-side. Resolve token per game and the query routes to the
 * right yaml automatically.
 */

import { loadWithContinueWait } from './load-with-continue-wait.js';
import { resolveCubeTokenForGame } from './resolve-cube-token.js';
import { getMeta } from './cube-client.js';
import { KPI_CONFIG, type KpiSpec } from './liveops-kpi-config.js';
import type {
  KpiStripPayload,
  KpiStripTile,
  CohortGridPayload,
  CohortRowPayload,
  FunnelResultPayload,
  FunnelStepPayload,
} from './liveops-payload-types.js';

const SPARKLINE_DAYS = 14;

interface CubeMember { name: string }
interface MetaCube {
  name: string;
  measures?: CubeMember[];
  dimensions?: CubeMember[];
}
interface MetaShape {
  cubes?: MetaCube[];
  cubesMap?: Record<string, MetaCube>;
}

interface CubeLoadResult {
  data?: Array<Record<string, unknown>>;
  results?: Array<{ data?: Array<Record<string, unknown>> }>;
}

function rowsFrom(res: unknown): Array<Record<string, unknown>> {
  const r = res as CubeLoadResult;
  return r.data ?? r.results?.[0]?.data ?? [];
}

function extractSeries(
  rows: Array<Record<string, unknown>>,
  measureKey: string,
  timeDimDayKey: string,
): number[] {
  return rows
    .map((row) => {
      const rawDate = row[timeDimDayKey] ?? row[timeDimDayKey.replace('.day', '')];
      const rawVal = row[measureKey];
      if (rawDate == null || rawVal == null) return null;
      const value = Number(rawVal);
      if (!isFinite(value)) return null;
      return { date: String(rawDate).slice(0, 10), value };
    })
    .filter((x): x is { date: string; value: number } => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.value);
}

function computeDelta(values: number[], window: '1d' | '7d'): number | null {
  if (window === '1d') {
    if (values.length < 2) return null;
    const latest = values[values.length - 1];
    const prior = values[values.length - 2];
    if (prior === 0) return null;
    return (latest - prior) / prior;
  }
  if (values.length < 14) return null;
  const recent = values.slice(-7);
  const prior = values.slice(-14, -7);
  const avgRecent = recent.reduce((s, v) => s + v, 0) / recent.length;
  const avgPrior = prior.reduce((s, v) => s + v, 0) / prior.length;
  if (avgPrior === 0) return null;
  return (avgRecent - avgPrior) / avgPrior;
}

function findCubeNames(meta: MetaShape): Set<string> {
  const cubes = Array.isArray(meta.cubes)
    ? meta.cubes
    : Object.values(meta.cubesMap ?? {});
  return new Set(cubes.map((c) => c.name));
}

async function loadKpi(
  spec: KpiSpec,
  game: string,
  token: string | undefined,
  hasActiveDaily: boolean,
  timeoutMs: number,
): Promise<KpiStripTile> {
  const needsActiveDaily =
    spec.measure?.startsWith('active_daily') ||
    spec.derived?.numerator.startsWith('active_daily') ||
    spec.derived?.denominator.startsWith('active_daily');

  if (needsActiveDaily && !hasActiveDaily) {
    return {
      id: spec.id,
      label: spec.label,
      latest: null,
      delta: null,
      sparkline: [],
      format: spec.format,
      deltaWindow: spec.deltaWindow,
      invertDelta: spec.invertDelta,
      unavailable: true,
      unavailableReason: 'metric not defined for this game',
    };
  }

  try {
    if (spec.derived) {
      const numCube = spec.derived.numerator.split('.')[0];
      const denCube = spec.derived.denominator.split('.')[0];
      const numTimeDim = `${numCube}.recharge_date`;
      const denTimeDim = spec.timeDim;
      const numQuery = {
        measures: [spec.derived.numerator],
        timeDimensions: [{ dimension: numTimeDim, granularity: 'day', dateRange: `last ${SPARKLINE_DAYS} days` }],
      };
      const denQuery = {
        measures: [spec.derived.denominator],
        timeDimensions: [{ dimension: denTimeDim, granularity: 'day', dateRange: `last ${SPARKLINE_DAYS} days` }],
      };
      const [numRes, denRes] = await Promise.all([
        loadWithContinueWait(numQuery, token, timeoutMs),
        loadWithContinueWait(denQuery, token, timeoutMs),
      ]);
      const numRows = rowsFrom(numRes);
      const denRows = rowsFrom(denRes);
      const numSeriesPairs = numRows
        .map((r) => {
          const d = String(r[`${numTimeDim}.day`] ?? '').slice(0, 10);
          const v = Number(r[spec.derived!.numerator] ?? 0);
          return { date: d, value: v };
        })
        .filter((x) => x.date.length === 10)
        .sort((a, b) => a.date.localeCompare(b.date));
      const denMap = new Map(
        denRows.map((r) => {
          const d = String(r[`${denTimeDim}.day`] ?? '').slice(0, 10);
          const v = Number(r[spec.derived!.denominator] ?? 0);
          return [d, v];
        }),
      );
      const ratios = numSeriesPairs
        .map((n) => {
          const den = denMap.get(n.date);
          if (den == null || den === 0) return null;
          return n.value / den;
        })
        .filter((x): x is number => x !== null);
      const latest = ratios[ratios.length - 1] ?? null;
      return {
        id: spec.id, label: spec.label,
        latest, delta: computeDelta(ratios, spec.deltaWindow),
        sparkline: ratios, format: spec.format, deltaWindow: spec.deltaWindow,
        invertDelta: spec.invertDelta, unavailable: false,
      };
    }

    const query = {
      measures: [spec.measure!],
      timeDimensions: [{ dimension: spec.timeDim, granularity: 'day', dateRange: `last ${SPARKLINE_DAYS} days` }],
    };
    const res = await loadWithContinueWait(query, token, timeoutMs);
    const series = extractSeries(rowsFrom(res), spec.measure!, `${spec.timeDim}.day`);
    const latest = series[series.length - 1] ?? null;
    return {
      id: spec.id, label: spec.label,
      latest, delta: computeDelta(series, spec.deltaWindow),
      sparkline: series, format: spec.format, deltaWindow: spec.deltaWindow,
      invertDelta: spec.invertDelta, unavailable: false,
    };
  } catch (err) {
    return {
      id: spec.id, label: spec.label,
      latest: null, delta: null, sparkline: [],
      format: spec.format, deltaWindow: spec.deltaWindow, invertDelta: spec.invertDelta,
      unavailable: false, errorMsg: (err as Error).message,
    };
  }
}

export async function refreshKpiStrip(
  game: string,
  timeoutMs: number,
): Promise<KpiStripPayload> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const meta = (await getMeta(token)) as MetaShape;
  const cubeNames = findCubeNames(meta);
  const hasActiveDaily = cubeNames.has('active_daily');

  const tiles = await Promise.all(
    KPI_CONFIG.map((spec) => loadKpi(spec, game, token, hasActiveDaily, timeoutMs)),
  );
  return { game, tiles };
}

const RETENTION_REQUIRED_MEASURES = [
  'cohort_size', 'retained_d1', 'retained_d3', 'retained_d7', 'retained_d14', 'retained_d30',
];

function findRetentionCube(meta: MetaShape): string | null {
  const cubes = Array.isArray(meta.cubes) ? meta.cubes : Object.values(meta.cubesMap ?? {});
  for (const cube of cubes) {
    if (!/retention/i.test(cube.name)) continue;
    const measureNames = (cube.measures ?? []).map((m) => m.name.split('.').pop()!);
    const dimNames = (cube.dimensions ?? []).map((d) => d.name.split('.').pop()!);
    const hasMeasures = RETENTION_REQUIRED_MEASURES.every((m) => measureNames.includes(m));
    const hasDim = dimNames.includes('install_date');
    if (hasMeasures && hasDim) return cube.name;
  }
  return null;
}

function pct(n: number, size: number): number {
  return size > 0 ? Math.round((n / size) * 1000) / 10 : 0;
}

function addDays(d: string, n: number): string {
  const ms = Date.UTC(
    parseInt(d.slice(0, 4), 10),
    parseInt(d.slice(5, 7), 10) - 1,
    parseInt(d.slice(8, 10), 10),
  );
  return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
}

export async function refreshCohortGrid(
  game: string,
  windowDays: number,
  timeoutMs: number,
): Promise<CohortGridPayload> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const meta = (await getMeta(token)) as MetaShape;
  const retCube = findRetentionCube(meta);
  if (!retCube) {
    return { game, windowDays, dataPath: 'unavailable', rows: [] };
  }

  const query = {
    measures: RETENTION_REQUIRED_MEASURES.map((m) => `${retCube}.${m}`),
    timeDimensions: [
      {
        dimension: `${retCube}.install_date`,
        granularity: 'day',
        dateRange: `last ${windowDays} days`,
      },
    ],
  };
  const res = await loadWithContinueWait(query, token, timeoutMs);
  const rows = rowsFrom(res);
  const today = new Date().toISOString().slice(0, 10);

  const out: CohortRowPayload[] = rows
    .map((r) => {
      const installDate = String(r[`${retCube}.install_date.day`] ?? '').slice(0, 10);
      const size = Number(r[`${retCube}.cohort_size`] ?? 0);
      const d1  = Number(r[`${retCube}.retained_d1`]  ?? 0);
      const d3  = Number(r[`${retCube}.retained_d3`]  ?? 0);
      const d7  = Number(r[`${retCube}.retained_d7`]  ?? 0);
      const d14 = Number(r[`${retCube}.retained_d14`] ?? 0);
      const d30 = Number(r[`${retCube}.retained_d30`] ?? 0);
      return {
        installDate, size,
        d1, d3, d7, d14, d30,
        d1Pct: pct(d1, size), d3Pct: pct(d3, size), d7Pct: pct(d7, size),
        d14Pct: pct(d14, size), d30Pct: pct(d30, size),
        matureMask: [1, 3, 7, 14, 30].map((n) => addDays(installDate, n) <= today) as
          [boolean, boolean, boolean, boolean, boolean],
      };
    })
    .filter((r) => r.installDate.length === 10)
    .sort((a, b) => a.installDate.localeCompare(b.installDate));

  return { game, windowDays, dataPath: 'server', rows: out };
}

export interface FunnelDef {
  cubeName: string;
  orderedEvents: string[];
  windowMs: number;
  /** Optional cohort filter (Phase 4.3) — applied as user_id IN (...). */
  uidFilter?: string[];
}

function funnelStepDropOff(labels: string[], counts: number[]): FunnelStepPayload[] {
  return counts.map((count, idx) => {
    const prev = idx === 0 ? count : counts[idx - 1];
    const dropFromPrev = idx === 0 ? 0 : Math.max(0, prev - count);
    const dropPct = idx === 0 || prev === 0 ? 0 : (dropFromPrev / prev) * 100;
    return {
      name: labels[idx] ?? `Step ${idx + 1}`,
      count, dropFromPrev, dropPct,
    };
  });
}

export async function refreshFunnel(
  game: string,
  def: FunnelDef,
  defHash: string,
  timeoutMs: number,
): Promise<FunnelResultPayload> {
  const token = resolveCubeTokenForGame(game) ?? undefined;
  const { cubeName, orderedEvents, windowMs, uidFilter } = def;
  const stepCountMember = `${cubeName}.step_count`;
  const stepIndexDim = `${cubeName}.step_index`;
  const stepNameDim = `${cubeName}.step_name`;

  const to = new Date();
  const from = new Date(to.getTime() - windowMs);
  const filters: Array<{ member: string; operator: string; values: string[] }> = [
    { member: stepNameDim, operator: 'equals', values: orderedEvents },
  ];
  if (uidFilter && uidFilter.length > 0) {
    filters.push({ member: `${cubeName}.user_id`, operator: 'equals', values: uidFilter });
  }

  const query = {
    measures: [stepCountMember],
    dimensions: [stepIndexDim],
    filters,
    order: { [stepIndexDim]: 'asc' },
    timeDimensions: [
      { dimension: `${cubeName}.ts`, dateRange: [from.toISOString(), to.toISOString()] },
    ],
  };

  const res = await loadWithContinueWait(query, token, timeoutMs);
  const rows = rowsFrom(res);
  const indexToCount = new Map<number, number>();
  for (const row of rows) {
    const idx = Number(row[stepIndexDim]);
    const cnt = Number(row[stepCountMember] ?? 0);
    if (!Number.isNaN(idx)) indexToCount.set(idx, cnt);
  }
  const counts = orderedEvents.map((_, i) => indexToCount.get(i + 1) ?? 0);
  return {
    game,
    funnelDefHash: defHash,
    steps: funnelStepDropOff(orderedEvents, counts),
    badge: 'ordered',
  };
}
