/**
 * detail-panel-measures.test.tsx
 * Verifies per-measure dropdown gating: only projectable measures on
 * CDP-mapped cubes render the expandable row + projection card. Calculated
 * (number-with-{ref}) measures and view-sourced measures render as plain
 * non-clickable rows.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    dimensions: [
      { name: 'mf_users.user_id', type: 'string', primaryKey: true },
    ],
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

describe('<DetailPanelMeasures>', () => {
  it('mf_users user_count → expandable (role=button rendered)', () => {
    render(<DetailPanelMeasures cube={mfUsersCube()} />);
    const row = screen.getByText('user_count').closest('[data-testid="measure-row"]');
    expect(row?.querySelector('[role="button"]')).toBeTruthy();
  });

  it('mf_users arpu_vnd (calculated, references other measures) → plain row, no dropdown', () => {
    render(<DetailPanelMeasures cube={mfUsersCube()} />);
    const row = screen.getByText('arpu_vnd').closest('[data-testid="measure-row"]');
    expect(row).toBeTruthy();
    expect(row?.querySelector('[role="button"]')).toBeNull();
  });

  it('unmapped cube (active_daily) → all rows plain, no dropdown', () => {
    render(<DetailPanelMeasures cube={unmappedCube()} />);
    const row = screen.getByText('rows').closest('[data-testid="measure-row"]');
    expect(row?.querySelector('[role="button"]')).toBeNull();
  });
});
