/**
 * DetailPanel tests — the tabbed cube drawer: Dimensions / Measures / Segments
 * tabs, every member row links into the catalog (concept page or metric card),
 * primary-key dims are non-clickable (no concept page), and there is no longer
 * an "Open in Playground" action.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DetailPanel } from '../detail-panel';
import type { CatalogCube } from '../use-catalog-meta';

const CUBE: CatalogCube = {
  name: 'mf_users',
  title: 'Users',
  type: 'cube',
  description: 'Wide feature store with one row per user.',
  joins: [{ name: 'active_daily', relationship: 'belongsTo', sql: '`${CUBE}.user_id = ${active_daily}.user_id`' }],
  dimensions: [
    { name: 'mf_users.user_id', type: 'string', primaryKey: true },
    { name: 'mf_users.country', type: 'string' },
    { name: 'mf_users.appsflyer_id', type: 'string', public: false },
  ],
  measures: [{ name: 'mf_users.dau', aggType: 'count' }],
  segments: [{ name: 'mf_users.vips' }],
  preAggregations: [{ name: 'ltv_by_cohort', granularity: 'day' }],
};

function renderPanel() {
  let url = '';
  render(
    <MemoryRouter initialEntries={['/catalog/data-model']}>
      <DetailPanel cube={CUBE} onClose={() => {}} />
      <Route
        path="*"
        render={({ location }) => {
          url = `${location.pathname}${location.search}`;
          return null;
        }}
      />
    </MemoryRouter>,
  );
  return () => url;
}

describe('DetailPanel', () => {
  it('shows the Dimensions tab by default and links a dimension to its concept page', () => {
    const currentUrl = renderPanel();
    // PK dim is shown but not a link.
    const pkRow = screen.getByText('user_id').closest('[role="link"]');
    expect(pkRow).toBeNull();
    // Public dim navigates to the concept page.
    fireEvent.click(screen.getByText('country'));
    expect(currentUrl()).toBe('/catalog/concept/dimension/mf_users.country');
  });

  it('switches to Measures and links to the metric card', () => {
    const currentUrl = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Measures/ }));
    fireEvent.click(screen.getByText('dau'));
    expect(currentUrl()).toBe('/metric/mf_users/dau');
  });

  it('switches to Segments and links to the concept page', () => {
    const currentUrl = renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Segments/ }));
    fireEvent.click(screen.getByText('vips'));
    expect(currentUrl()).toBe('/catalog/concept/segment/mf_users.vips');
  });

  it('renders the Joins segment by default with target and relationship', () => {
    renderPanel();
    expect(screen.getByText('active_daily')).toBeTruthy();
    expect(screen.getByText(/belongsTo/)).toBeTruthy();
    // Pre-agg lives behind the other segment tab, not shown yet.
    expect(screen.queryByText('ltv_by_cohort')).toBeNull();
  });

  it('switches the structure segment to Pre-aggs on one row', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Pre-aggs/ }));
    expect(screen.getByText('ltv_by_cohort')).toBeTruthy();
    // Joins target is hidden once the Pre-aggs segment is active.
    expect(screen.queryByText('active_daily')).toBeNull();
  });

  it('has no "Open in Playground" action', () => {
    renderPanel();
    expect(screen.queryByText(/Open in Playground/i)).toBeNull();
  });
});
