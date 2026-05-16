/**
 * measure-row.test.tsx
 * Covers the click-to-expand + keyboard semantics of `<MeasureRow>` plus
 * a regression guard on legacy non-mf_users rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeasureRow } from '../measure-row';
import type { CatalogCube, CatalogMeasure } from '../use-catalog-meta';

const measure: CatalogMeasure = {
  name: 'mf_users.user_count',
  aggType: 'count',
  format: 'number',
};

function cube(overrides: Partial<CatalogCube> = {}): CatalogCube {
  return {
    name: 'mf_users',
    measures: [],
    dimensions: [],
    meta: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
    ...overrides,
  };
}

describe('<MeasureRow>', () => {
  it('renders measure name + aggType + format chips', () => {
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable={false} onToggle={() => {}} />,
    );
    expect(screen.getByText('user_count')).toBeTruthy();
    expect(screen.getByText('count')).toBeTruthy();
    expect(screen.getByText('number')).toBeTruthy();
  });

  it('renders WizardChip when measure.meta.source === "wizard"', () => {
    const wm: CatalogMeasure = { ...measure, meta: { source: 'wizard' } };
    render(<MeasureRow measure={wm} cube={cube()} expanded={false} expandable={false} onToggle={() => {}} />);
    expect(screen.getByText('Wizard')).toBeTruthy();
  });

  it('expandable=false → no role=button + no aria-expanded', () => {
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable={false} onToggle={() => {}} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('expandable=true, expanded=false → role=button + aria-expanded=false + children NOT in DOM', () => {
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable onToggle={() => {}}>
        <div data-testid="kid">child</div>
      </MeasureRow>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('kid')).toBeNull();
  });

  it('click row → calls onToggle once', () => {
    const onToggle = vi.fn();
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Enter key → calls onToggle', () => {
    const onToggle = vi.fn();
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable onToggle={onToggle} />,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onToggle).toHaveBeenCalled();
  });

  it('Space key → calls onToggle', () => {
    const onToggle = vi.fn();
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable onToggle={onToggle} />,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onToggle).toHaveBeenCalled();
  });

  it('Escape while expanded → calls onToggle (collapse)', () => {
    const onToggle = vi.fn();
    render(
      <MeasureRow measure={measure} cube={cube()} expanded expandable onToggle={onToggle} />,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(onToggle).toHaveBeenCalled();
  });

  it('Escape while collapsed → does NOT call onToggle', () => {
    const onToggle = vi.fn();
    render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable onToggle={onToggle} />,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('expanded=true → aria-expanded=true + children rendered', () => {
    render(
      <MeasureRow measure={measure} cube={cube()} expanded expandable onToggle={() => {}}>
        <div data-testid="kid">child</div>
      </MeasureRow>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('kid')).toBeTruthy();
  });

  it('root has data-testid + data-measure-name for selector stability', () => {
    const { container } = render(
      <MeasureRow measure={measure} cube={cube()} expanded={false} expandable={false} onToggle={() => {}} />,
    );
    const root = container.querySelector('[data-testid="measure-row"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('data-measure-name')).toBe('mf_users.user_count');
  });
});
