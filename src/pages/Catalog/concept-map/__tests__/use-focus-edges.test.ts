/**
 * useFocusEdges tests — focused ref maps ConceptRelations to typed edges with
 * the correct target layer; null focus is idle; errors surface as strings.
 *
 * useConceptResolution is mocked so no fetch occurs and the hook's mapping is
 * tested in isolation.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFocusEdges } from '../use-focus-edges';
import type { ConceptRelations } from '../../../../api/concepts-client';

const resolutionMock = vi.fn();

vi.mock('../../../../components/concept-hover-card/use-concept-resolution', () => ({
  useConceptResolution: (ref: string | null) => resolutionMock(ref),
}));

const RELATIONS: ConceptRelations = {
  ref: 'data_model/mf_users.dau',
  fields: [{ ref: 'data_model/mf_users.country', member: 'country' }],
  metrics: [{ ref: 'business_metrics/dau', id: 'dau', label: 'DAU', trust: 'certified' }],
  terms: [{ ref: 'glossary/active-user', id: 'active-user', label: 'Active User', trust: 'draft' }],
  segments: [{ ref: 'segments/whales', id: 'whales', name: 'Whales' }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFocusEdges', () => {
  it('is idle with no edges when focusedRef is null', () => {
    resolutionMock.mockReturnValue({ data: null, loading: false, error: null });
    const { result } = renderHook(() => useFocusEdges(null));
    expect(result.current.edges).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('maps relations to typed edges rooted at the focused ref', () => {
    resolutionMock.mockReturnValue({ data: RELATIONS, loading: false, error: null });
    const { result } = renderHook(() => useFocusEdges('data_model/mf_users.dau'));

    expect(result.current.edges).toEqual([
      { from: 'data_model/mf_users.dau', to: 'data_model/mf_users.country', kind: 'field' },
      { from: 'data_model/mf_users.dau', to: 'business_metrics/dau', kind: 'metric' },
      { from: 'data_model/mf_users.dau', to: 'glossary/active-user', kind: 'term' },
      { from: 'data_model/mf_users.dau', to: 'segments/whales', kind: 'appSegment' },
    ]);
  });

  it('emits no edges while the resolution is still loading', () => {
    resolutionMock.mockReturnValue({ data: null, loading: true, error: null });
    const { result } = renderHook(() => useFocusEdges('business_metrics/dau'));
    expect(result.current.loading).toBe(true);
    expect(result.current.edges).toEqual([]);
  });

  it('surfaces a resolution error as a string', () => {
    resolutionMock.mockReturnValue({ data: null, loading: false, error: new Error('relations boom') });
    const { result } = renderHook(() => useFocusEdges('glossary/active-user'));
    expect(result.current.error).toBe('relations boom');
    expect(result.current.edges).toEqual([]);
  });
});
