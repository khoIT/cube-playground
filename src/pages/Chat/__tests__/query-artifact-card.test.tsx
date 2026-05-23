/**
 * Tests for QueryArtifactCard:
 *   1. session-storage artifact → writes sessionStorage + calls history.push
 *   2. inline artifact → no sessionStorage write + calls history.push
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { QueryArtifactCard } from '../components/query-artifact-card';
import type { QueryArtifact } from '../../../api/chat-sse-client';

// ---------------------------------------------------------------------------
// Stub useHistory — react-router-dom v5 reads history from context.
// We mount inside MemoryRouter which provides it.
// ---------------------------------------------------------------------------

const pushSpy = vi.fn();

// Wrap in MemoryRouter so useHistory() resolves correctly.
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={['/chat/test']}>
      <Route path="/chat/test">{children}</Route>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_STORAGE_ARTIFACT: QueryArtifact = {
  id: 'art-ss-1',
  title: 'Daily Revenue',
  summary: 'Revenue last 7 days',
  query: { measures: ['recharge.revenue_vnd'] },
  source: 'business-metric',
  sourceRef: { id: 'revenue' },
  deeplinkUrl: '#/build?from-chat-artifact=art-ss-1',
  deeplinkVia: 'session-storage',
  payload: { measures: ['recharge.revenue_vnd'], timeDimensions: [] },
};

const INLINE_ARTIFACT: QueryArtifact = {
  id: 'art-inline-1',
  title: 'MAU Count',
  summary: 'Monthly active users',
  query: { measures: ['users.mau'] },
  source: 'raw',
  deeplinkUrl: '#/build?query=%7B%22measures%22%3A%5B%22users.mau%22%5D%7D',
  deeplinkVia: 'inline',
  payload: null,
};

// ---------------------------------------------------------------------------
// Mock useHistory push
// ---------------------------------------------------------------------------

// We spy on MemoryRouter's history via a capture component.
// Simpler: intercept via a custom hook override isn't needed — MemoryRouter
// wires history, but we can't easily spy on its internal push. Instead we
// test via react-router's <Route> location changes observed with a render prop.
// For simplicity, we spy on window.history.pushState as a proxy — but the
// cleanest approach for v5 is to capture with a spy component.

// Actually the cleanest v5 approach: inject the history object directly.
import { createMemoryHistory } from 'history';
import { Router } from 'react-router-dom';

function RouterWithSpy({
  history,
  children,
}: {
  history: ReturnType<typeof createMemoryHistory>;
  children: React.ReactNode;
}) {
  return (
    <Router history={history}>
      <Route path="/">{children}</Route>
    </Router>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QueryArtifactCard', () => {
  let memHistory: ReturnType<typeof createMemoryHistory>;

  beforeEach(() => {
    memHistory = createMemoryHistory({ initialEntries: ['/'] });
    sessionStorage.clear();
    pushSpy.mockClear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('session-storage artifact: writes sessionStorage then navigates', () => {
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={SESSION_STORAGE_ARTIFACT} />
      </RouterWithSpy>,
    );

    const btn = screen.getByRole('button', { name: /open in playground/i });
    fireEvent.click(btn);

    // sessionStorage must be written BEFORE navigation.
    const stored = sessionStorage.getItem(
      `gds-cube:pending-chat-deeplink:${SESSION_STORAGE_ARTIFACT.id}`,
    );
    expect(stored).toBe(JSON.stringify(SESSION_STORAGE_ARTIFACT.payload));

    // History should have navigated to the deeplink path (strip leading '#').
    const expectedPath = SESSION_STORAGE_ARTIFACT.deeplinkUrl.slice(1); // '/build?from-chat-artifact=art-ss-1'
    expect(memHistory.location.pathname + memHistory.location.search).toBe(expectedPath);
  });

  it('inline artifact: does NOT write sessionStorage, navigates correctly', () => {
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={INLINE_ARTIFACT} />
      </RouterWithSpy>,
    );

    const btn = screen.getByRole('button', { name: /open in playground/i });
    fireEvent.click(btn);

    // No sessionStorage entry for inline artifacts.
    const stored = sessionStorage.getItem(
      `gds-cube:pending-chat-deeplink:${INLINE_ARTIFACT.id}`,
    );
    expect(stored).toBeNull();

    // History navigated to the inline deeplink path.
    const expectedPath = INLINE_ARTIFACT.deeplinkUrl.slice(1);
    const actualPath =
      memHistory.location.pathname + memHistory.location.search;
    expect(actualPath).toBe(expectedPath);
  });

  it('calls onClick callback after navigation', () => {
    const onClickSpy = vi.fn();
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={INLINE_ARTIFACT} onClick={onClickSpy} />
      </RouterWithSpy>,
    );

    fireEvent.click(screen.getByRole('button', { name: /open in playground/i }));
    expect(onClickSpy).toHaveBeenCalledOnce();
  });

  it('renders title, summary, and source badge', () => {
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={SESSION_STORAGE_ARTIFACT} />
      </RouterWithSpy>,
    );

    expect(screen.getByText('Daily Revenue')).toBeTruthy();
    expect(screen.getByText('Revenue last 7 days')).toBeTruthy();
    expect(screen.getByText('Metric')).toBeTruthy();
  });
});
