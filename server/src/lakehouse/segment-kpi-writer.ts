/**
 * Segment-level KPI time-series writer.
 *
 * Persists the scalar KPIs the Insights tab computes (via card-runner) as a
 * time-series in segment_kpi_daily. One row per (snapshot_ts, segment, metric).
 *
 * Correctness guarantee: uses runScopedKpi (the same path as runPresetCards)
 * so the persisted value == the Insights-tab value for the same snapshot_ts
 * with zero drift. Non-additive KPIs (paying_rate, arppu, ratio measures) are
 * correct because they are computed by Cube, never derived from per-user state.
 *
 * Empty cohort: when runScopedKpi returns null the row is still written with
 * value = NULL (not omitted), so the time-series has complete coverage and
 * the monitor UI can render the gap explicitly.
 *
 * Idempotent per (snapshot_ts, game, segment): DELETE the slice then INSERT.
 * Never throws — returns a structured result for the job heartbeat.
 */

import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';
import { toSqlLiteral } from './inline-sql-params.js';
import {
  SEGMENT_KPI_DAILY,
  LAKEHOUSE_SCHEMA,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  lakehouseConnectorFromEnv,
} from './lakehouse-trino-connector.js';
import { segmentKpiSpecsForPreset } from './canonical-metric-set.js';
import { runScopedKpi } from '../services/card-runner.js';
import { resolveGamePrefixForWorkspace } from '../services/resolve-game-prefix.js';
import { parseCubeSegments } from '../services/cube-query-segments.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { logicalCube } from '../services/cube-member-resolver.js';
import { pickPresetForSegment } from '../presets/registry.js';
import type { KpiSpec } from '../presets/mf-users-hub.js';

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export interface KpiWriteResult {
  segmentId: string;
  snapshotTs: string;
  status: 'written' | 'skipped' | 'error';
  /** Number of metric rows written. */
  rowCount?: number;
  reason?: string;
  error?: string;
}

export interface KpiWriteOptions {
  connector?: Connector;
}

interface SegmentForKpi {
  segmentId: string;
  gameId: string;
  cube: string;
  workspace: string;
  cubeQueryJson: string;
}

/**
 * Build the multi-row VALUES SQL for a KPI snapshot. Pure function —
 * exported for unit testing without Trino.
 *
 * Verifiable:
 *  - One VALUES tuple per spec (even when value is null → NULL literal).
 *  - DELETE and INSERT are keyed on the same (game, segment, snapshot_ts) slice.
 *  - toSqlLiteral correctly escapes strings and renders NULL for null values.
 */
export function buildKpiInsertSql(opts: {
  specs: Array<{ metricId: string; metricLabel: string; value: number | null }>;
  memberCount: number;
  snapshotDate: string;
  snapshotTs: string;
  gameId: string;
  segmentId: string;
}): { insertSql: string; deleteSql: string } {
  const { specs, memberCount, snapshotDate, snapshotTs, gameId, segmentId } = opts;
  const gameLit = toSqlLiteral(gameId);
  const segLit = toSqlLiteral(segmentId);
  const dateLit = `DATE '${snapshotDate}'`;
  const tsLit = `TIMESTAMP '${snapshotTs}'`;

  const deleteSql =
    `DELETE FROM ${SEGMENT_KPI_DAILY} ` +
    `WHERE game_id = ${gameLit} AND segment_id = ${segLit} AND snapshot_ts = ${tsLit}`;

  const tuples = specs.map(({ metricId, metricLabel, value }) => {
    const valueLit = value === null ? 'NULL' : toSqlLiteral(value);
    return (
      `(${dateLit}, ${tsLit}, ${gameLit}, ${segLit}, ` +
      `${toSqlLiteral(metricId)}, ${toSqlLiteral(metricLabel)}, ${valueLit}, ${memberCount})`
    );
  });

  const insertSql =
    `INSERT INTO ${SEGMENT_KPI_DAILY} ` +
    `(snapshot_date, snapshot_ts, game_id, segment_id, metric_id, metric_label, value, member_count) ` +
    `VALUES ${tuples.join(', ')}`;

  return { insertSql, deleteSql };
}

/**
 * Compute and persist all canonical KPIs for one (segment, snapshot_ts).
 * Resolves the segment's preset + predicate filters once, then calls
 * runScopedKpi per spec. member_count is the membership row count already
 * produced this tick — passed through rather than re-queried.
 */
export async function writeSegmentKpiSnapshot(
  segment: SegmentForKpi,
  snapshotTs: string,
  memberCount: number,
  opts: KpiWriteOptions = {},
): Promise<KpiWriteResult> {
  const base = { segmentId: segment.segmentId, snapshotTs };

  if (!TS_RE.test(snapshotTs)) {
    return { ...base, status: 'error', error: `invalid snapshotTs: ${snapshotTs}` };
  }

  const snapshotDate = snapshotTs.slice(0, 10);
  const connector = opts.connector ?? lakehouseConnectorFromEnv();

  // Resolve preset the same way refresh-segment does: logical cube + anchor pivot.
  const prefix = resolveGamePrefixForWorkspace(segment.workspace, segment.gameId);
  const logicalSegCube = logicalCube(segment.cube, prefix);
  // Anchor cube: if the identity field is on a different cube (join-inherited),
  // we don't have it here without a full resolve — use the segment cube as the
  // direct lookup and let the anchor fallback handle it if direct misses.
  const preset = pickPresetForSegment(logicalSegCube, null);

  if (!preset) {
    return { ...base, status: 'skipped', reason: `no preset for cube ${logicalSegCube}` };
  }

  const specs: KpiSpec[] = segmentKpiSpecsForPreset(preset.id);
  if (specs.length === 0) {
    return { ...base, status: 'skipped', reason: `preset ${preset.id} has 0 KPI specs` };
  }

  // Resolve segment's predicate filters + cube-level segments from stored query —
  // exact same path as refresh-segment's card-runner call.
  const baseQuery = JSON.parse(segment.cubeQueryJson) as Record<string, unknown>;
  const segmentFilters = Array.isArray(baseQuery.filters)
    ? (baseQuery.filters as Array<Record<string, unknown>>)
    : [];
  const cubeSegments = parseCubeSegments(segment.cubeQueryJson) ?? [];
  const token = resolveCubeTokenForGame(segment.gameId) ?? undefined;

  // Run each KPI spec through runScopedKpi (same Cube path as Insights tab).
  const results: Array<{ metricId: string; metricLabel: string; value: number | null }> = [];
  for (const spec of specs) {
    const value = await runScopedKpi(spec, segmentFilters as Parameters<typeof runScopedKpi>[1], {
      token,
      prefix,
      cubeSegments,
    });
    results.push({ metricId: spec.measure, metricLabel: spec.label, value });
  }

  if (results.length === 0) {
    return { ...base, status: 'skipped', reason: 'no results to write' };
  }

  try {
    const { insertSql, deleteSql } = buildKpiInsertSql({
      specs: results,
      memberCount,
      snapshotDate,
      snapshotTs,
      gameId: segment.gameId,
      segmentId: segment.segmentId,
    });

    await runQuery(connector, LAKEHOUSE_SCHEMA, deleteSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
    await runQuery(connector, LAKEHOUSE_SCHEMA, insertSql, LAKEHOUSE_STATEMENT_TIMEOUT_MS);

    return { ...base, status: 'written', rowCount: results.length };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message };
  }
}
