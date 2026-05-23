/**
 * Tests for the emit_chart tool handler.
 * - Emits a 'chart' SSE event with a built ChartArtifact.
 * - Returns { ok: true, id, truncated }.
 * - Applies top-N truncation server-side.
 * - Surfaces invalid_spec when handed a malformed spec (defensive net).
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext, ChartArtifact } from '../src/types.js';
import { handler } from '../src/tools/emit-chart.js';
import { TOP_N } from '../src/services/chart-spec.js';

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ptg',
    cubeToken: 'Bearer test-token',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

describe('emit_chart handler', () => {
  it('emits a chart event and returns ok+id for a valid spec', async () => {
    const ctx = makeCtx();
    const emitted: ChartArtifact[] = [];
    ctx.sseEmitter.on('chart', (a: ChartArtifact) => emitted.push(a));

    const result = await handler(
      {
        spec: {
          type: 'bar',
          title: 'Sales by region',
          data: [
            { region: 'NA', revenue: 100 },
            { region: 'EU', revenue: 80 },
          ],
          encoding: { category: 'region', value: 'revenue' },
        },
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: true, truncated: false });
    expect('id' in result && result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].spec.type).toBe('bar');
    expect(emitted[0].truncated).toBe(false);
    expect(emitted[0].originalRowCount).toBe(2);
  });

  it('applies top-N truncation when row count exceeds the cap', async () => {
    const ctx = makeCtx();
    const emitted: ChartArtifact[] = [];
    ctx.sseEmitter.on('chart', (a: ChartArtifact) => emitted.push(a));

    const rows = Array.from({ length: 50 }, (_, i) => ({
      region: `R${i}`,
      revenue: 100 - i,
    }));

    const result = await handler(
      {
        spec: {
          type: 'bar',
          title: 'Top regions',
          data: rows,
          encoding: { category: 'region', value: 'revenue' },
        },
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].truncated).toBe(true);
    expect(emitted[0].originalRowCount).toBe(50);
    expect(emitted[0].spec.data).toHaveLength(TOP_N);
    expect(emitted[0].spec.data[emitted[0].spec.data.length - 1].region).toBe(
      'Other',
    );
  });

  it('emits a stacked-bar with series encoding', async () => {
    const ctx = makeCtx();
    const emitted: ChartArtifact[] = [];
    ctx.sseEmitter.on('chart', (a: ChartArtifact) => emitted.push(a));

    await handler(
      {
        spec: {
          type: 'stacked-bar',
          title: 'Revenue by group/channel',
          data: [
            { group: 'Web', channel: 'a', revenue: 200 },
            { group: 'Web', channel: 'b', revenue: 150 },
            { group: 'IAP', channel: 'appstore', revenue: 300 },
          ],
          encoding: { category: 'group', value: 'revenue', series: 'channel' },
        },
      },
      ctx,
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].spec.type).toBe('stacked-bar');
    if (emitted[0].spec.type === 'stacked-bar') {
      expect(emitted[0].spec.encoding.series).toBe('channel');
    }
  });

  it('returns invalid_spec and does NOT emit when the spec is malformed', async () => {
    const ctx = makeCtx();
    const emitted: unknown[] = [];
    ctx.sseEmitter.on('chart', (a) => emitted.push(a));

    // stacked-bar missing series — bypass type system by casting
    const result = await handler(
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spec: {
          type: 'stacked-bar',
          title: 't',
          data: [{ a: 'x', b: 1 }],
          encoding: { category: 'a', value: 'b' },
        } as any,
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: false, error: 'invalid_spec' });
    expect(emitted).toHaveLength(0);
  });

  it('attaches artifactRef to the emitted ChartArtifact', async () => {
    const ctx = makeCtx();
    const emitted: ChartArtifact[] = [];
    ctx.sseEmitter.on('chart', (a: ChartArtifact) => emitted.push(a));

    await handler(
      {
        spec: {
          type: 'pie',
          title: 'Split',
          data: [
            { k: 'Web', v: 60 },
            { k: 'IAP', v: 40 },
          ],
          encoding: { category: 'k', value: 'v' },
        },
        artifactRef: 'q-abc',
      },
      ctx,
    );

    expect(emitted[0].artifactRef).toBe('q-abc');
  });
});
