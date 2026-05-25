/**
 * Tests for run-funnel.ts: single-query dispatcher and drop-off computation.
 */

import { describe, it, expect, vi } from 'vitest';
import { runFunnel } from '../run-funnel';

const CUBE_NAME = 'ordered_event_funnel';

function makeApi(rows: Array<Record<string, string | number | null>>) {
  return {
    load: vi.fn().mockResolvedValue({
      tablePivot: () => rows,
    }),
  };
}

describe('runFunnel', () => {
  it('maps step_index rows to ordered event labels', async () => {
    const cubejsApi = makeApi([
      { [`${CUBE_NAME}.step_index`]: 1, [`${CUBE_NAME}.step_count`]: 1000 },
      { [`${CUBE_NAME}.step_index`]: 2, [`${CUBE_NAME}.step_count`]: 600 },
      { [`${CUBE_NAME}.step_index`]: 3, [`${CUBE_NAME}.step_count`]: 300 },
    ]);

    const result = await runFunnel({
      orderedEvents: ['login', 'purchase', 'review'],
      windowMs: 24 * 60 * 60 * 1000,
      cubeName: CUBE_NAME,
      cubejsApi,
    });

    expect(result.badge).toBe('ordered');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].name).toBe('login');
    expect(result.steps[0].count).toBe(1000);
    expect(result.steps[0].dropFromPrev).toBe(0);
    expect(result.steps[0].dropPct).toBe(0);

    expect(result.steps[1].name).toBe('purchase');
    expect(result.steps[1].count).toBe(600);
    expect(result.steps[1].dropFromPrev).toBe(400);
    expect(result.steps[1].dropPct).toBeCloseTo(40);

    expect(result.steps[2].name).toBe('review');
    expect(result.steps[2].count).toBe(300);
    expect(result.steps[2].dropFromPrev).toBe(300);
    expect(result.steps[2].dropPct).toBe(50);
  });

  it('defaults missing steps to 0 users', async () => {
    const cubejsApi = makeApi([
      { [`${CUBE_NAME}.step_index`]: 1, [`${CUBE_NAME}.step_count`]: 500 },
      // step 2 missing — no users reached it
    ]);

    const result = await runFunnel({
      orderedEvents: ['start', 'complete'],
      windowMs: 3600_000,
      cubeName: CUBE_NAME,
      cubejsApi,
    });

    expect(result.steps[1].count).toBe(0);
    expect(result.steps[1].dropFromPrev).toBe(500);
    expect(result.steps[1].dropPct).toBe(100);
  });

  it('throws on fewer than 2 events', async () => {
    const cubejsApi = makeApi([]);
    await expect(
      runFunnel({ orderedEvents: ['only_one'], windowMs: 3600_000, cubeName: CUBE_NAME, cubejsApi }),
    ).rejects.toThrow('at least 2');
  });

  it('throws on more than 6 events', async () => {
    const cubejsApi = makeApi([]);
    await expect(
      runFunnel({
        orderedEvents: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        windowMs: 3600_000,
        cubeName: CUBE_NAME,
        cubejsApi,
      }),
    ).rejects.toThrow('at most 6');
  });

  it('sends correct filter member in query', async () => {
    const cubejsApi = makeApi([
      { [`${CUBE_NAME}.step_index`]: 1, [`${CUBE_NAME}.step_count`]: 10 },
      { [`${CUBE_NAME}.step_index`]: 2, [`${CUBE_NAME}.step_count`]: 5 },
    ]);

    await runFunnel({
      orderedEvents: ['evt_a', 'evt_b'],
      windowMs: 7 * 24 * 3600_000,
      cubeName: CUBE_NAME,
      cubejsApi,
    });

    expect(cubejsApi.load).toHaveBeenCalledOnce();
    const query = cubejsApi.load.mock.calls[0][0] as {
      measures: string[];
      dimensions: string[];
      filters: Array<{ member: string; operator: string; values: string[] }>;
      order: Record<string, string>;
    };

    expect(query.measures).toContain(`${CUBE_NAME}.step_count`);
    expect(query.dimensions).toContain(`${CUBE_NAME}.step_index`);
    expect(query.filters[0].member).toBe(`${CUBE_NAME}.step_name`);
    expect(query.filters[0].operator).toBe('equals');
    expect(query.filters[0].values).toEqual(['evt_a', 'evt_b']);
    expect(query.order[`${CUBE_NAME}.step_index`]).toBe('asc');
  });

  it('wraps Cube errors with a friendly message', async () => {
    const cubejsApi = {
      load: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };

    await expect(
      runFunnel({ orderedEvents: ['a', 'b'], windowMs: 3600_000, cubeName: CUBE_NAME, cubejsApi }),
    ).rejects.toThrow('Funnel query failed: Network timeout');
  });

  it('returns 0 dropPct when previous step count is 0', async () => {
    const cubejsApi = makeApi([
      { [`${CUBE_NAME}.step_index`]: 1, [`${CUBE_NAME}.step_count`]: 0 },
      { [`${CUBE_NAME}.step_index`]: 2, [`${CUBE_NAME}.step_count`]: 0 },
    ]);

    const result = await runFunnel({
      orderedEvents: ['first', 'second'],
      windowMs: 3600_000,
      cubeName: CUBE_NAME,
      cubejsApi,
    });

    // Division by zero guarded — should not produce NaN or Infinity
    expect(result.steps[1].dropPct).toBe(0);
    expect(Number.isFinite(result.steps[1].dropPct)).toBe(true);
  });
});
