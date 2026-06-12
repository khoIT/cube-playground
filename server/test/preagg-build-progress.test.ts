/**
 * Tests for the live build-progress aggregator + the docker-timestamp prefix
 * handling shared with the sweep parser.
 *
 * Real worker log lines arrive as `<RFC3339 ts> {json}` (the log reader
 * requests timestamps=1), so fixtures here include the prefix — the shape that
 * previously made parseWorkerLog skip every line.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  aggregateBuildEvents,
  applySnapshotFallback,
  __resetBuildProgressSnapshot,
  type BuildProgress,
  type BuildRollupProgress,
} from '../src/services/preagg-build-progress.js';
import { splitDockerTimestamp, parseWorkerLog } from '../src/services/preagg-run-parser.js';

const TS = '2026-06-11T06:17:35.236526456Z';

function line(obj: Record<string, unknown>, ts = TS): string {
  return `${ts} ${JSON.stringify(obj)}`;
}

describe('splitDockerTimestamp', () => {
  it('splits a docker-prefixed line into ts + body', () => {
    const { ts, body } = splitDockerTimestamp(`${TS} {"message":"x"}`);
    expect(ts).toBe(TS);
    expect(body).toBe('{"message":"x"}');
  });

  it('passes through lines without a prefix', () => {
    const { ts, body } = splitDockerTimestamp('{"message":"x"}');
    expect(ts).toBeNull();
    expect(body).toBe('{"message":"x"}');
  });
});

describe('parseWorkerLog with docker timestamp prefixes', () => {
  it('detects sweeps + failures on prefixed lines (previously all skipped)', () => {
    const sweeps = parseWorkerLog([
      line({ message: 'Refresh Scheduler Interval' }),
      line({ message: 'Error while querying', preAggregationId: 'mf_users.daily_batch', error: 'connect ETIMEDOUT' }),
    ]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].startedAt).toBe(TS);
    expect(sweeps[0].failures).toHaveLength(1);
    expect(sweeps[0].failures[0].preAggregationId).toBe('mf_users.daily_batch');
  });
});

describe('aggregateBuildEvents', () => {
  it('returns empty for noise / lines without preAggregationId', () => {
    expect(aggregateBuildEvents([
      '🚀 Cube API server is listening',
      line({ message: 'Query started' }),
      line({ message: 'Compiling schema' }),
    ])).toEqual([]);
  });

  it('tracks queued → building → finished per rollup', () => {
    const out = aggregateBuildEvents([
      line({ message: 'Added to queue', preAggregationId: 'a.r1' }),
      line({ message: 'Added to queue', preAggregationId: 'b.r2' }),
      line({ message: 'Performing query', preAggregationId: 'a.r1' }),
      line({ message: 'Performing query completed', preAggregationId: 'a.r1' }),
      line({ message: 'Performing query', preAggregationId: 'a.r1' }),
      line({ message: 'Performing query', preAggregationId: 'b.r2' }),
      line({ message: 'Performing query completed', preAggregationId: 'b.r2' }),
    ]);
    expect(out).toHaveLength(2);
    const a = out.find((r) => r.id === 'a.r1')!;
    const b = out.find((r) => r.id === 'b.r2')!;
    // a: 2 started, 1 completed → still building
    expect(a.phase).toBe('building');
    expect(a.partitionsStarted).toBe(2);
    expect(a.partitionsCompleted).toBe(1);
    // b: all observed builds completed → finished
    expect(b.phase).toBe('finished');
    expect(b.cube).toBe('b');
    expect(b.rollup).toBe('r2');
  });

  it('marks failures with a classified signature and keeps them failed', () => {
    const out = aggregateBuildEvents([
      line({ message: 'Performing query', preAggregationId: 'a.r1' }),
      line({ message: 'Error while querying', preAggregationId: 'a.r1', error: 'connect ETIMEDOUT 10.0.0.1' }),
    ]);
    expect(out[0].phase).toBe('failed');
    expect(out[0].errorSig).toBe('etimedout');
    expect(out[0].errorMessage).toContain('ETIMEDOUT');
  });

  it('reports queued for rollups only seen on the queue', () => {
    const out = aggregateBuildEvents([
      line({ message: 'Added to queue', preAggregationId: 'a.r1' }),
    ]);
    expect(out[0].phase).toBe('queued');
  });

  it('preserves first-appearance order', () => {
    const out = aggregateBuildEvents([
      line({ message: 'Added to queue', preAggregationId: 'z.last' }),
      line({ message: 'Added to queue', preAggregationId: 'a.first' }),
      line({ message: 'Performing query', preAggregationId: 'z.last' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['z.last', 'a.first']);
  });

  it('uses the docker timestamp as lastEventAt', () => {
    const out = aggregateBuildEvents([
      line({ message: 'Added to queue', preAggregationId: 'a.r1' }, '2026-06-11T06:00:00Z'),
      line({ message: 'Performing query', preAggregationId: 'a.r1' }, '2026-06-11T06:01:00Z'),
    ]);
    expect(out[0].lastEventAt).toBe('2026-06-11T06:01:00Z');
  });
});

describe('applySnapshotFallback', () => {
  beforeEach(() => __resetBuildProgressSnapshot());

  const rollup = (id: string): BuildRollupProgress => ({
    id, cube: id.split('.')[0], rollup: id.split('.')[1] ?? '',
    phase: 'finished', partitionsStarted: 4, partitionsCompleted: 4,
    errorSig: null, errorMessage: null, lastEventAt: '2026-06-11T23:56:00Z',
  });
  const window = (over: Partial<BuildProgress>): BuildProgress => ({
    game: 'tf', startedAt: '2026-06-11T23:54:05.052Z', finishedAt: null,
    degraded: false, rollups: [], totals: { queued: 0, building: 0, finished: 0, failed: 0 },
    ...over,
  });

  it('serves the cached rollups when --restore wiped the logs of the same window', () => {
    const live = window({ rollups: [rollup('active_daily.r')], totals: { queued: 0, building: 0, finished: 1, failed: 0 } });
    expect(applySnapshotFallback(live)).toBe(live); // non-empty passes through + caches

    // Post-restore poll: same window, container recreated → zero log lines.
    const afterRestore = applySnapshotFallback(window({ finishedAt: '2026-06-11T23:57:41.237Z' }));
    expect(afterRestore.rollups.map((r) => r.id)).toEqual(['active_daily.r']);
    expect(afterRestore.finishedAt).toBe('2026-06-11T23:57:41.237Z'); // live metadata wins
  });

  it('does NOT recover a snapshot from a different trigger window', () => {
    applySnapshotFallback(window({ rollups: [rollup('active_daily.r')] }));
    const next = window({ startedAt: '2026-06-12T01:00:00.000Z' });
    expect(applySnapshotFallback(next).rollups).toEqual([]);
  });
});
