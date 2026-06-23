/**
 * Delta decomposition — descriptive attribution of "why did a KPI move?".
 *
 * Given a measure, a decompose-by dimension, and two periods, this queries the
 * measure for both windows grouped by the dimension, and reports each value's
 * contribution to the headline swing (Δ and % of total swing) plus a residual.
 *
 * This is ATTRIBUTION, not forecasting — no model. The headline Δ is always the
 * ungrouped period-over-period change; the per-segment pieces explain it.
 *
 * Additivity matters: only additive measures (sum / count) have grouped pieces
 * that sum back to the ungrouped total. Ratios (avg / number) and distinct
 * counts (countDistinctApprox) do NOT — for those the per-segment numbers are
 * "level changes by segment", flagged `additive: false`, and the residual is not
 * a meaningful "unexplained" quantity. Decided per measure from /meta here.
 */
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { loadCubeRows } from './load-cube-rows.js';
import type { ToolContext } from '../types.js';
import type Database from 'better-sqlite3';

export interface DeltaDecomposeInput {
  gameId: string;
  workspace: string;
  measure: string;
  dimension: string;
  timeDimension: string;
  periodA: [string, string];
  periodB: [string, string];
  filters?: Array<{ member: string; operator: string; values?: string[] }>;
  topN?: number;
}

export interface DeltaContributor {
  value: string;
  a: number;
  b: number;
  delta: number;
  /** Share of the headline swing this segment accounts for (additive only). */
  pctOfSwing: number | null;
  /** True for the rolled-up "Other" bucket of low-rank segments. */
  isOther?: boolean;
}

export interface DeltaDecomposeResult {
  measure: string;
  dimension: string;
  additive: boolean;
  measureType: string;
  totalA: number;
  totalB: number;
  headlineDelta: number;
  headlinePct: number | null;
  contributors: DeltaContributor[];
  /** headlineDelta − Σ contributor deltas. ~0 for additive; informational otherwise. */
  residual: number;
  bucketedCount: number;
  /** True when a window returned the row cap — tail segments fold into residual
   *  rather than "Other", so residual may be larger than the bucketed tail alone. */
  truncated: boolean;
  note: string;
}

const DEFAULT_TOP_N = 12;
const MAX_GROUP_ROWS = 1000;
/** Agg types whose per-partition pieces sum back to the ungrouped total. */
const ADDITIVE_TYPES = new Set(['sum', 'count']);

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Look up a measure's agg type from /meta (e.g. 'sum', 'countDistinctApprox'). */
async function measureType(gameId: string, workspace: string, measure: string): Promise<string> {
  const meta = await cubeMetaCache.getMeta(gameId, workspace).catch(() => null);
  if (!meta?.cubes) return 'number';
  for (const cube of meta.cubes) {
    for (const m of cube.measures ?? []) {
      if (m.name === measure) return String(m.type ?? 'number');
    }
  }
  return 'number';
}

export async function decomposeDelta(
  input: DeltaDecomposeInput,
  db?: Database.Database,
): Promise<DeltaDecomposeResult> {
  const { gameId, workspace, measure, dimension, timeDimension, periodA, periodB } = input;
  const topN = Math.min(Math.max(input.topN ?? DEFAULT_TOP_N, 1), 50);
  const filters = input.filters ?? [];

  const ctx: ToolContext = {
    ownerId: 'liveops',
    gameId,
    cubeToken: '',
    workspace,
    sessionId: 'liveops:delta',
    turnId: 'liveops:delta',
    // The decomposition service never streams; a no-op emitter satisfies the type.
    sseEmitter: { emit: () => false } as unknown as ToolContext['sseEmitter'],
    db,
  };

  const groupedQuery = (range: [string, string]) => ({
    measures: [measure],
    dimensions: [dimension],
    timeDimensions: [{ dimension: timeDimension, dateRange: range }],
    filters,
    order: { [measure]: 'desc' as const },
    limit: MAX_GROUP_ROWS,
  });
  const totalQuery = (range: [string, string]) => ({
    measures: [measure],
    timeDimensions: [{ dimension: timeDimension, dateRange: range }],
    filters,
  });

  // Explicit pinned ranges → never snap to a different window.
  const opts = { maxRows: MAX_GROUP_ROWS, snapOnEmpty: false };
  const [groupedA, groupedB, totalsA, totalsB, mType] = await Promise.all([
    loadCubeRows(groupedQuery(periodA), ctx, opts),
    loadCubeRows(groupedQuery(periodB), ctx, opts),
    loadCubeRows(totalQuery(periodA), ctx, { maxRows: 1, snapOnEmpty: false }),
    loadCubeRows(totalQuery(periodB), ctx, { maxRows: 1, snapOnEmpty: false }),
    measureType(gameId, workspace, measure),
  ]);

  const additive = ADDITIVE_TYPES.has(mType);

  const aByVal = new Map<string, number>();
  const bByVal = new Map<string, number>();
  for (const r of groupedA) aByVal.set(String(r[dimension] ?? '∅'), toNum(r[measure]));
  for (const r of groupedB) bByVal.set(String(r[dimension] ?? '∅'), toNum(r[measure]));

  const totalA = toNum(totalsA[0]?.[measure]);
  const totalB = toNum(totalsB[0]?.[measure]);
  const headlineDelta = totalB - totalA;

  // Union of dimension values across both windows; a value absent in one period
  // contributes its full level as the swing (new/dropped segment).
  const allValues = new Set<string>([...aByVal.keys(), ...bByVal.keys()]);
  const rows: DeltaContributor[] = [...allValues].map((value) => {
    const a = aByVal.get(value) ?? 0;
    const b = bByVal.get(value) ?? 0;
    const delta = b - a;
    return {
      value,
      a,
      b,
      delta,
      pctOfSwing: additive && headlineDelta !== 0 ? delta / headlineDelta : null,
    };
  });

  // Rank by absolute swing; the biggest movers (either direction) lead.
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const head = rows.slice(0, topN);
  const tail = rows.slice(topN);
  const contributors = [...head];
  if (tail.length > 0) {
    const a = tail.reduce((s, r) => s + r.a, 0);
    const b = tail.reduce((s, r) => s + r.b, 0);
    const delta = b - a;
    contributors.push({
      value: `Other (${tail.length})`,
      a,
      b,
      delta,
      pctOfSwing: additive && headlineDelta !== 0 ? delta / headlineDelta : null,
      isOther: true,
    });
  }

  const sumDeltas = contributors.reduce((s, r) => s + r.delta, 0);
  const residual = headlineDelta - sumDeltas;
  const truncated = groupedA.length >= MAX_GROUP_ROWS || groupedB.length >= MAX_GROUP_ROWS;

  return {
    measure,
    dimension,
    additive,
    measureType: mType,
    totalA,
    totalB,
    headlineDelta,
    headlinePct: totalA !== 0 ? headlineDelta / totalA : null,
    contributors,
    residual,
    bucketedCount: tail.length,
    truncated,
    note: additive
      ? 'Contributions sum to the headline Δ (± residual). Descriptive attribution, not a forecast.'
      : `"${mType}" is non-additive — per-segment numbers are level changes by segment, not contributions that sum to the headline. The headline Δ is computed ungrouped.`,
  };
}
