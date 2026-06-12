/**
 * Tests for preagg-run-parser: parseWorkerLog + classifyError.
 *
 * Fixture log lines cover:
 *   - A sweep start marker
 *   - Two failures with different message patterns
 *   - Non-JSON noise lines (should be skipped)
 *   - A second sweep start (multiple sweeps)
 */

import { describe, it, expect } from 'vitest';
import { parseWorkerLog, classifyError } from '../src/services/preagg-run-parser.js';

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies etimedout', () => {
    expect(classifyError('connect ETIMEDOUT 10.0.0.1:8080')).toBe('etimedout');
  });

  it('classifies download-external', () => {
    expect(classifyError('Downloading external pre-aggregation error: too large')).toBe('download-external');
  });

  it('classifies table-not-found', () => {
    expect(classifyError('table is not found after it was successfully created')).toBe('table-not-found');
  });

  it('classifies query-error for "Error while querying"', () => {
    expect(classifyError('Error while querying after 135s')).toBe('query-error');
  });

  it('classifies query-error for "Error querying db"', () => {
    expect(classifyError('Error querying db: connection refused')).toBe('query-error');
  });

  it('classifies econnrefused', () => {
    expect(classifyError('connect ECONNREFUSED 127.0.0.1:4000')).toBe('econnrefused');
  });

  it('returns unknown for unrecognised messages', () => {
    expect(classifyError('some random log line')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// parseWorkerLog
// ---------------------------------------------------------------------------

function makeLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    time: '2026-06-10T07:00:00.000Z',
    message: 'some log',
    ...overrides,
  });
}

const SWEEP_START = makeLine({ message: 'Refresh Scheduler Interval triggered' });

const FAILURE_ETIMEDOUT = makeLine({
  time: '2026-06-10T07:01:00.000Z',
  message: 'Error while querying',
  preAggregationId: 'active_daily.dau_by_ingame_dims_daily_batch',
  error: 'connect ETIMEDOUT 10.164.54.88:8080',
});

const FAILURE_DOWNLOAD = makeLine({
  time: '2026-06-10T07:02:00.000Z',
  message: 'Downloading external pre-aggregation error',
  preAggregationId: 'game_key_metrics.key_metrics_by_source_daily_batch',
  error: 'Downloading external pre-aggregation error: row limit exceeded',
  newVersionEntry: { table_name: 'prod_pre_aggregations.game_key_metrics_key_metrics_batch20260610' },
});

const NOISE_LINE = 'not json at all — startup noise';
const NOISE_JSON_NO_MATCH = makeLine({ message: 'Cube store is running' });

const SECOND_SWEEP_START = makeLine({
  time: '2026-06-10T08:00:00.000Z',
  message: 'Refresh Scheduler Interval triggered again',
});

