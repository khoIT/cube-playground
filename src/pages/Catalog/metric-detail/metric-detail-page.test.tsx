/**
 * MetricDetailPage smoke tests — route resolves, 404 path, tab switching.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetricDetailPage } from './metric-detail-page';
import {
  __resetBusinessMetricsCache,
} from '../metrics-tab/use-business-metrics';
import type { BusinessMetric } from '../metrics-tab/business-metric-types';

const ARPDAU: BusinessMetric = {
  id: 'arpdau',
  label: 'ARPDAU',
  description: 'Average revenue per daily active user',
  synonyms: ['arpu_daily'],
  tier: 1,
  domain: 'revenue',
  owner: 'data@vng',
  trust: 'certified',
  formula: {
    type: 'ratio',
    numerator: 'recharge.revenue_vnd',
    denominator: 'mf_users.dau',
  },
  related_concepts: ['mf_users.country'],
};

function harness(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Route path="/catalog/metric/:id">
        <MetricDetailPage />
      </Route>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetBusinessMetricsCache();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ metrics: [ARPDAU] }), { status: 200 }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MetricDetailPage', () => {
  it('renders header + tabs + overview by default', async () => {
    harness('/catalog/metric/arpdau');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ARPDAU' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches to Formula tab on click and renders ratio refs', async () => {
    harness('/catalog/metric/arpdau');
    await waitFor(() => screen.getByRole('heading', { name: 'ARPDAU' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Formula' }));
    expect(screen.getByText('recharge.revenue_vnd')).toBeTruthy();
    expect(screen.getByText('mf_users.dau')).toBeTruthy();
  });

  it('switches to Slices tab and renders related concepts', async () => {
    harness('/catalog/metric/arpdau');
    await waitFor(() => screen.getByRole('heading', { name: 'ARPDAU' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Slices' }));
    expect(screen.getByText('mf_users.country')).toBeTruthy();
  });

  it('renders 404 fallback when id is unknown', async () => {
    harness('/catalog/metric/does-not-exist');
    await waitFor(() => screen.getByText(/No metric named/));
    expect(screen.getByText(/Back to Catalog/)).toBeTruthy();
  });
});
