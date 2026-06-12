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

// Leaderboard artifact: 1 measure + entity/attribute dims, > 12 rows → the
// card should default to the table (showing all columns with meta-resolved
// labels), not a single-series chart.
const LEADERBOARD_ARTIFACT: QueryArtifact = {
  id: 'art-lb-1',
  title: 'Top whales by lifetime value',
  summary: 'Whales inactive 30+ days, by LTV',
  query: { measures: ['mf_users.ltv_total_vnd'] },
  source: 'raw',
  deeplinkUrl: '#/build?query=%7B%7D',
  deeplinkVia: 'inline',
  payload: null,
  chart: {
    id: 'chart-lb-1',
    truncated: false,
    originalRowCount: 100,
    spec: {
      type: 'scatter',
      title: 'LTV vs days since last active',
      data: Array.from({ length: 14 }, (_, i) => ({
        'mf_users.user_id': `u${i}`,
        'mf_users.ltv_total_vnd': 1_000_000 * (14 - i),
        'mf_users.days_since_last_active': 30 + i,
      })),
      encoding: {
        category: 'mf_users.days_since_last_active',
        value: 'mf_users.ltv_total_vnd',
      },
    },
    columns: [
      { key: 'mf_users.user_id', label: 'User ID', dataType: 'string', kind: 'dimension' },
      { key: 'mf_users.ltv_total_vnd', label: 'Total LTV (VND)', dataType: 'number', kind: 'measure' },
      { key: 'mf_users.days_since_last_active', label: 'Days since last active', dataType: 'number', kind: 'dimension' },
    ],
  },
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

    // History should have navigated to the deeplink path (strip leading '#'),
    // with a per-click nonce appended so the playground re-consumes repeat clicks.
    const expectedPath = SESSION_STORAGE_ARTIFACT.deeplinkUrl.slice(1); // '/build?from-chat-artifact=art-ss-1'
    const actualPath = memHistory.location.pathname + memHistory.location.search;
    expect(actualPath.startsWith(`${expectedPath}&n=`)).toBe(true);
  });

  it('repeat click: re-writes the consumed payload and mints a fresh nonce', () => {
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={SESSION_STORAGE_ARTIFACT} />
      </RouterWithSpy>,
    );
    const btn = screen.getByRole('button', { name: /open in playground/i });
    const storageKey = `gds-cube:pending-chat-deeplink:${SESSION_STORAGE_ARTIFACT.id}`;

    fireEvent.click(btn);
    const firstSearch = memHistory.location.search;
    // Simulate the playground consuming the payload (it removes the key).
    sessionStorage.removeItem(storageKey);

    fireEvent.click(btn);
    // Payload restored for the second navigation…
    expect(sessionStorage.getItem(storageKey)).toBe(
      JSON.stringify(SESSION_STORAGE_ARTIFACT.payload),
    );
    // …under a distinct nonce, so the consume guard treats it as a new click.
    expect(memHistory.location.search).not.toBe(firstSearch);
    expect(memHistory.location.search).toContain('&n=');
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

    // History navigated to the inline deeplink path (+ per-click nonce).
    const expectedPath = INLINE_ARTIFACT.deeplinkUrl.slice(1);
    const actualPath =
      memHistory.location.pathname + memHistory.location.search;
    expect(actualPath.startsWith(`${expectedPath}&n=`)).toBe(true);
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

  it('leaderboard chart defaults to the table view with meta-resolved labels', () => {
    render(
      <RouterWithSpy history={memHistory}>
        <QueryArtifactCard artifact={LEADERBOARD_ARTIFACT} />
      </RouterWithSpy>,
    );

    // Table-first: the view-switcher trigger reads "Data table", not a chart type.
    expect(screen.getByTestId('chart-section-menu-trigger').textContent).toContain('Data table');

    // Headers use the server-resolved column labels (not raw "mf_users.ltv_total_vnd").
    expect(screen.getByText('Total LTV (VND)')).toBeTruthy();
    expect(screen.getByText('Days since last active')).toBeTruthy();
    expect(screen.getByText('User ID')).toBeTruthy();
    // The raw member key must not leak into the header.
    expect(screen.queryByText('mf_users.ltv_total_vnd')).toBeNull();
  });
});
