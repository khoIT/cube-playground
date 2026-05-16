/**
 * use-catalog-meta.test.ts
 * Covers the cdp-mapping merge inside `useCatalogMeta` — confirms cubes in
 * `CUBE_TO_CDP_MAPPING` gain `meta.game_id` + `meta.cdp_source`, and other
 * cubes are passed through unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCatalogMeta, type CatalogCube } from '../use-catalog-meta';

vi.mock('../../../hooks', () => ({
  useAppContext: () => ({ apiUrl: 'http://test/v1', token: 'tok' }),
}));

const originalFetch = globalThis.fetch;

function mockFetch(cubes: Array<Partial<CatalogCube> & { name: string }>) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      cubes: cubes.map((c) => ({ measures: [], dimensions: [], ...c })),
    }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useCatalogMeta() — CDP mapping merge', () => {
  it('mf_users gains meta.game_id + meta.cdp_source after merge', async () => {
    mockFetch([{ name: 'mf_users' }]);
    const { result } = renderHook(() => useCatalogMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const mf = result.current.cubes.find((c) => c.name === 'mf_users');
    expect(mf?.meta?.game_id).toBe('bal_vn');
    expect(mf?.meta?.cdp_source).toBe('iceberg.ballistar_vn.mf_users');
  });

  it('cube not in mapping has meta unchanged (undefined when server omits)', async () => {
    mockFetch([{ name: 'active_daily' }]);
    const { result } = renderHook(() => useCatalogMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const cube = result.current.cubes.find((c) => c.name === 'active_daily');
    expect(cube?.meta).toBeUndefined();
  });

  it('mf_users w/ server-provided meta keeps server keys + adds mapping keys', async () => {
    mockFetch([
      {
        name: 'mf_users',
        meta: { someExtra: 'value' } as unknown as CatalogCube['meta'],
      },
    ]);
    const { result } = renderHook(() => useCatalogMeta());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const mf = result.current.cubes.find((c) => c.name === 'mf_users');
    expect(mf?.meta?.game_id).toBe('bal_vn');
    expect(mf?.meta?.cdp_source).toBe('iceberg.ballistar_vn.mf_users');
    expect((mf?.meta as Record<string, unknown> | undefined)?.someExtra).toBe('value');
  });
});
