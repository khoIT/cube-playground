/**
 * buildTriggeredSweep — folds a triggered build's worker logs into a durable
 * sweep record. Pure (no DB); recordTriggeredBuild is the thin DB wrapper.
 *
 * Asserts the cube-grouping + outcome mapping (finished→sealed, failure→failed,
 * nothing→empty) and the header counts the post-build summary shows.
 */

import { describe, it, expect } from 'vitest';
import { buildTriggeredSweep } from '../src/services/preagg-triggered-build-record.js';

/** Build a Docker-timestamped JSON worker log line. */
function line(preAggregationId: string, message: string, extra: Record<string, unknown> = {}): string {
  return `2026-06-13T09:17:00.000Z ${JSON.stringify({ preAggregationId, message, ...extra })}`;
}

const STARTED = '2026-06-13T09:15:00.000Z';
const FINISHED = '2026-06-13T09:17:38.000Z';

describe('buildTriggeredSweep', () => {
  it('groups completed builds by cube and maps finished rollups to sealed', () => {
    const lines = [
      line('active_daily.dau_by_country_payer_daily_batch', 'Performing query'),
      line('active_daily.dau_by_country_payer_daily_batch', 'Performing query completed'),
      line('active_daily.dau_by_country_payer_daily_batch', 'Performing query completed'),
      line('game_key_metrics.key_metrics_by_source_daily_batch', 'Performing query completed'),
    ];
    const { sweep, items } = buildTriggeredSweep({ game: 'jus_vn', startedAt: STARTED, finishedAt: FINISHED, lines });

    expect(sweep.source).toBe('triggered-build');
    expect(sweep.startedAt).toBe(STARTED); // idempotency key
    expect(sweep.gamesCount).toBe(1);
    expect(sweep.rollupsTotal).toBe(2); // 2 distinct preAggregationIds
    expect(sweep.durationMs).toBe(158_000);
    expect(sweep.sealedCount).toBe(2);
    expect(sweep.failedCount).toBe(0);

    expect(items).toHaveLength(2); // active_daily + game_key_metrics
    const active = items.find((i) => i.cube === 'active_daily')!;
    expect(active.game).toBe('jus_vn');
    expect(active.outcome).toBe('sealed');
    expect(active.serveable).toBe(true);
    expect(active.partitionsBuilt).toBe(2);
    expect(active.rollupsBuilt).toEqual([
      { rollup: 'dau_by_country_payer_daily_batch', partitions: 2, buildMs: 0 },
    ]);
    expect(active.lastSealedAt).toBe(FINISHED);
  });

  it('maps a rollup with a failure line to failed and carries the error', () => {
    const lines = [
      line('marketing_cost.cost_by_source_daily_batch', 'Performing query completed'),
      line('marketing_cost.cost_by_source_daily_batch', 'Error while querying db', { error: 'connect ETIMEDOUT trino:8080' }),
    ];
    const { sweep, items } = buildTriggeredSweep({ game: 'jus_vn', startedAt: STARTED, finishedAt: FINISHED, lines });

    expect(sweep.failedCount).toBe(1);
    expect(sweep.sealedCount).toBe(0);
    const item = items[0];
    expect(item.outcome).toBe('failed');
    expect(item.serveable).toBe(false);
    expect(item.rollup).toBe('cost_by_source_daily_batch');
    expect(item.errorSig).toBe('etimedout');
    expect(item.errorMessage).toContain('ETIMEDOUT');
  });

  it('records an empty (nothing-rebuilt) build as a zero-count row', () => {
    const { sweep, items } = buildTriggeredSweep({ game: 'jus_vn', startedAt: STARTED, finishedAt: FINISHED, lines: [] });
    expect(items).toHaveLength(0);
    expect(sweep.rollupsTotal).toBe(0);
    expect(sweep.sealedCount).toBe(0);
    expect(sweep.failedCount).toBe(0);
    expect(sweep.unbuiltCount).toBe(0);
    expect(sweep.source).toBe('triggered-build');
  });

  it('classifies a queued-but-never-completed rollup as unbuilt (no partitions)', () => {
    const lines = [line('mf_users.ltv_by_install_cohort_batch', 'Added to queue')];
    const { sweep, items } = buildTriggeredSweep({ game: 'jus_vn', startedAt: STARTED, finishedAt: FINISHED, lines });
    expect(items[0].outcome).toBe('unbuilt');
    expect(items[0].partitionsBuilt).toBeNull();
    expect(sweep.unbuiltCount).toBe(1);
  });
});
