/**
 * decompose_metric + get_metric_benchmark tool handlers.
 *
 * These wrap server engines over HTTP; the load-bearing behavior is the
 * fail-soft mapping — every error path must return ok:false with a machine
 * reason so the model explains instead of crashing — plus the scope guard and
 * the deeper-lenses opt-in. The server-client is mocked; we assert on the
 * request shape we send and the result shape we return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ToolContext } from '../src/types.js';

vi.mock('../src/services/server-client.js', () => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  ServerClientError: class ServerClientError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  },
}));

import * as serverClient from '../src/services/server-client.js';
import { handler as decompose } from '../src/tools/decompose-metric.js';
import { handler as benchmark } from '../src/tools/get-metric-benchmark.js';

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'cfm_vn',
    cubeToken: 'Bearer tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

const DIAGNOSIS = {
  goalTrees: [{ goal: 'revenue', factors: [{ key: 'arppu', label: 'ARPPU', value: 10, baseline: 20, weak: true }] }],
  opportunities: [{ factor: 'arppu', gapPct: 50, gapValue: 10, confidence: 3, agreeingLenses: [1, 2, 4] }],
  lenses: [
    { id: 1, name: 'ARPPU vs Pop', verdict: 'weak', factor: 'arppu', method: 'p-rank', provenance: { source: 'recharge / cfm_vn', cube: 'recharge' } },
    { id: 2, name: 'Payer mix', verdict: 'weak', factor: 'arppu', method: 'share', provenance: { source: 'recharge / cfm_vn' } },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('decompose_metric handler', () => {
  it('maps engine response to opportunities + deduped provenance', async () => {
    vi.mocked(serverClient.postJson).mockResolvedValue(DIAGNOSIS);
    const res = await decompose({ game_id: 'cfm_vn', goal: 'revenue' }, makeCtx());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) throw new Error('expected ok');
    expect(res.opportunities[0]).toMatchObject({ factor: 'arppu', gapPct: 50, confidence: 3 });
    expect(res.lensEvidence).toHaveLength(2);
    // Two lenses, one source string → deduped to one provenance entry.
    expect(res.provenance).toEqual(['recharge / cfm_vn']);
  });

  it('defaults to the fast lenses and only sends lenses[] when deeper', async () => {
    vi.mocked(serverClient.postJson).mockResolvedValue(DIAGNOSIS);
    await decompose({ game_id: 'cfm_vn', goal: 'both' }, makeCtx());
    const fastBody = vi.mocked(serverClient.postJson).mock.calls[0][1] as Record<string, unknown>;
    expect(fastBody).not.toHaveProperty('lenses');

    vi.mocked(serverClient.postJson).mockResolvedValue(DIAGNOSIS);
    await decompose({ game_id: 'cfm_vn', goal: 'both', deeper: true }, makeCtx());
    const deepBody = vi.mocked(serverClient.postJson).mock.calls[1][1] as Record<string, unknown>;
    expect(deepBody.lenses).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('rejects segment scope without a segment_id (no server call)', async () => {
    const res = await decompose({ game_id: 'cfm_vn', scope_kind: 'segment' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason: 'invalid-scope' });
    expect(serverClient.postJson).not.toHaveBeenCalled();
  });

  it('builds a segment scope when segment_id is present', async () => {
    vi.mocked(serverClient.postJson).mockResolvedValue(DIAGNOSIS);
    await decompose({ game_id: 'cfm_vn', scope_kind: 'segment', segment_id: 'seg-9' }, makeCtx());
    const body = vi.mocked(serverClient.postJson).mock.calls[0][1] as { scope: Record<string, unknown> };
    expect(body.scope).toEqual({ kind: 'segment', gameId: 'cfm_vn', segmentId: 'seg-9' });
  });

  it.each([
    [403, 'advisor-disabled'],
    [400, 'invalid-scope'],
    [502, 'engine-unavailable'],
  ])('maps HTTP %i → reason %s', async (status, reason) => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.postJson).mockRejectedValue(new ServerClientError(status, { error: 'x' }));
    const res = await decompose({ game_id: 'cfm_vn' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason });
  });

  it('surfaces engine "blocked" without failing the call', async () => {
    vi.mocked(serverClient.postJson).mockResolvedValue({ ...DIAGNOSIS, blocked: { reason: 'cube read failed' } });
    const res = await decompose({ game_id: 'cfm_vn' }, makeCtx());
    if (!res.ok) throw new Error('expected ok');
    expect(res.blocked).toEqual({ reason: 'cube read failed' });
  });
});

describe('get_metric_benchmark handler', () => {
  it('passes the metric through and returns the benchmark', async () => {
    const payload = {
      metric: 'arppu_vnd',
      available: true,
      external: { value: 5, unit: '%', source: 'X', citation: 'Y' },
      internal: { band: 'p50', value: 42, computedAt: '2026-06-18' },
    };
    vi.mocked(serverClient.getJson).mockResolvedValue(payload);
    const res = await benchmark({ metric: 'arppu_vnd' }, makeCtx());
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) throw new Error('expected ok');
    expect(res.benchmark.available).toBe(true);
    const path = vi.mocked(serverClient.getJson).mock.calls[0][0];
    expect(path).toContain('metric=arppu_vnd');
  });

  it('returns engine-unavailable on server error', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(new ServerClientError(500, {}));
    const res = await benchmark({ metric: 'arppu_vnd' }, makeCtx());
    expect(res).toMatchObject({ ok: false, reason: 'engine-unavailable' });
  });
});
