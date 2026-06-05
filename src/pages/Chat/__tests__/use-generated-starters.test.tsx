/**
 * useGeneratedStarters: generated set adopted when the backend returns one,
 * static library on fallback/error/empty, re-fetch on game change.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useGeneratedStarters } from '../library/use-generated-starters';
import { STARTER_QUESTIONS } from '../library/starter-questions';
import { GAME_CHANGE_EVENT } from '../../../components/Header/active-game-storage';

const gameHolder: { game: string | null } = { game: 'cfm_vn' };

vi.mock('../../../components/Header/active-game-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../components/Header/active-game-storage')>();
  return { ...actual, getActiveGameId: () => gameHolder.game };
});

vi.mock('../../../api/chat-auth-headers', () => ({
  chatHeaders: (extra?: Record<string, string>) => ({ 'X-Owner-Id': 'test', ...extra }),
}));

function Probe() {
  const { starters, source, loading } = useGeneratedStarters();
  return (
    <div data-testid="probe" data-source={source} data-loading={String(loading)}>
      {starters.map((s) => (
        <span key={s.id} data-starter={s.id} />
      ))}
    </div>
  );
}

const GENERATED = [
  { id: 'g1', text: 'Q1?', topicTags: ['liveops'], categoryTags: ['explore'], targetCatalogIds: ['a.b'] },
  { id: 'g2', text: 'Q2?', topicTags: ['monetization'], categoryTags: ['compare'], targetCatalogIds: ['a.c'] },
];

describe('useGeneratedStarters', () => {
  beforeEach(() => {
    gameHolder.game = 'cfm_vn';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (url: string) => Promise<Response>) {
    const spy = vi.fn(impl);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  function jsonResponse(body: unknown, status = 200): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  }

  it('adopts the generated set from the backend', async () => {
    stubFetch(() => jsonResponse({ questions: GENERATED, source: 'template' }));
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.source).toBe('template');
    });
    expect(document.querySelectorAll('[data-starter]').length).toBe(2);
  });

  it('falls back to the static library on fetch error', async () => {
    stubFetch(() => Promise.reject(new Error('down')));
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.loading).toBe('false');
    });
    expect(screen.getByTestId('probe').dataset.source).toBe('static-fallback');
    expect(document.querySelectorAll('[data-starter]').length).toBe(STARTER_QUESTIONS.length);
  });

  it('falls back when the backend says static-fallback or returns empty', async () => {
    stubFetch(() => jsonResponse({ questions: [], source: 'static-fallback' }));
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.loading).toBe('false');
    });
    expect(screen.getByTestId('probe').dataset.source).toBe('static-fallback');
    expect(document.querySelectorAll('[data-starter]').length).toBe(STARTER_QUESTIONS.length);
  });

  it('uses static library without fetching when no game is active', async () => {
    gameHolder.game = null;
    const spy = stubFetch(() => jsonResponse({ questions: GENERATED, source: 'template' }));
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.loading).toBe('false');
    });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').dataset.source).toBe('static-fallback');
  });

  it('re-fetches when the active game changes', async () => {
    const spy = stubFetch((url) =>
      url.includes('game=ballistar')
        ? jsonResponse({ questions: [GENERATED[1]], source: 'llm' })
        : jsonResponse({ questions: GENERATED, source: 'template' }),
    );
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.source).toBe('template');
    });

    gameHolder.game = 'ballistar';
    act(() => {
      window.dispatchEvent(new CustomEvent(GAME_CHANGE_EVENT));
    });

    await waitFor(() => {
      expect(screen.getByTestId('probe').dataset.source).toBe('llm');
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[data-starter]').length).toBe(1);
  });
});
