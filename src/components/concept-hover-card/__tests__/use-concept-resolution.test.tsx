import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Controllable mock of the concepts client so we can settle the fetch on demand.
let resolveFetch: (v: unknown) => void;
let callCount = 0;
vi.mock('../../../api/concepts-client', () => ({
  getConceptRelations: vi.fn(() => {
    callCount += 1;
    return new Promise((res) => { resolveFetch = res; });
  }),
}));

import { useConceptResolution, _resetConceptResolutionCache } from '../use-concept-resolution';

const REF = 'data_model/mf_users.payer_tier';
const PAYLOAD = { ref: REF, fields: [], metrics: [], terms: [], segments: [{ ref: 'segments/s1', id: 's1', name: 'Whales' }] };

describe('useConceptResolution', () => {
  beforeEach(() => {
    _resetConceptResolutionCache();
    callCount = 0;
  });

  it('shares one fetch across concurrent subscribers for the same ref', async () => {
    const a = renderHook(() => useConceptResolution(REF));
    const b = renderHook(() => useConceptResolution(REF));
    resolveFetch(PAYLOAD);
    await waitFor(() => expect(a.result.current.data).not.toBeNull());
    await waitFor(() => expect(b.result.current.data).not.toBeNull());
    expect(callCount).toBe(1); // de-duped via module cache
    expect(a.result.current.data?.segments[0].name).toBe('Whales');
  });

  it('an early-unmounting subscriber does NOT poison the cache for others (H3 guard)', async () => {
    const first = renderHook(() => useConceptResolution(REF));
    const second = renderHook(() => useConceptResolution(REF));
    // First subscriber leaves before the request settles.
    first.unmount();
    // Fetch completes afterwards — must still resolve to data, not an AbortError.
    resolveFetch(PAYLOAD);
    await waitFor(() => expect(second.result.current.data).not.toBeNull());
    expect(second.result.current.error).toBeNull();
    expect(second.result.current.data?.segments[0].name).toBe('Whales');
  });

  it('returns idle state for a null ref without fetching', () => {
    const { result } = renderHook(() => useConceptResolution(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(callCount).toBe(0);
  });
});
