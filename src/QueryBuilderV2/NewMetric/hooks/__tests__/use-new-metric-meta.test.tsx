import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNewMetricMeta } from '../use-new-metric-meta';
import { AppContext } from '../../../../components/AppContext';

function withAppContext(apiUrl: string | null, token: string | null) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const value: any = { apiUrl, token, playgroundContext: { isCloud: false } };
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useNewMetricMeta', () => {
  it('reports loading then resolved meta from /meta?extended=true', async () => {
    const cubesPayload = {
      cubes: [{ name: 'mf_users', measures: [{ name: 'mf_users.count' }], dimensions: [] }],
    };
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockImplementation(
      async (_url: string) =>
        ({
          ok: true,
          status: 200,
          json: async () => cubesPayload,
        } as unknown as Response)
    );

    const { result } = renderHook(() => useNewMetricMeta(), {
      wrapper: withAppContext('http://localhost:4000/cubejs-api', 'tok-abc'),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.meta?.cubes).toHaveLength(1);
    expect(result.current.meta?.cubes[0].name).toBe('mf_users');
    expect(result.current.cubejsApi).not.toBeNull();
    expect(fetchSpy.mock.calls[0][0]).toContain('/meta?extended=true');
  });

  it('records error when fetch fails', async () => {
    vi.spyOn(global, 'fetch' as any).mockImplementation(
      async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
    );
    const { result } = renderHook(() => useNewMetricMeta(), {
      wrapper: withAppContext('http://localhost:4000/cubejs-api', 'tok-abc'),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/HTTP 500/);
  });

  it('refreshMeta re-fires the fetch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockImplementation(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ cubes: [] }),
        } as unknown as Response)
    );
    const { result } = renderHook(() => useNewMetricMeta(), {
      wrapper: withAppContext('http://localhost:4000/cubejs-api', 'tok-abc'),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const beforeCount = fetchSpy.mock.calls.length;
    act(() => {
      result.current.refreshMeta();
    });
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBe(beforeCount + 1));
  });

  it('returns null api + error when apiUrl missing', async () => {
    const { result } = renderHook(() => useNewMetricMeta(), {
      wrapper: withAppContext(null, null),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('API not configured');
    expect(result.current.cubejsApi).toBeNull();
  });
});
