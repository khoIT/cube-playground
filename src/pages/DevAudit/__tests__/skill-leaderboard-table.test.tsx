/**
 * Tests for SkillLeaderboardTable:
 * - default sort p95 desc
 * - sort toggle (click header twice → asc)
 * - sort by different column
 * - empty state renders
 * - null p95 values sort last
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillLeaderboardTable } from '../skill-leaderboard-table';
import type { SkillRow } from '../use-skill-leaderboard';

function makeRow(overrides: Partial<SkillRow> & { skill: string }): SkillRow {
  return {
    count: 1,
    p50LatencyMs: null,
    p95LatencyMs: null,
    avgCostUsd: null,
    totalCostUsd: 0,
    successRate: null,
    legacyCount: 0,
    dailyCounts: [0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

const THREE_ROWS: SkillRow[] = [
  makeRow({ skill: 'fast',   p95LatencyMs: 100,  count: 3 }),
  makeRow({ skill: 'slow',   p95LatencyMs: 9000, count: 1 }),
  makeRow({ skill: 'medium', p95LatencyMs: 500,  count: 2 }),
];

describe('SkillLeaderboardTable', () => {
  it('renders empty state when rows=[]', () => {
    render(<SkillLeaderboardTable rows={[]} />);
    expect(screen.getByTestId('leaderboard-empty')).toBeTruthy();
    expect(screen.queryByTestId('leaderboard-table')).toBeNull();
  });

  it('default sort is p95 descending', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    const rows = screen.getAllByRole('row').slice(1); // skip header
    const skills = rows.map((r) => (r as HTMLTableRowElement).cells[0].textContent);
    expect(skills).toEqual(['slow', 'medium', 'fast']);
  });

  it('clicking p95 header once switches to ascending', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId('th-p95LatencyMs'));
    const rows = screen.getAllByRole('row').slice(1);
    const skills = rows.map((r) => (r as HTMLTableRowElement).cells[0].textContent);
    expect(skills).toEqual(['fast', 'medium', 'slow']);
  });

  it('clicking p95 header twice returns to descending', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId('th-p95LatencyMs'));
    fireEvent.click(screen.getByTestId('th-p95LatencyMs'));
    const rows = screen.getAllByRole('row').slice(1);
    const skills = rows.map((r) => (r as HTMLTableRowElement).cells[0].textContent);
    expect(skills).toEqual(['slow', 'medium', 'fast']);
  });

  it('sorting by count descending', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    fireEvent.click(screen.getByTestId('th-count'));
    const rows = screen.getAllByRole('row').slice(1);
    const skills = rows.map((r) => (r as HTMLTableRowElement).cells[0].textContent);
    expect(skills).toEqual(['fast', 'medium', 'slow']);
  });

  it('sorting by skill name: first click → desc (z→a), second click → asc (a→z)', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    // First click on a new column → desc
    fireEvent.click(screen.getByTestId('th-skill'));
    const rowsDesc = screen.getAllByRole('row').slice(1);
    expect(rowsDesc.map((r) => (r as HTMLTableRowElement).cells[0].textContent))
      .toEqual(['slow', 'medium', 'fast']);
    // Second click → asc
    fireEvent.click(screen.getByTestId('th-skill'));
    const rowsAsc = screen.getAllByRole('row').slice(1);
    expect(rowsAsc.map((r) => (r as HTMLTableRowElement).cells[0].textContent))
      .toEqual(['fast', 'medium', 'slow']);
  });

  it('null p95 rows sort last in desc mode', () => {
    const rows: SkillRow[] = [
      makeRow({ skill: 'no-latency', p95LatencyMs: null }),
      makeRow({ skill: 'has-latency', p95LatencyMs: 200 }),
    ];
    render(<SkillLeaderboardTable rows={rows} />);
    const tableRows = screen.getAllByRole('row').slice(1);
    expect((tableRows[0] as HTMLTableRowElement).cells[0].textContent).toBe('has-latency');
    expect((tableRows[1] as HTMLTableRowElement).cells[0].textContent).toBe('no-latency');
  });

  it('shows legacy count badge when legacyCount > 0', () => {
    const rows: SkillRow[] = [
      makeRow({ skill: 'legacy-skill', legacyCount: 3, successRate: null }),
    ];
    render(<SkillLeaderboardTable rows={rows} />);
    expect(screen.getByTitle(/3 turn\(s\) predate stop_reason tracking/)).toBeTruthy();
  });

  it('formats cost values with 4 decimal places', () => {
    const rows: SkillRow[] = [
      makeRow({ skill: 'costly', avgCostUsd: 0.0123, totalCostUsd: 0.0246 }),
    ];
    render(<SkillLeaderboardTable rows={rows} />);
    expect(screen.getByText('$0.0123')).toBeTruthy();
    expect(screen.getByText('$0.0246')).toBeTruthy();
  });

  it('formats success rate as percentage', () => {
    const rows: SkillRow[] = [
      makeRow({ skill: 'good', successRate: 0.75 }),
    ];
    render(<SkillLeaderboardTable rows={rows} />);
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('renders a Trend column header', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    expect(screen.getByTestId('th-trend')).toBeTruthy();
  });

  it('renders a sparkline SVG in each data row', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    for (const row of THREE_ROWS) {
      const cell = screen.getByTestId(`trend-${row.skill}`);
      expect(cell.querySelector('svg')).toBeTruthy();
    }
  });

  it('sparkline renders a polyline when dailyCounts has non-zero values', () => {
    const rows: SkillRow[] = [
      makeRow({ skill: 'trendy', dailyCounts: [1, 2, 3, 4, 5, 6, 7] }),
    ];
    render(<SkillLeaderboardTable rows={rows} />);
    const cell = screen.getByTestId('trend-trendy');
    expect(cell.querySelector('polyline')).toBeTruthy();
  });

  it('Trend column header is not sortable (no aria-sort attribute)', () => {
    render(<SkillLeaderboardTable rows={THREE_ROWS} />);
    const trendTh = screen.getByTestId('th-trend');
    expect(trendTh.getAttribute('aria-sort')).toBeNull();
  });
});
