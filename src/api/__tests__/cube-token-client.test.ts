import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cubeTokenClient } from '../cube-token-client';

const origFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as any;
});

afterEach(() => {
  global.fetch = origFetch;
});

describe('cubeTokenClient.get', () => {
  it('returns null for empty gameId without hitting the network', async () => {
    const res = await cubeTokenClient.get('');
    expect(res).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses a successful response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'abc.def.ghi', source: 'minted' }),
    });
    const res = await cubeTokenClient.get('ptg');
    expect(res).toEqual({ token: 'abc.def.ghi', source: 'minted' });
    expect((global.fetch as any).mock.calls[0][0]).toBe(
      '/api/playground/cube-token?game=ptg',
    );
  });

  it('returns null on non-2xx', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 404 });
    const res = await cubeTokenClient.get('unknown');
    expect(res).toBeNull();
  });

  it('returns null when fetch throws (network or AbortError)', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('network'));
    const res = await cubeTokenClient.get('ptg');
    expect(res).toBeNull();
  });

  it('URL-encodes the game id', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'x', source: 'env' }),
    });
    await cubeTokenClient.get('cfm vn');
    expect((global.fetch as any).mock.calls[0][0]).toBe(
      '/api/playground/cube-token?game=cfm%20vn',
    );
  });
});
