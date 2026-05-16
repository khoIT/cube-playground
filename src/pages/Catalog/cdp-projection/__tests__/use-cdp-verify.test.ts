import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCdpVerify } from '../use-cdp-verify';
import type { CdpMetricPayload } from '../types';

const payload: CdpMetricPayload = {
  game_id: 'bal_vn',
  metric_name: 'user_count',
  metric_codename: 'user_count',
  source: 'iceberg.ballistar_vn.mf_users',
  expression: 'COUNT(*)',
  dimensions: ['country', 'signup_source'],
  filter: '',
};

const fullRecord = {
  ...payload,
  materialize: false,
  schedule: '',
  created_at: '2026-05-17T17:15:00+07:00',
  updated_at: '2026-05-17T17:15:00+07:00',
};

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCdpVerify', () => {
  it('initial state is idle', () => {
    const { result } = renderHook(() => useCdpVerify(payload));
    expect(result.current.state.kind).toBe('idle');
  });

  it('200 SUCCESS w/ equal payload → available', async () => {
    mockFetchOnce(200, { status: 'SUCCESS', error: null, data: fullRecord });
    const { result } = renderHook(() => useCdpVerify(payload));
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe('available');
  });

  it('200 SUCCESS w/ different expression → mismatch w/ diff entry', async () => {
    mockFetchOnce(200, { status: 'SUCCESS', error: null, data: { ...fullRecord, expression: 'SUM(amount_usd)' } });
    const { result } = renderHook(() => useCdpVerify(payload));
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe('mismatch');
    if (result.current.state.kind === 'mismatch') {
      expect(result.current.state.diff.length).toBe(1);
      expect(result.current.state.diff[0].field).toBe('expression');
    }
  });

  it('404 → missing', async () => {
    mockFetchOnce(404, { status: 'ERROR', error: { code: 'METRIC_NOT_FOUND' } });
    const { result } = renderHook(() => useCdpVerify(payload));
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe('missing');
  });

  it('500 → error w/ message', async () => {
    mockFetchOnce(500, { status: 'ERROR', error: { code: 'INTERNAL_ERROR', message: 'boom' } });
    const { result } = renderHook(() => useCdpVerify(payload));
    await act(async () => { await result.current.check(); });
    expect(result.current.state.kind).toBe('error');
    if (result.current.state.kind === 'error') {
      expect(result.current.state.message).toContain('boom');
    }
  });

  it('stale check is dropped — second invocation wins', async () => {
    let resolve1: (v: any) => void = () => {};
    const fetchMock = vi.fn();
    fetchMock.mockImplementationOnce(() => new Promise((r) => { resolve1 = r; }));
    fetchMock.mockImplementationOnce(async () => ({
      ok: true, status: 200, json: async () => ({ status: 'SUCCESS', data: fullRecord }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useCdpVerify(payload));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.check();
      second = result.current.check();
    });
    // Now resolve first with stale missing — should be ignored
    await act(async () => {
      resolve1({ ok: false, status: 404, json: async () => ({ status: 'ERROR', error: { code: 'METRIC_NOT_FOUND' } }) });
      await first;
      await second;
    });
    expect(result.current.state.kind).toBe('available');
  });
});
