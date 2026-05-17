/**
 * detail-panel-measures.test.tsx
 * Verifies each measure renders as a clickable navigation row pointing at
 * `/metric/:cube/:member`. The legacy CDP-projection accordion was removed
 * in the metric-card plan; CDP projection now renders inside the per-measure
 * card itself.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DetailPanelMeasures } from '../detail-panel-measures';
import type { CatalogCube } from '../use-catalog-meta';

function mfUsersCube(): CatalogCube {
  return {
    name: 'mf_users',
    type: 'cube',
    measures: [
      { name: 'mf_users.user_count', aggType: 'count' },
      {
        name: 'mf_users.arpu_vnd',
        aggType: 'number',
        type: 'number',
        sql: '{lifetime_recharge_amount_vnd}/{user_count}',
      },
    ],
    dimensions: [{ name: 'mf_users.user_id', type: 'string', primaryKey: true }],
    meta: { game_id: 'bal_vn', cdp_source: 'iceberg.ballistar_vn.mf_users' },
  } as unknown as CatalogCube;
}

function unmappedCube(): CatalogCube {
  return {
    name: 'active_daily',
    type: 'cube',
    measures: [{ name: 'active_daily.rows', aggType: 'count' }],
    dimensions: [],
  } as unknown as CatalogCube;
}

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('<DetailPanelMeasures>', () => {
  it('mf_users user_count → renders as role=link', () => {
    renderWithRouter(<DetailPanelMeasures cube={mfUsersCube()} />);
    const row = screen.getByText('user_count').closest('[data-testid="measure-row"]');
    expect(row?.getAttribute('role')).toBe('link');
  });

  it('mf_users arpu_vnd (calculated) → still renders as role=link', () => {
    renderWithRouter(<DetailPanelMeasures cube={mfUsersCube()} />);
    const row = screen.getByText('arpu_vnd').closest('[data-testid="measure-row"]');
    expect(row?.getAttribute('role')).toBe('link');
  });

  it('unmapped cube (active_daily) → all rows are role=link', () => {
    renderWithRouter(<DetailPanelMeasures cube={unmappedCube()} />);
    const row = screen.getByText('rows').closest('[data-testid="measure-row"]');
    expect(row?.getAttribute('role')).toBe('link');
  });

  it('measure-row data-measure-name carries fqn for nav target derivation', () => {
    renderWithRouter(<DetailPanelMeasures cube={mfUsersCube()} />);
    const row = screen.getByText('user_count').closest('[data-testid="measure-row"]');
    expect(row?.getAttribute('data-measure-name')).toBe('mf_users.user_count');
  });
});
