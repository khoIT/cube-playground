/**
 * Unit tests for useDriftCenter — drift fetch, member-list flattening, repoint
 * happy path → refetch, and the prefixUnsupported pass-through. apiFetch and
 * the reused /meta hook are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../api/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

const catalogMetaMock = vi.fn();
vi.mock('../../Catalog/use-catalog-meta', () => ({ useCatalogMeta: () => catalogMetaMock() }));

import { useDriftCenter } from '../use-drift-center';

const REPORT = {
  game: 'ballistar',
  prefixUnsupported: false,
  generatedAt: '2026-05-30T07:00:00.000Z',
  detectorPanel: { groups: [], updatedAt: null },
  groups: [
    { kind: 'cube-missing', key: 'funnel', reason: 'cube-missing', affectedMetricIds: ['a'], affectedCount: 1, refs: ['funnel.x'], items: [{ metricId: 'a', ref: 'funnel.x' }] },
  ],
};

beforeEach(() => {
  apiFetchMock.mockReset();
  catalogMetaMock.mockReset();
  catalogMetaMock.mockReturnValue({
    cubes: [
      { name: 'recharge', measures: [{ name: 'recharge.paying_users' }], dimensions: [{ name: 'recharge.recharge_date' }] },
    ],
    loading: false,
    error: null,
  });
});

describe('useDriftCenter', () => {
  it('fetches drift and flattens live /meta members (measures + dimensions)', async () => {
    apiFetchMock.mockResolvedValue(REPORT);
    const { result } = renderHook(() => useDriftCenter('ballistar'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.report?.groups[0].key).toBe('funnel');
    expect(result.current.members).toEqual([
      { ref: 'recharge.paying_users', kind: 'measure' },
      { ref: 'recharge.recharge_date', kind: 'dimension' },
    ]);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/business-metrics/drift-center',
      expect.objectContaining({ query: { game: 'ballistar' } }),
    );
  });

  it('repoint PATCHes then refetches', async () => {
    apiFetchMock.mockResolvedValue(REPORT);
    const { result } = renderHook(() => useDriftCenter('ballistar'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    apiFetchMock.mockClear();
    apiFetchMock.mockResolvedValue(REPORT);

    await act(async () => {
      await result.current.repoint('a', 'funnel.x', 'ordered_event_funnel.step_count');
    });

    const patchCall = apiFetchMock.mock.calls.find((c) => c[0] === '/api/business-metrics/a/repoint');
    expect(patchCall?.[1]).toMatchObject({
      method: 'PATCH',
      body: { from: 'funnel.x', to: 'ordered_event_funnel.step_count', game: 'ballistar' },
    });
    // refetch fired after the mutation
    expect(apiFetchMock).toHaveBeenCalledWith('/api/business-metrics/drift-center', expect.anything());
  });

  it('passes through prefixUnsupported', async () => {
    apiFetchMock.mockResolvedValue({ ...REPORT, prefixUnsupported: true, groups: [] });
    const { result } = renderHook(() => useDriftCenter('prodgame'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.report?.prefixUnsupported).toBe(true);
    expect(result.current.report?.groups).toEqual([]);
  });
});
