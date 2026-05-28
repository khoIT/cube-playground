/**
 * Tests for the get_segment tool handler.
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
import { handler } from '../src/tools/get-segment.js';

const FIXTURE_SEGMENT = {
  id: 'seg-001',
  name: 'High Value Players',
  type: 'predicate',
  cube: 'Players',
  uid_count: 1500,
  uid_list: ['uid-1', 'uid-2', 'uid-3'],
  updated_at: '2026-05-20T10:00:00.000Z',
  predicate_tree: {
    op: 'and',
    children: [{ field: 'ltv', op: 'gt', value: 100 }],
  },
  owner: 'owner1',
  game_id: 'ptg',
  card_cache: null,
};

function makeCtx(): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ptg',
    cubeToken: 'Bearer tok',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: new EventEmitter(),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('get_segment handler', () => {
  it('returns trimmed segment on 200', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_SEGMENT);

    const result = await handler({ id: 'seg-001' }, makeCtx());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected ok');
    expect(result.segment).toMatchObject({
      id: 'seg-001',
      name: 'High Value Players',
      type: 'predicate',
      primary_cube: 'Players',
      uid_count: 1500,
      last_refreshed_at: '2026-05-20T10:00:00.000Z',
    });
    expect(result.segment.predicate_json).toMatchObject({ op: 'and' });
    expect(result.segment.sample_uids).toEqual(['uid-1', 'uid-2', 'uid-3']);
  });

  it('returns not_found on 404', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(
      new ServerClientError(404, { error: { code: 'NOT_FOUND' } }),
    );

    const result = await handler({ id: 'seg-nonexistent' }, makeCtx());

    expect(result).toMatchObject({ ok: false, error: 'not_found' });
    if (result.ok) throw new Error('expected error');
    if (!('id' in result.detail)) throw new Error('expected not_found detail');
    expect(result.detail.id).toBe('seg-nonexistent');
  });

  it('caps sample_uids at 20 entries', async () => {
    const manyUids = Array.from({ length: 50 }, (_, i) => `uid-${i}`);
    vi.mocked(serverClient.getJson).mockResolvedValue({
      ...FIXTURE_SEGMENT,
      uid_list: manyUids,
    });

    const result = await handler({ id: 'seg-001' }, makeCtx());
    if (!result.ok) throw new Error('expected ok');
    expect(result.segment.sample_uids).toHaveLength(20);
  });

  it('trims internal fields from response', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_SEGMENT);

    const result = await handler({ id: 'seg-001' }, makeCtx());
    if (!result.ok) throw new Error('expected ok');

    expect(result.segment).not.toHaveProperty('owner');
    expect(result.segment).not.toHaveProperty('game_id');
    expect(result.segment).not.toHaveProperty('card_cache');
    expect(result.segment).not.toHaveProperty('uid_list');
  });
});
