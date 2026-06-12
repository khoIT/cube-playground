/**
 * QueryTabs applyNonce behavior — the repeat "Open in Playground" contract:
 *
 *   1. A deeplinked query opens in a new tab (baseline) and a NEW nonce with
 *      the same query re-activates the existing exact-match tab instead of
 *      spawning a duplicate.
 *   2. After the user closes that tab, a NEW nonce re-opens the query in a
 *      fresh tab (previously swallowed by the once-per-query guard).
 *   3. Without a nonce, the legacy once-per-query behavior is preserved.
 *
 * Note: on a first-ever visit (no persisted tabs) QueryTabs seeds the default
 * tab with the URL query, so these tests boot with query=null to establish an
 * empty tab 1, then deliver the deeplink via rerender — mirroring a user who
 * already has a playground session.
 *
 * No tab is ever deleted by the apply logic itself — only user close events
 * remove tabs.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Query } from '@cubejs-client/core';

import { QueryTabs } from '../QueryTabs';
import { ChartRendererStateProvider } from '../ChartRendererStateProvider';

const QUERY: Query = { measures: ['recharge.revenue_vnd'], limit: 100 };

function Harness({ query, nonce }: { query: Query | null; nonce?: string | null }) {
  return (
    <ChartRendererStateProvider>
      <QueryTabs query={query} applyNonce={nonce} gameId="cfm_vn">
        {(tab) => (
          <div data-testid={`pane-${tab.id}`}>{JSON.stringify(tab.query)}</div>
        )}
      </QueryTabs>
    </ChartRendererStateProvider>
  );
}

function tabCount(container: HTMLElement): number {
  return container.querySelectorAll('.ant-tabs-tab').length;
}

function activePaneText(container: HTMLElement): string {
  return (
    container.querySelector('.ant-tabs-tabpane-active [data-testid^="pane-"]')
      ?.textContent ?? ''
  );
}

function closeTab(container: HTMLElement, index: number) {
  const closeBtns = container.querySelectorAll('.ant-tabs-tab-remove');
  fireEvent.click(closeBtns[index]);
}

beforeEach(() => {
  // QueryTabs persists tabs per (workspace, game) in localStorage — isolate tests.
  localStorage.clear();
});

describe('QueryTabs — applyNonce', () => {
  it('opens a deeplinked query in a new tab and re-activates on a new nonce', () => {
    const { container, rerender } = render(<Harness query={null} />);
    expect(tabCount(container)).toBe(1);

    // Deeplink arrives: empty tab 1 + new tab 2 holding the query.
    rerender(<Harness query={QUERY} nonce="n1" />);
    expect(tabCount(container)).toBe(2);
    expect(activePaneText(container)).toContain('recharge.revenue_vnd');

    // Same query + same nonce re-rendered → no duplicate.
    rerender(<Harness query={QUERY} nonce="n1" />);
    expect(tabCount(container)).toBe(2);

    // Same query, NEW nonce (repeat click) → existing tab re-activated, no duplicate.
    rerender(<Harness query={QUERY} nonce="n2" />);
    expect(tabCount(container)).toBe(2);
    expect(activePaneText(container)).toContain('recharge.revenue_vnd');
  });

  it('re-opens the query in a fresh tab after the user closed it', () => {
    const { container, rerender } = render(<Harness query={null} />);
    rerender(<Harness query={QUERY} nonce="n1" />);
    expect(tabCount(container)).toBe(2);

    // User closes the deeplink tab (second strip entry).
    closeTab(container, 1);
    expect(tabCount(container)).toBe(1);
    expect(activePaneText(container)).not.toContain('recharge.revenue_vnd');

    // Repeat click → new nonce → query re-applied into a fresh tab.
    rerender(<Harness query={QUERY} nonce="n3" />);
    expect(tabCount(container)).toBe(2);
    expect(activePaneText(container)).toContain('recharge.revenue_vnd');
  });

  it('does not resurrect a closed tab after a repeat click landed on the active tab', () => {
    const { container, rerender } = render(<Harness query={null} />);
    rerender(<Harness query={QUERY} nonce="n1" />);
    expect(tabCount(container)).toBe(2);

    // Repeat click while the deeplink tab is already active: no-op apply,
    // but the key must still be consumed (the M-class bug left it stale).
    // New object identity mirrors the container re-parsing the URL per render.
    rerender(<Harness query={{ ...QUERY }} nonce="n2" />);
    expect(tabCount(container)).toBe(2);

    // User closes the tab; subsequent re-renders with the SAME nonce (the
    // container re-renders on tab change) must NOT bring it back.
    closeTab(container, 1);
    expect(tabCount(container)).toBe(1);
    rerender(<Harness query={{ ...QUERY }} nonce="n2" />);
    expect(tabCount(container)).toBe(1);
    expect(activePaneText(container)).not.toContain('recharge.revenue_vnd');
  });

  it('without a nonce, the same query applies only once (legacy behavior)', () => {
    const { container, rerender } = render(<Harness query={null} />);
    rerender(<Harness query={QUERY} />);
    expect(tabCount(container)).toBe(2);

    closeTab(container, 1);
    expect(tabCount(container)).toBe(1);

    // Same query re-rendered with no nonce → swallowed by the applied-key guard.
    rerender(<Harness query={QUERY} />);
    expect(tabCount(container)).toBe(1);
  });
});
