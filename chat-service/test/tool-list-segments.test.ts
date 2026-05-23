/**
 * Tests for the list_segments tool handler.
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
import { handler } from '../src/tools/list-segments.js';

const FIXTURE_SEGMENTS = [
  {
    id: 'seg-001',
    name: 'High Value Players',
    type: 'predicate',
    uid_count: 1500,
    updated_at: '2026-05-20T10:00:00.000Z',
    owner: 'owner1',
    game_id: 'ptg',
  },
  {
    id: 'seg-002',
    name: 'Churned Users',
    type: 'manual',
    uid_count: 320,
    updated_at: '2026-05-18T08:00:00.000Z',
    owner: 'owner1',
    game_id: 'ptg',
  },
];

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

describe('list_segments handler', () => {
  it('returns trimmed segment list on 200', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_SEGMENTS);

    const result = await handler({ game: 'ptg' }, makeCtx());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected ok');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      id: 'seg-001',
      name: 'High Value Players',
      type: 'predicate',
      uid_count: 1500,
      last_refreshed_at: '2026-05-20T10:00:00.000Z',
    });
  });

  it('returns empty array when no segments exist', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue([]);

    const result = await handler({ game: 'ptg' }, makeCtx());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected ok');
    expect(result.segments).toHaveLength(0);
  });

  it('returns server_error on 500', async () => {
    const { ServerClientError } = await import('../src/services/server-client.js');
    vi.mocked(serverClient.getJson).mockRejectedValue(
      new ServerClientError(500, { error: 'internal server error' }),
    );

    const result = await handler({ game: 'ptg' }, makeCtx());

    expect(result).toMatchObject({ ok: false, error: 'server_error' });
    if (result.ok) throw new Error('expected error');
    expect(result.detail.status).toBe(500);
  });

  it('passes game_id and owner as query params', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue([]);

    await handler({ game: 'ptg' }, makeCtx());

    const calledPath = vi.mocked(serverClient.getJson).mock.calls[0][0] as string;
    expect(calledPath).toContain('game_id=ptg');
    expect(calledPath).toContain('owner=owner1');
  });

  it('trims raw segment to expected fields only', async () => {
    vi.mocked(serverClient.getJson).mockResolvedValue(FIXTURE_SEGMENTS);

    const result = await handler({ game: 'ptg' }, makeCtx());
    if (!result.ok) throw new Error('expected ok');

    const seg = result.segments[0];
    expect(seg).not.toHaveProperty('owner');
    expect(seg).not.toHaveProperty('game_id');
    expect(seg).toHaveProperty('id');
    expect(seg).toHaveProperty('name');
    expect(seg).toHaveProperty('type');
  });
});
