import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoMetricName } from '../use-auto-metric-name';
import type { NewMetricDraftV2 } from '../../../types';

function makeDraft(overrides: Partial<NewMetricDraftV2> = {}): NewMetricDraftV2 {
  return {
    sourceCubes: [],
    sourceCube: null,
    operation: '' as any,
    inputs: {},
    ofMember: null,
    ofMemberB: null,
    filter: null,
    name: '',
    title: '',
    description: '',
    format: 'number',
    tags: [],
    previewTimeDimension: null,
    previewRange: '30d',
    filterTree: { kind: 'group', op: 'and', children: [] } as any,
    grain: 'daily',
    visibility: 'team',
    ...overrides,
  };
}

describe('useAutoMetricName', () => {
  it('does not fire when source / operation are missing', () => {
    const setField = vi.fn();
    renderHook(() => useAutoMetricName(makeDraft(), setField));
    expect(setField).not.toHaveBeenCalled();
  });

  it('writes name + title when source + operation pick exists', () => {
    const setField = vi.fn();
    renderHook(() =>
      useAutoMetricName(
        makeDraft({
          sourceCubes: ['orders'],
          operation: 'sum',
          inputs: { value: 'orders.revenue' },
        }),
        setField
      )
    );
    expect(setField).toHaveBeenCalledWith('name', 'sum_revenue');
    expect(setField).toHaveBeenCalledWith('title', 'Sum of revenue');
  });

  it('does NOT overwrite once user has typed a non-auto name', () => {
    const setField = vi.fn();
    const draft = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
      name: 'my_custom_name', // user-typed
      title: 'My Title',
    });
    renderHook(() => useAutoMetricName(draft, setField));
    // Hook should detect manual edit (name doesn't equal lastAutoNameRef which is '')
    // and skip the write.
    expect(setField).not.toHaveBeenCalledWith('name', expect.any(String));
    expect(setField).not.toHaveBeenCalledWith('title', expect.any(String));
  });

  it('updates name when operation changes and previous name was auto', () => {
    const setField = vi.fn();
    const initial = makeDraft({
      sourceCubes: ['orders'],
      operation: 'sum',
      inputs: { value: 'orders.revenue' },
    });
    const { rerender } = renderHook(
      ({ d }: { d: NewMetricDraftV2 }) => useAutoMetricName(d, setField),
      { initialProps: { d: initial } }
    );
    // First render wrote sum_revenue. Simulate it landing on the draft.
    const afterFirst = makeDraft({
      ...initial,
      name: 'sum_revenue',
      title: 'Sum of revenue',
    });
    setField.mockClear();
    rerender({
      d: {
        ...afterFirst,
        operation: 'count',
        inputs: { value: 'orders.id' },
      } as NewMetricDraftV2,
    });
    expect(setField).toHaveBeenCalledWith('name', 'count_id');
    expect(setField).toHaveBeenCalledWith('title', 'Count of id');
  });
});
