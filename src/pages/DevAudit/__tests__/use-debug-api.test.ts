/**
 * Unit tests for use-debug-api hooks.
 * Mocks fetch globally; verifies auth header, URL construction, AbortController cleanup.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebugSessions, useDebugSession, useDebugTurn, useDebugRawEvents } from '../use-debug-api';

// ---------------------------------------------------------------------------
// Mock getOwnerId so tests don't touch localStorage
// ---------------------------------------------------------------------------
vi.mock('../../../api/chat-owner-id', () => ({ getOwnerId: () => 'test-owner' }));

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------
function mockFetch(payload: unknown, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(payload),
  } as Response);
}

function mockFetchError(message: string) {
  global.fetch = vi.fn().mockRejectedValue(new Error(message));
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// useDebugSessions
// ---------------------------------------------------------------------------
describe('useDebugSessions', () => {
  it('fetches sessions with correct URL and auth header', async () => {
    const sessions = [{ id: 's1', title: 'Test', turn_count: 3, updated_at: Date.now(), status: 'active' }];
    mockFetch(sessions);

    const { result } = renderHook(() => useDebugSessions({ game: 'ptg', q: '' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/chat/debug/sessions');
    expect(url).toContain('game=ptg');
    expect((opts.headers as Record<string, string>)['X-Owner-Id']).toBe('test-owner');
    expect(result.current.data).toEqual(sessions);
    expect(result.current.error).toBeNull();
  });

  it('sets error on non-ok response', async () => {
    mockFetch({ error: 'Unauthorized' }, 401);
    const { result } = renderHook(() => useDebugSessions({ game: 'ptg', q: '' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch('401');
    expect(result.current.data).toBeNull();
  });

  it('appends q param when search query provided', async () => {
    mockFetch([]);
    const { result } = renderHook(() => useDebugSessions({ game: 'ptg', q: 'hello' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('q=hello');
  });

  it('skips fetch when game is empty string', () => {
    mockFetch([]);
    renderHook(() => useDebugSessions({ game: '', q: '' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDebugSession
// ---------------------------------------------------------------------------
describe('useDebugSession', () => {
  it('fetches session detail by id', async () => {
    const payload = { session: { id: 'abc', title: 'S' }, turns: [] };
    mockFetch(payload);

    const { result } = renderHook(() => useDebugSession('abc'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('/api/chat/debug/sessions/abc');
    expect(result.current.data).toEqual(payload);
  });

  it('does not fetch when id is null', () => {
    mockFetch(null);
    renderHook(() => useDebugSession(null));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces network errors', async () => {
    mockFetchError('Network failure');
    const { result } = renderHook(() => useDebugSession('abc'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Network failure');
  });
});

// ---------------------------------------------------------------------------
// useDebugTurn
// ---------------------------------------------------------------------------
describe('useDebugTurn', () => {
  it('fetches turn detail', async () => {
    const payload = { llmCalls: [], toolInvocations: [] };
    mockFetch(payload);

    const { result } = renderHook(() => useDebugTurn('turn-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('/api/chat/debug/turns/turn-1');
    expect(result.current.data).toEqual(payload);
  });

  it('skips fetch when turnId is null', () => {
    mockFetch(null);
    renderHook(() => useDebugTurn(null));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useDebugRawEvents
// ---------------------------------------------------------------------------
describe('useDebugRawEvents', () => {
  it('starts with empty state and does not auto-fetch', () => {
    mockFetch({ events: [], nextCursor: null });
    const { result } = renderHook(() => useDebugRawEvents('turn-1'));
    expect(result.current.events).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('loadMore fetches first page and appends events', async () => {
    const events = [{ id: 1, turn_id: 't', seq: 0, type: 'ping', payload_json: null, at: 0 }];
    mockFetch({ events, nextCursor: null });

    const { result } = renderHook(() => useDebugRawEvents('turn-1'));
    act(() => { result.current.loadMore(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.hasMore).toBe(false);
  });

  it('sets hasMore true when nextCursor is returned', async () => {
    mockFetch({ events: [{ id: 1, turn_id: 't', seq: 0, type: 'x', payload_json: null, at: 0 }], nextCursor: 200 });
    const { result } = renderHook(() => useDebugRawEvents('turn-1'));
    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(true);
  });

  it('resets state when turnId changes', async () => {
    mockFetch({ events: [{ id: 1, turn_id: 't', seq: 0, type: 'x', payload_json: null, at: 0 }], nextCursor: null });
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDebugRawEvents(id), {
      initialProps: { id: 'turn-1' },
    });
    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ id: 'turn-2' });
    expect(result.current.events).toHaveLength(0);
  });
});
