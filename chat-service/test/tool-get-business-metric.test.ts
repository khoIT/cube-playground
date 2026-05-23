/**
 * Tests for the get_business_metric tool handler.
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
import { handler } from '../src/tools/get-business-metric.js';

const FIXTURE_METRIC = {
  id: 'roas',
  label: 'Return on Ad Spend',
  description: 'Revenue divided by ad spend',
  tier: 1,
  domain: 'marketing',
  owner: 'growth-team',
  trust: 'certified',
  formula: { type: 'ratio', numerator: 'Revenue.total', denominator: 'Ads.spend' },
  synonyms: ['return on ad spend'],
  related_concepts: ['cpa', 'cpi'],
  unit: 'ratio',
  game_compatibility: { required_cubes: ['Revenue', 'Ads'] },
};

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ptg',
    cubeToken: 'Bearer tok',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('get_business_metric handler', () => {
  it('returns ok with full metric object on 200', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_METRIC);

    const result = await handler({ id: 'roas' }, makeCtx());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected ok');
    expect(result.metric).toMatchObject({ id: 'roas', label: 'Return on Ad Spend' });
  });

  it('returns not_found on 404', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(
      new ServerClientError(404, { error: { code: 'NOT_FOUND' } }),
    );

    const result = await handler({ id: 'nonexistent_metric' }, makeCtx());

    expect(result).toMatchObject({ ok: false, error: 'not_found' });
    if (result.ok) throw new Error('expected error');
    if (!('id' in result.detail)) throw new Error('expected not_found detail');
    expect(result.detail.id).toBe('nonexistent_metric');
  });

  it('returns server_error on 500', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(
      new ServerClientError(500, { error: 'internal' }),
    );

    const result = await handler({ id: 'roas' }, makeCtx());

    expect(result).toMatchObject({ ok: false, error: 'server_error' });
    if (result.ok) throw new Error('expected error');
    if (!('status' in result.detail)) throw new Error('expected server_error detail');
    expect(result.detail.status).toBe(500);
  });

  it('URL-encodes the metric id in the request path', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_METRIC);

    await handler({ id: 'my metric/special' }, makeCtx());

    const calledPath = vi.mocked(serverClient.getJson).mock.calls[0][0];
    expect(calledPath).toContain(encodeURIComponent('my metric/special'));
  });
});
