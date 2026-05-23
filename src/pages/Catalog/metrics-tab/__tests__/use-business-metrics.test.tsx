/**
 * useBusinessMetrics hook tests — success, single-flight dedupe, error.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useBusinessMetrics,
  __resetBusinessMetricsCache,
} from '../use-business-metrics';
import type { BusinessMetric } from '../business-metric-types';

const ONE_METRIC: BusinessMetric = {
  id: 'dau',
  label: 'DAU',
  description: 'Daily active users',
  tier: 1,
  domain: 'engagement',
  owner: 'data@vng',
  trust: 'certified',
  formula: { type: 'measure', ref: 'mf_users.dau' },
};

beforeEach(() => {
  __resetBusinessMetricsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBusinessMetrics', () => {
  it('loads metrics on first mount', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ metrics: [ONE_METRIC] }), { status: 200 }),
      );

    const { result } = renderHook(() => useBusinessMetrics());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.metrics).toEqual([ONE_METRIC]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls via single-flight cache', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ metrics: [ONE_METRIC] }), { status: 200 }),
      );

    const hook1 = renderHook(() => useBusinessMetrics());
    const hook2 = renderHook(() => useBusinessMetrics());

    await waitFor(() => expect(hook1.result.current.loading).toBe(false));
    await waitFor(() => expect(hook2.result.current.loading).toBe(false));

    expect(hook1.result.current.metrics).toEqual([ONE_METRIC]);
    expect(hook2.result.current.metrics).toEqual([ONE_METRIC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('captures non-OK responses as error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    const { result } = renderHook(() => useBusinessMetrics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('HTTP 500');
    expect(result.current.metrics).toEqual([]);
  });

  it('refresh() bypasses the cache and re-fetches', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ metrics: [ONE_METRIC] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ metrics: [] }), { status: 200 }),
      );

    const { result } = renderHook(() => useBusinessMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.metrics).toHaveLength(1);

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.metrics).toEqual([]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