describe('parseWorkerLog', () => {
  it('returns empty array when no sweep-start marker is present', () => {
    const result = parseWorkerLog([NOISE_LINE, NOISE_JSON_NO_MATCH]);
    expect(result).toHaveLength(0);
  });

  it('parses a single sweep with two failures', () => {
    const lines = [NOISE_LINE, SWEEP_START, FAILURE_ETIMEDOUT, FAILURE_DOWNLOAD, NOISE_JSON_NO_MATCH];
    const result = parseWorkerLog(lines);

    expect(result).toHaveLength(1);
    const sweep = result[0];
    expect(sweep.failures).toHaveLength(2);
  });

  it('extracts preAggregationId from failure lines', () => {
    const lines = [SWEEP_START, FAILURE_ETIMEDOUT, FAILURE_DOWNLOAD];
    const [sweep] = parseWorkerLog(lines);

    const ids = sweep.failures.map((f) => f.preAggregationId);
    expect(ids).toContain('active_daily.dau_by_ingame_dims_daily_batch');
    expect(ids).toContain('game_key_metrics.key_metrics_by_source_daily_batch');
  });

  it('assigns correct errorSig via classifyError', () => {
    const lines = [SWEEP_START, FAILURE_ETIMEDOUT, FAILURE_DOWNLOAD];
    const [sweep] = parseWorkerLog(lines);

    const sigs = sweep.failures.map((f) => f.errorSig);
    expect(sigs).toContain('etimedout');
    expect(sigs).toContain('download-external');
  });

  it('captures tableName from newVersionEntry', () => {
    const lines = [SWEEP_START, FAILURE_DOWNLOAD];
    const [sweep] = parseWorkerLog(lines);

    expect(sweep.failures[0].tableName).toContain('game_key_metrics');
  });

  it('skips non-JSON noise lines without error', () => {
    const lines = [SWEEP_START, NOISE_LINE, FAILURE_ETIMEDOUT];
    expect(() => parseWorkerLog(lines)).not.toThrow();
    const [sweep] = parseWorkerLog(lines);
    expect(sweep.failures).toHaveLength(1);
  });

  it('parses two sweeps from two markers', () => {
    const lines = [
      SWEEP_START,
      FAILURE_ETIMEDOUT,
      SECOND_SWEEP_START,
      FAILURE_DOWNLOAD,
    ];
    const result = parseWorkerLog(lines);
    expect(result).toHaveLength(2);
    expect(result[0].failures).toHaveLength(1);
    expect(result[1].failures).toHaveLength(1);
  });

  it('sets startedAt from the sweep-start line timestamp', () => {
    const lines = [SWEEP_START, FAILURE_ETIMEDOUT];
    const [sweep] = parseWorkerLog(lines);
    expect(sweep.startedAt).toBe('2026-06-10T07:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// parseWorkerLog — completed partition builds
// ---------------------------------------------------------------------------

const BUILD_COMPLETED = makeLine({
  time: '2026-06-10T07:03:00.000Z',
  message: 'Performing query completed',
  duration: '8529',
  preAggregationId: 'active_daily.dau_by_country_payer_daily_batch',
  queuePrefix: 'SQL_PRE_AGGREGATIONS_orch_jus_default',
  queryKey: "[['CREATE TABLE preagg_jus.active_daily_dau_by_country_payer_daily_batch20260601 AS SELECT",
  newVersionEntry: { table_name: 'preagg_jus.active_daily_dau_by_country_payer_daily_batch20260601' },
});

const BUILD_SECOND_PARTITION = makeLine({
  time: '2026-06-10T07:04:00.000Z',
  message: 'Performing query completed',
  duration: '1471',
  preAggregationId: 'active_daily.dau_by_country_payer_daily_batch',
  queuePrefix: 'SQL_PRE_AGGREGATIONS_orch_jus_default',
  newVersionEntry: { table_name: 'preagg_jus.active_daily_dau_by_country_payer_daily_batch20260101' },
});

// Orchestrator metadata fetch — same message shape, must NOT count as a build.
const CACHE_FETCH_NOISE = makeLine({
  time: '2026-06-10T07:03:30.000Z',
  message: 'Performing query completed',
  duration: '13',
  preAggregationId: 'active_daily.dau_by_country_payer_daily_batch',
  queuePrefix: 'SQL_PRE_AGGREGATIONS_CACHE_orch_jus_default',
  queryKey: 'Fetch tables for preagg_jus',
});

describe('parseWorkerLog — partition builds', () => {
  it('collects completed builds with schema game, rollup split, and duration', () => {
    const [sweep] = parseWorkerLog([SWEEP_START, BUILD_COMPLETED, BUILD_SECOND_PARTITION]);
    expect(sweep.builds).toHaveLength(2);
    expect(sweep.builds[0]).toMatchObject({
      schemaGame: 'jus',
      cube: 'active_daily',
      rollup: 'dau_by_country_payer_daily_batch',
      durationMs: 8529,
      batchDate: '20260601', // partition window from the table's batch suffix
    });
    expect(sweep.builds[1].durationMs).toBe(1471);
    expect(sweep.builds[1].batchDate).toBe('20260101');
  });

  it('ignores CACHE-queue metadata fetches that share the completed message', () => {
    const [sweep] = parseWorkerLog([SWEEP_START, CACHE_FETCH_NOISE, BUILD_COMPLETED]);
    expect(sweep.builds).toHaveLength(1);
    expect(sweep.builds[0].durationMs).toBe(8529);
  });

  it('ignores builds outside a sweep window', () => {
    const result = parseWorkerLog([BUILD_COMPLETED, SWEEP_START]);
    expect(result[0].builds).toHaveLength(0);
  });
});
