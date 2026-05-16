/**
 * smoke.test.tsx
 * End-to-end integration: catalog page → click mf_users → DetailPanel →
 * click user_count row → expand → click Verify → wait Available.
 *
 * Mocks the two fetch endpoints involved (extended /meta, CDP GET /cdp/v1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CatalogPage } from '../../catalog-page';

vi.mock('../../../../hooks', () => ({
  useAppContext: () => ({ apiUrl: 'http://test/v1', token: 'tok' }),
}));

const META_FIXTURE = {
  cubes: [
    {
      name: 'mf_users',
      type: 'cube',
      title: 'MF Users',
      measures: [
        { name: 'mf_users.user_count', aggType: 'count', type: 'count' },
      ],
      dimensions: [
        { name: 'mf_users.country', type: 'string' },
        { name: 'mf_users.signup_source', type: 'string' },
        { name: 'mf_users.user_id', type: 'string', primaryKey: true },
      ],
    },
  ],
};

const SEED_USER_COUNT = {
  game_id: 'bal_vn',
  metric_name: 'user_count',
  metric_codename: 'user_count',
  source: 'iceberg.ballistar_vn.mf_users',
  expression: 'COUNT(*)',
  dimensions: ['country', 'signup_source'],
  filter: '',
  materialize: false,
  schedule: '',
  created_at: '2026-05-17T17:15:00+07:00',
  updated_at: '2026-05-17T17:15:00+07:00',
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/meta?extended')) {
      return {
        ok: true, status: 200, json: async () => META_FIXTURE,
      } as Response;
    }
    if (url.includes('/cdp/v1/metrics/bal_vn/user_count')) {
      return {
        ok: true, status: 200,
        json: async () => ({ status: 'SUCCESS', error: null, data: SEED_USER_COUNT }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ status: 'ERROR', error: { code: 'NOT_FOUND' } }) } as Response;
  }) as unknown as typeof fetch;
});

describe('CDP projection smoke', () => {
  it('renders catalog → expands mf_users user_count → verify → Available', async () => {
    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    );

    const cubeCard = await screen.findByText('mf_users');
    fireEvent.click(cubeCard);

    const measureRow = await screen.findByText('user_count');
    fireEvent.click(measureRow);

    const verifyBtn = await screen.findByRole('button', { name: /verify on cdp/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => expect(screen.getByTestId('badge-available')).toBeTruthy());
  });
});
