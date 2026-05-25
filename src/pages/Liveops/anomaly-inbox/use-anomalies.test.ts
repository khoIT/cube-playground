/**
 * Tests for useAnomalies hook:
 * - polling on mount
 * - optimistic ack (row removed, restored on error)
 * - optimistic snooze (row removed, restored on error)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnomalies, __resetAnomaliesCache, type AnomalyRow } from './use-anomalies';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    id: 1,
    game: 'cfm',
    metric: 'active_daily.dau',
    severity: 'high',
    baseline: 1000,
    observed: 5000,
    ts: '2024-01-15',
    status: 'open',
    snooze_until: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── fetch mock helpers ────────────────────────────────────────────────────────

function mockFetchSuccess(rows: AnomalyRow[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ anomalies: rows }),
  }));
}

function mockFetchError() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useAnomalies', () => {
  beforeEach(() => {
    __resetAnomaliesCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __resetAnomaliesCache();
  });

  // Helper: flush only the microtask queue (resolves fetch promises without
  // triggering the 60s polling interval, which would cause infinite-loop with
  // runAllTimers).
  async function flushFetch() {
    await act(async () => {
      // Advance by 1ms to trigger any leading setImmediate/setTimeout(0) then
      // drain the microtask queue.
      await vi.advanceTimersByTimeAsync(1);
    });
  }

  it('starts loading and populates anomalies on successful fetch', async () => {
    const row = makeRow();
    mockFetchSuccess([row]);

    const { result } = renderHook(() => useAnomalies('cfm'));
    expect(result.current.loading).toBe(true);

    await flushFetch();

    expect(result.current.loading).toBe(false);
    expect(result.current.anomalies).toHaveLength(1);
    expect(result.current.anomalies[0].id).toBe(1);
  });

  it('sets error state when fetch fails', async () => {
    mockFetchError();

    const { result } = renderHook(() => useAnomalies('cfm'));
    await flushFetch();

    expect(result.current.error).toMatch(/HTTP 500/i);
    expect(result.current.anomalies).toHaveLength(0);
  });

  it('optimistic ack removes row; rolls back on server error', async () => {
    const row = makeRow({ id: 42 });
    mockFetchSuccess([row]);

    const { result } = renderHook(() => useAnomalies('cfm'));
    await flushFetch();
    expect(result.current.anomalies).toHaveLength(1);

    // Now make ack call fail
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await act(async () => {
      await expect(result.current.ack(42)).rejects.toBeDefined();
    });

    // Row should be rolled back
    expect(result.current.anomalies).toHaveLength(1);
    expect(result.current.anomalies[0].id).toBe(42);
  });

  it('optimistic ack removes row on success', async () => {
    const row = makeRow({ id: 99 });
    mockFetchSuccess([row]);

    const { result } = renderHook(() => useAnomalies('cfm'));
    await flushFetch();

    // Successful ack
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }));

    await act(async () => {
      await result.current.ack(99);
    });

    expect(result.current.anomalies).toHaveLength(0);
  });

  it('optimistic snooze removes row; rolls back on server error', async () => {
    const row = makeRow({ id: 7 });
    mockFetchSuccess([row]);

    const { result } = renderHook(() => useAnomalies('cfm'));
    await flushFetch();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const until = new Date(Date.now() + 3_600_000).toISOString();
    await act(async () => {
      await expect(result.current.snooze(7, until)).rejects.toBeDefined();
    });

    // Rolled back
    expect(result.current.anomalies).toHaveLength(1);
  });

  it('re-fetches after gameId change', async () => {
    const cfmRow = makeRow({ id: 1, game: 'cfm' });
    const jus = makeRow({ id: 2, game: 'jus' });

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ anomalies: [cfmRow] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ anomalies: [jus] }) })
    );

    let gameId = 'cfm';
    const { result, rerender } = renderHook(() => useAnomalies(gameId));
    await flushFetch();
    expect(result.current.anomalies[0].game).toBe('cfm');

    gameId = 'jus';
    rerender();
    await flushFetch();
    expect(result.current.anomalies[0].game).toBe('jus');
  });
});
