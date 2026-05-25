/**
 * Tests for CacheDashboardTopQueries:
 * - empty state renders
 * - rows render with correct data
 * - default sort: hits desc
 * - sort toggle: hits asc on second click
 * - sort by dollars saved
 * - click row with session id navigates
 * - click row without session id does not navigate
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CacheDashboardTopQueries } from '../cache-dashboard-top-queries';
import type { TopQueryRow } from '../../../api/cache-effectiveness-types';

// Mock useHistory
const mockPush = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useHistory: () => ({ push: mockPush }),
  };
});

function makeRow(overrides: Partial<TopQueryRow> & { queryKey: string; snippet: string }): TopQueryRow {
  return {
    skill: 'metric-explorer',
    model: 'sonnet',
    hitCount: 1,
    lastHitAt: null,
    dollarsSaved: 0,
    originalSessionId: null,
    originalTurnId: null,
    ...overrides,
  };
}

// dollarsSaved values mirror BE: cost_usd × (hit_count - 1)
const THREE_ROWS: TopQueryRow[] = [
  makeRow({ queryKey: 'aaa111', snippet: 'show dau by platform', hitCount: 142, dollarsSaved: 1.692, originalSessionId: 'ses_abc', originalTurnId: 'turn_1' }),
  makeRow({ queryKey: 'bbb222', snippet: 'what is d7 retention', hitCount: 47, dollarsSaved: 0.368, originalSessionId: 'ses_def', originalTurnId: 'turn_2' }),
  makeRow({ queryKey: 'ccc333', snippet: 'cohort by acquisition', hitCount: 12, dollarsSaved: 0.220, originalSessionId: null, originalTurnId: null }),
];

function renderTable(rows: TopQueryRow[] = THREE_ROWS, topN = 20) {
  return render(
    <MemoryRouter>
      <CacheDashboardTopQueries rows={rows} topN={topN} />
    </MemoryRouter>,
  );
}

describe('CacheDashboardTopQueries', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders empty state when rows=[]', () => {
    renderTable([]);
    expect(screen.getByTestId('top-queries-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('top-query-row')).toHaveLength(0);
  });

  it('empty state contains helpful hint text', () => {
    renderTable([]);
    expect(screen.getByTestId('top-queries-empty').textContent).toContain('No cached queries yet');
  });

  it('renders all rows', () => {
    renderTable();
    expect(screen.getAllByTestId('top-query-row')).toHaveLength(3);
  });

  it('default sort is hits descending (142, 47, 12)', () => {
    renderTable();
    const rows = screen.getAllByTestId('top-query-row');
    // First row should be the 142-hit one
    expect(rows[0].textContent).toContain('show dau by platform');
    expect(rows[1].textContent).toContain('what is d7 retention');
    expect(rows[2].textContent).toContain('cohort by acquisition');
  });

  it('clicking hits header once switches to ascending', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('th-hits'));
    const rows = screen.getAllByTestId('top-query-row');
    // Ascending: 12, 47, 142
    expect(rows[0].textContent).toContain('cohort by acquisition');
    expect(rows[2].textContent).toContain('show dau by platform');
  });

  it('clicking hits header twice returns to descending', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('th-hits'));
    fireEvent.click(screen.getByTestId('th-hits'));
    const rows = screen.getAllByTestId('top-query-row');
    expect(rows[0].textContent).toContain('show dau by platform');
  });

  it('clicking dollars header sorts by $ saved desc', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('th-dollars'));
    const rows = screen.getAllByTestId('top-query-row');
    // dollarsSaved: aaa111=1.692, bbb222=0.368, ccc333=0.220
    expect(rows[0].textContent).toContain('show dau by platform');
  });

  it('clicking row with session id calls history.push to correct URL', () => {
    renderTable();
    const rows = screen.getAllByTestId('top-query-row');
    fireEvent.click(rows[0]); // ses_abc / turn_1
    expect(mockPush).toHaveBeenCalledWith('/dev/chat-audit/sessions/ses_abc#turn-turn_1');
  });

  it('clicking row without session id does not navigate', () => {
    renderTable();
    const rows = screen.getAllByTestId('top-query-row');
    fireEvent.click(rows[2]); // null session
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('truncates long query snippets at 80 chars', () => {
    const longQuery = 'a'.repeat(100);
    renderTable([makeRow({ queryKey: 'xxx', snippet: longQuery })]);
    const row = screen.getByTestId('top-query-row');
    expect(row.textContent).toContain('a'.repeat(80) + '…');
  });

  it('shows topN in section title', () => {
    renderTable(THREE_ROWS, 50);
    expect(screen.getByText(/top 50/)).toBeTruthy();
  });
});
