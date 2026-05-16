import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useExistingTags } from '../use-existing-tags';

vi.mock('../../../context', () => ({
  useQueryBuilderContext: vi.fn(),
}));

import { useQueryBuilderContext } from '../../../context';

function setup(cubes: any[]) {
  (useQueryBuilderContext as ReturnType<typeof vi.fn>).mockReturnValue({ cubes });
}

describe('useExistingTags()', () => {
  it('returns empty when no measure has tags', () => {
    setup([
      { name: 'a', measures: [{ name: 'a.c', meta: {} }] },
      { name: 'b', measures: [{ name: 'b.c' }] },
    ]);
    const { result } = renderHook(() => useExistingTags());
    expect(result.current).toEqual([]);
  });

  it('aggregates union across all measures, alphabetically', () => {
    setup([
      {
        name: 'orders',
        measures: [
          { name: 'orders.revenue', meta: { tags: ['core', 'revenue'] } },
          { name: 'orders.count', meta: { tags: ['core'] } },
        ],
      },
      {
        name: 'users',
        measures: [
          { name: 'users.count', meta: { tags: ['users', 'core'] } },
        ],
      },
    ]);
    const { result } = renderHook(() => useExistingTags());
    expect(result.current).toEqual(['core', 'revenue', 'users']);
  });

  it('case-sensitive distinction (Revenue ≠ revenue)', () => {
    setup([
      { name: 'a', measures: [{ name: 'a.c', meta: { tags: ['Revenue'] } }] },
      { name: 'b', measures: [{ name: 'b.c', meta: { tags: ['revenue'] } }] },
    ]);
    const { result } = renderHook(() => useExistingTags());
    // localeCompare default (en) orders lowercase before uppercase variants.
    // We only assert both entries appear — that's the case-sensitivity contract.
    expect(result.current).toContain('Revenue');
    expect(result.current).toContain('revenue');
    expect(result.current).toHaveLength(2);
  });

  it('skips non-string tag entries', () => {
    setup([
      {
        name: 'a',
        measures: [{ name: 'a.c', meta: { tags: ['valid', 42, null, ''] } }],
      },
    ]);
    const { result } = renderHook(() => useExistingTags());
    expect(result.current).toEqual(['valid']);
  });

  it('handles cubes without measures arrays gracefully', () => {
    setup([{ name: 'broken' }, { name: 'a', measures: [{ name: 'a.c', meta: { tags: ['x'] } }] }]);
    const { result } = renderHook(() => useExistingTags());
    expect(result.current).toEqual(['x']);
  });
});
