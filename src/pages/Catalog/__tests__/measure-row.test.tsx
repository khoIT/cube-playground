/**
 * measure-row.test.tsx
 * Covers click + keyboard navigation semantics of `<MeasureRow>`. The legacy
 * accordion behaviour was removed; every row is now a link target.
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
    render(<MeasureRow measure={measure} cube={cube()} onClick={() => {}} />);
    expect(screen.getByText('user_count')).toBeTruthy();
    expect(screen.getByText('count')).toBeTruthy();
    expect(screen.getByText('number')).toBeTruthy();
  });

  it('renders WizardChip when measure.meta.source === "wizard"', () => {
    const wm: CatalogMeasure = { ...measure, meta: { source: 'wizard' } };
    render(<MeasureRow measure={wm} cube={cube()} onClick={() => {}} />);
    expect(screen.getByText('Wizard')).toBeTruthy();
  });

  it('row has role="link" for navigation semantics', () => {
    render(<MeasureRow measure={measure} cube={cube()} onClick={() => {}} />);
    expect(screen.getByRole('link')).toBeTruthy();
  });

  it('click row → calls onClick once', () => {
    const onClick = vi.fn();
    render(<MeasureRow measure={measure} cube={cube()} onClick={onClick} />);
    fireEvent.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Enter key → calls onClick', () => {
    const onClick = vi.fn();
    render(<MeasureRow measure={measure} cube={cube()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('link'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalled();
  });

  it('Space key → calls onClick', () => {
    const onClick = vi.fn();
    render(<MeasureRow measure={measure} cube={cube()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('link'), { key: ' ' });
    expect(onClick).toHaveBeenCalled();
  });

  it('root has data-testid + data-measure-name for selector stability', () => {
    const { container } = render(
      <MeasureRow measure={measure} cube={cube()} onClick={() => {}} />,
    );
    const root = container.querySelector('[data-testid="measure-row"]');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('data-measure-name')).toBe('mf_users.user_count');
  });
});
