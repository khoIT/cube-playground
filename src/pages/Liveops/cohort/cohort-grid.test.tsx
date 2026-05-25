/**
 * Tests for CohortGrid component.
 * Covers: renders day-N headers, mature cell shows pct, immature cell shows "—",
 * aria-labels, empty rows, intensity ramp wiring (bg applied to mature cells).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CohortGrid } from './cohort-grid';
import type { CohortRow } from './pivot-cohort-rows';

function makeRow(overrides: Partial<CohortRow> = {}): CohortRow {
  return {
    installDate: '2024-01-01',
    size: 100,
    d1: 60,  d3: 50,  d7: 40,  d14: 30,  d30: 20,
    d1Pct: 60, d3Pct: 50, d7Pct: 40, d14Pct: 30, d30Pct: 20,
    matureMask: [true, true, true, true, true],
    ...overrides,
  };
}

describe('CohortGrid', () => {
  it('renders day-N column headers', () => {
    render(<CohortGrid rows={[makeRow()]} />);
    for (const label of ['D1', 'D3', 'D7', 'D14', 'D30']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('renders cohort date in left column', () => {
    render(<CohortGrid rows={[makeRow({ installDate: '2024-03-15' })]} />);
    expect(screen.getByText('2024-03-15')).toBeTruthy();
  });

  it('renders cohort size badge', () => {
    render(<CohortGrid rows={[makeRow({ size: 42 })]} />);
    expect(screen.getByText('n=42')).toBeTruthy();
  });

  it('shows retention percentage for mature cells', () => {
    render(<CohortGrid rows={[makeRow({ d1Pct: 60, matureMask: [true, true, true, true, true] })]} />);
    // At least one cell should show "60%"
    const cells = screen.getAllByText('60%');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('shows "—" for immature cells instead of percentage', () => {
    const row = makeRow({
      matureMask: [false, false, false, false, false],
    });
    render(<CohortGrid rows={[row]} />);
    const dashes = screen.getAllByText('—');
    // All 5 day-N columns should show "—"
    expect(dashes.length).toBe(5);
  });

  it('applies aria-label with pct for mature cell', () => {
    render(<CohortGrid rows={[makeRow({ d1Pct: 60, d1: 60, size: 100 })]} />);
    const cell = screen.getByRole('cell', {
      name: /2024-01-01 D1: 60% \(60 of 100\)/,
    });
    expect(cell).toBeTruthy();
  });

  it('applies aria-label indicating not-yet-mature for immature cell', () => {
    const row = makeRow({ matureMask: [false, true, true, true, true] });
    render(<CohortGrid rows={[row]} />);
    const cell = screen.getByRole('cell', {
      name: /2024-01-01 D1: not yet mature/,
    });
    expect(cell).toBeTruthy();
  });

  it('renders correctly with empty rows array', () => {
    const { container } = render(<CohortGrid rows={[]} />);
    // Should render header row only, no data cells beyond headers
    expect(screen.getByText('Cohort date')).toBeTruthy();
    // No size badges
    expect(container.querySelectorAll('[style*="n="]').length).toBe(0);
  });

  it('renders multiple cohort rows', () => {
    const rows = [
      makeRow({ installDate: '2024-01-01' }),
      makeRow({ installDate: '2024-01-02' }),
      makeRow({ installDate: '2024-01-03' }),
    ];
    render(<CohortGrid rows={rows} />);
    expect(screen.getByText('2024-01-01')).toBeTruthy();
    expect(screen.getByText('2024-01-02')).toBeTruthy();
    expect(screen.getByText('2024-01-03')).toBeTruthy();
  });

  it('mature cell has non-transparent background (intensity ramp applied)', () => {
    const row = makeRow({ d1Pct: 75, matureMask: [true, false, false, false, false] });
    render(<CohortGrid rows={[row]} />);
    const cell = screen.getByRole('cell', { name: /D1: 75%/ });
    const bg = (cell as HTMLElement).style.background;
    // Should be a hex color from the ramp, not 'transparent'
    expect(bg).not.toBe('transparent');
    expect(bg.length).toBeGreaterThan(0);
  });

  it('immature cell has stripe background pattern', () => {
    const row = makeRow({ matureMask: [false, false, false, false, false] });
    render(<CohortGrid rows={[row]} />);
    const cell = screen.getByRole('cell', { name: /D1: not yet mature/ });
    const bg = (cell as HTMLElement).style.background;
    expect(bg).toContain('repeating-linear-gradient');
  });
});
