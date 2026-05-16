import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFindSimilar } from '../use-find-similar';

vi.mock('../../../context', () => ({
  useQueryBuilderContext: vi.fn(),
}));

import { useQueryBuilderContext } from '../../../context';

function setupContext(cubes: any[]) {
  (useQueryBuilderContext as ReturnType<typeof vi.fn>).mockReturnValue({ cubes });
}

const ORDERS = {
  name: 'orders',
  measures: [
    { name: 'orders.revenue', title: 'Revenue', aggType: 'sum' },
    { name: 'orders.count', title: 'Order Count', aggType: 'count' },
    { name: 'orders.unique_users', title: 'Unique Users', aggType: 'countDistinctApprox' },
    { name: 'orders.avg_order', title: 'Avg Order', aggType: 'avg' },
  ],
};

const USERS = {
  name: 'users',
  measures: [{ name: 'users.count', title: 'User Count', aggType: 'count' }],
};

describe('useFindSimilar()', () => {
  it('returns empty when sourceCube is null', () => {
    setupContext([ORDERS]);
    const { result } = renderHook(() => useFindSimilar(null, 'sum'));
    expect(result.current).toHaveLength(0);
  });

  it('returns matches with same aggType on same cube — sum', () => {
    setupContext([ORDERS, USERS]);
    const { result } = renderHook(() => useFindSimilar('orders', 'sum'));
    expect(result.current.map((m) => m.name)).toEqual(['orders.revenue']);
  });

  it('returns matches for count', () => {
    setupContext([ORDERS, USERS]);
    const { result } = renderHook(() => useFindSimilar('orders', 'count'));
    expect(result.current.map((m) => m.name)).toEqual(['orders.count']);
  });

  it('maps countDistinct → countDistinctApprox', () => {
    setupContext([ORDERS]);
    const { result } = renderHook(() => useFindSimilar('orders', 'countDistinct'));
    expect(result.current.map((m) => m.name)).toEqual(['orders.unique_users']);
  });

  it('returns empty when no aggType match on the cube', () => {
    setupContext([ORDERS]);
    const { result } = renderHook(() => useFindSimilar('orders', 'min'));
    expect(result.current).toHaveLength(0);
  });

  it('does not cross cube boundaries — users.count not surfaced for orders+count', () => {
    setupContext([ORDERS, USERS]);
    const { result } = renderHook(() => useFindSimilar('orders', 'count'));
    expect(result.current.map((m) => m.name)).not.toContain('users.count');
  });

  it('returns empty when sourceCube has no measures', () => {
    setupContext([{ name: 'empty', measures: [] }]);
    const { result } = renderHook(() => useFindSimilar('empty', 'sum'));
    expect(result.current).toHaveLength(0);
  });
});
