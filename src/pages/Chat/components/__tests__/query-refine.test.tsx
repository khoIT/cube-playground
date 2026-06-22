/**
 * Query refinement: context-aware chip generation (no no-ops), prev→next query
 * diffing, and the refine row routing chip/free-text through the send callback.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { generateRefineChips } from '../../services/generate-refine-chips';
import { diffCubeQueries, summarizeQueryDiff } from '../../services/diff-cube-queries';
import { QueryRefineRow } from '../query-refine-row';

describe('generateRefineChips', () => {
  it('omits the grain the query is already at', () => {
    const chips = generateRefineChips({
      measures: ['mf_users.dau'],
      timeDimensions: [{ dimension: 'mf_users.day', granularity: 'week' }],
    });
    const ids = chips.map((c) => c.id);
    expect(ids).not.toContain('grain-week');
    expect(ids).toContain('grain-day');
    expect(ids).toContain('grain-month');
  });

  it('omits the payers chip when a payer-ish filter is present', () => {
    const chips = generateRefineChips({
      measures: ['mf_users.dau'],
      filters: [{ member: 'mf_users.user_type', operator: 'equals', values: ['payer'] }],
    });
    expect(chips.map((c) => c.id)).not.toContain('payers');
  });

  it('offers a roll-up chip when the query has a dimension', () => {
    const chips = generateRefineChips({
      measures: ['mf_users.spend'],
      dimensions: ['mf_users.country'],
    });
    const rollup = chips.find((c) => c.id === 'rollup');
    expect(rollup?.text).toMatch(/country/);
  });

  it('returns nothing for a non-object query', () => {
    expect(generateRefineChips(null)).toEqual([]);
  });
});

describe('diffCubeQueries', () => {
  it('reports an added dimension', () => {
    const parts = diffCubeQueries(
      { dimensions: [], measures: ['m'] },
      { dimensions: ['mf_users.country'], measures: ['m'] },
    );
    expect(parts.some((p) => p.kind === 'dimension' && /\+ country/.test(p.text))).toBe(true);
  });

  it('reports a grain and range change', () => {
    const summary = summarizeQueryDiff(
      { timeDimensions: [{ granularity: 'day', dateRange: 'last 30 days' }] },
      { timeDimensions: [{ granularity: 'week', dateRange: 'last 90 days' }] },
    );
    expect(summary).toMatch(/grain day → week/);
    expect(summary).toMatch(/range last 30 days → last 90 days/);
  });

  it('says "no structural change" when nothing comparable moved', () => {
    expect(summarizeQueryDiff({ measures: ['m'] }, { measures: ['m'] })).toBe('no structural change');
  });
});

describe('QueryRefineRow', () => {
  const query = { measures: ['mf_users.dau'], timeDimensions: [{ dimension: 'mf_users.day', granularity: 'day' }] };

  // The row is collapsed by default — expand it before asserting on chips/input.
  it('is collapsed by default, expands on the toggle', () => {
    render(<QueryRefineRow query={query} onRefine={vi.fn()} />);
    expect(screen.queryByText('Show this weekly instead')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refine query' }));
    expect(screen.getByText('Show this weekly instead')).toBeTruthy();
  });

  it('sends the chip text on click', () => {
    const onRefine = vi.fn();
    render(<QueryRefineRow query={query} onRefine={onRefine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refine query' }));
    fireEvent.click(screen.getByText('Show this weekly instead'));
    expect(onRefine).toHaveBeenCalledWith('Show this weekly instead');
  });

  it('sends typed free-text on Refine click', () => {
    const onRefine = vi.fn();
    render(<QueryRefineRow query={query} onRefine={onRefine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refine query' }));
    fireEvent.change(screen.getByPlaceholderText(/Refine this query/), { target: { value: 'break down by platform' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }));
    expect(onRefine).toHaveBeenCalledWith('break down by platform');
  });
});
