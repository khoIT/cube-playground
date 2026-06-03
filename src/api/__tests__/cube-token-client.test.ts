import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the shared client so the test asserts the delegation contract (and so the
// active x-cube-workspace/x-cube-game headers, which apiFetch injects, ride
// along) without pulling in workspace/game/localStorage plumbing.
vi.mock('../api-client', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api-client';
import { cubeTokenClient } from '../cube-token-client';

const mockApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe('cubeTokenClient.get', () => {
  it('returns null for empty gameId without hitting the network', async () => {
    const res = await cubeTokenClient.get('');
    expect(res).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('delegates to apiFetch with the game query and returns its result', async () => {
    mockApiFetch.mockResolvedValueOnce({ token: 'abc.def.ghi', source: 'minted' });
    const res = await cubeTokenClient.get('ptg');
    expect(res).toEqual({ token: 'abc.def.ghi', source: 'minted' });
    // Path + query passed via apiFetch — which attaches x-cube-workspace so the
    // server resolves the mint mode from the SPA's active workspace, not its default.
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/playground/cube-token',
      expect.objectContaining({ query: { game: 'ptg' } }),
    );
  });

  it('forwards the abort signal', async () => {
    const signal = new AbortController().signal;
    mockApiFetch.mockResolvedValueOnce({ token: 'x', source: 'env' });
    await cubeTokenClient.get('ptg', signal);
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/playground/cube-token',
      expect.objectContaining({ signal }),
    );
  });

  it('returns null when apiFetch rejects (404 envelope, network, or abort)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network'));
    const res = await cubeTokenClient.get('ptg');
    expect(res).toBeNull();
  });
});
