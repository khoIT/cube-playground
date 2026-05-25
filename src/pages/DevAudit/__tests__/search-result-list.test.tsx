/**
 * Render tests for SearchResultList.
 *
 * Covers: empty state, result rows render, snippet highlight, load more,
 * click callback fires with correct sessionId + turnId.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchResultList } from '../search-result-list';
import type { SearchHit } from '../use-debug-api-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    turnId: 'turn-1',
    sessionId: 'session-1',
    sessionTitle: 'My Session',
    role: 'assistant',
    snippet: 'The revenue metric shows 12k for today.',
    matchSource: 'assistant_text',
    createdAt: new Date().toISOString(),
    starred: false,
    flag: null,
    ...overrides,
  };
}

const noOp = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchResultList', () => {
  it('renders empty state when no results and not loading', () => {
    render(
      <SearchResultList
        results={[]}
        query="revenue"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.getByText(/No turns matched/i)).toBeTruthy();
    expect(screen.getByText(/revenue/)).toBeTruthy();
  });

  it('renders result rows with session title and role badge', () => {
    const hits = [makeHit(), makeHit({ turnId: 'turn-2', sessionTitle: 'Other', role: 'user' })];
    render(
      <SearchResultList
        results={hits}
        query="revenue"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.getByText('My Session')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.getAllByText('assistant')).toHaveLength(1);
    expect(screen.getAllByText('user')).toHaveLength(1);
  });

  it('highlights query term in snippet', () => {
    const hit = makeHit({ snippet: 'The revenue metric shows 12k.', turnId: 'turn-1' });
    render(
      <SearchResultList
        results={[hit]}
        query="revenue"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    // The highlighted span should contain exactly the query term text
    const highlighted = document.querySelector('[style*="amberSoft"], span + span + span');
    // Check via text content — "revenue" should appear in the DOM
    expect(screen.getByText('revenue')).toBeTruthy();
  });

  it('shows star badge for starred hits', () => {
    const hit = makeHit({ starred: true });
    render(
      <SearchResultList
        results={[hit]}
        query="x"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.getByText('★')).toBeTruthy();
  });

  it('calls onSelect with sessionId and turnId when row clicked', () => {
    const onSelect = vi.fn();
    const hit = makeHit({ sessionId: 'sess-abc', turnId: 'turn-xyz' });
    render(
      <SearchResultList
        results={[hit]}
        query="revenue"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('My Session'));
    expect(onSelect).toHaveBeenCalledWith('sess-abc', 'turn-xyz');
  });

  it('shows load more button when hasMore=true', () => {
    const hit = makeHit();
    const onLoadMore = vi.fn();
    render(
      <SearchResultList
        results={[hit]}
        query="revenue"
        isLoading={false}
        error={null}
        hasMore={true}
        onLoadMore={onLoadMore}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    const btn = screen.getByText('Load more results');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows error banner when error is set', () => {
    render(
      <SearchResultList
        results={[]}
        query="q"
        isLoading={false}
        error="Network error"
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.getByText(/Network error/)).toBeTruthy();
  });

  it('does not render empty state when loading', () => {
    render(
      <SearchResultList
        results={[]}
        query="q"
        isLoading={true}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.queryByText(/No turns matched/i)).toBeNull();
  });

  it('shows fallback title when sessionTitle is null', () => {
    const hit = makeHit({ sessionTitle: null, sessionId: 'abcdef12' });
    render(
      <SearchResultList
        results={[hit]}
        query="q"
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={noOp}
        selectedSessionId={null}
        onSelect={noOp}
      />,
    );
    expect(screen.getByText('Session abcdef12')).toBeTruthy();
  });
});
