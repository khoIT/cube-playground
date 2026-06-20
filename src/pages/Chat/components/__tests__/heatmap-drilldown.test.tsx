/**
 * Heatmap drill-down: cell → predicate mapping, click opens the popover with the
 * right value/%-of-total, and "Save as segment" stashes the cell predicate and
 * navigates to the editor. Prefill stash + router mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChartSpec } from '../../../../api/chat-sse-client';
import { heatmapCellToPredicate, cubeOfMember } from '../heatmap-cell-to-predicate';

const pushMock = vi.fn();
vi.mock('react-router-dom', () => ({ useHistory: () => ({ push: pushMock }) }));

const stashMock = vi.fn();
vi.mock('../../../Segments/editor/editor-prefill-store', () => ({
  stashEditorPrefill: (...a: unknown[]) => stashMock(...a),
}));

import { ChartHeatmap } from '../chart-heatmap';

describe('heatmapCellToPredicate', () => {
  it('builds an AND of two equals leaves on the two dims', () => {
    const tree = heatmapCellToPredicate({
      seriesDim: 'mf_users.country', seriesValue: 'VN',
      categoryDim: 'mf_users.platform', categoryValue: 'iOS',
    });
    expect(tree.kind).toBe('group');
    if (tree.kind !== 'group') throw new Error('expected group');
    expect(tree.op).toBe('AND');
    expect(tree.children).toHaveLength(2);
    const leaf0 = tree.children[0];
    if (leaf0.kind !== 'leaf') throw new Error('expected leaf');
    expect(leaf0.member).toBe('mf_users.country');
    expect(leaf0.op).toBe('equals');
    expect(leaf0.values).toEqual(['VN']);
  });

  it('derives the cube from the member prefix', () => {
    expect(cubeOfMember('mf_users.country')).toBe('mf_users');
    expect(cubeOfMember('bare')).toBe('bare');
  });
});

describe('ChartHeatmap drill-down', () => {
  const spec: ChartSpec = {
    type: 'heatmap',
    title: 'Spend by country × platform',
    data: [
      { 'mf_users.country': 'VN', 'mf_users.platform': 'iOS', spend: 30 },
      { 'mf_users.country': 'VN', 'mf_users.platform': 'Android', spend: 10 },
      { 'mf_users.country': 'TH', 'mf_users.platform': 'iOS', spend: 60 },
    ],
    encoding: { category: 'mf_users.platform', series: 'mf_users.country', value: 'spend' },
  };
  const labels = {} as never;
  const fmt = (v: number | string) => String(v);

  beforeEach(() => {
    pushMock.mockReset();
    stashMock.mockReset();
  });

  it('opens a popover with value + %-of-total on cell click', () => {
    render(<ChartHeatmap spec={spec} labels={labels} formatValue={fmt} />);
    // Click the TH × iOS cell (value 60; total = 100 → 60%).
    fireEvent.click(screen.getByLabelText(/TH × iOS: 60/));
    expect(screen.getByText('60.0% of grid total')).toBeTruthy();
    expect(screen.getByText('Save this cell as a segment')).toBeTruthy();
  });

  it('save hands off the cell predicate to the editor', () => {
    render(<ChartHeatmap spec={spec} labels={labels} formatValue={fmt} />);
    fireEvent.click(screen.getByLabelText(/TH × iOS: 60/));
    fireEvent.click(screen.getByText('Save this cell as a segment'));
    expect(stashMock).toHaveBeenCalledTimes(1);
    const state = stashMock.mock.calls[0][0];
    expect(state.advisorPrefill.cube).toBe('mf_users');
    expect(state.advisorPrefill.predicateTree.children).toHaveLength(2);
    expect(pushMock).toHaveBeenCalledWith('/segments/new', expect.anything());
  });
});
