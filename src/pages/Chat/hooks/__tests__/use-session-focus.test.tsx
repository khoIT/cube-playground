/**
 * useSessionFocus — smoke tests covering:
 *   - GET on mount returns the bag + hasSdkResume flag
 *   - forget() calls DELETE and clears local state on success
 *   - null sessionId short-circuits without hitting the network
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useSessionFocus } from '../use-session-focus';

interface ProbeProps {
  sessionId: string | null;
}

function Probe({ sessionId }: ProbeProps) {
  const { focus, hasSdkResume, forget, loading } = useSessionFocus(sessionId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="metric">{focus?.metric?.value ?? '_'}</span>
      <span data-testid="resume">{String(hasSdkResume)}</span>
      <button data-testid="forget" onClick={() => { void forget(); }}>
        forget
      </button>
    </div>
  );
}

beforeEach(() => {
  // Each test installs its own fetch stub.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSessionFocus', () => {
  it('GETs the focus bag on mount', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          focus: { metric: { value: 'arpu', phrase: 'doanh thu' } },
          hasSdkResume: true,
        }),
        { status: 200 },
      ),
    );
    render(<Probe sessionId="sess-1" />);
    await waitFor(() => expect(screen.getByTestId('metric').textContent).toBe('arpu'));
    expect(screen.getByTestId('resume').textContent).toBe('true');
    expect(spy).toHaveBeenCalledWith(
      '/api/chat/sessions/sess-1/focus',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('forget() POSTs DELETE and clears local state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'DELETE' && url.endsWith('/focus')) {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ focus: { metric: { value: 'arpu' } }, hasSdkResume: false }),
        { status: 200 },
      );
    });
    render(<Probe sessionId="sess-1" />);
    await waitFor(() => expect(screen.getByTestId('metric').textContent).toBe('arpu'));
    await act(async () => {
      screen.getByTestId('forget').click();
    });
    await waitFor(() => expect(screen.getByTestId('metric').textContent).toBe('_'));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/chat/sessions/sess-1/focus',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('short-circuits when sessionId is null without calling fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    render(<Probe sessionId={null} />);
    // Give the effect a tick to settle.
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(spy).not.toHaveBeenCalled();
  });
});
