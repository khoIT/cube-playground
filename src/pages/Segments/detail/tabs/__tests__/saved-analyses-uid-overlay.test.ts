/**
 * Tests for the uid-IN overlay in saved-analyses "Open in Playground".
 *
 * Verifies that buildPlaygroundDeeplink is used to apply the segment's uid list
 * as an IN filter over the saved analysis query, restoring the original behavior
 * that was silently dropped when the tab was migrated.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPlaygroundDeeplink,
  mergeUidFilter,
  readDeeplinkFromStorage,
} from '../../../../../utils/playground-deeplink';

beforeEach(() => {
  sessionStorage.clear();
});

// ── mergeUidFilter ─────────────────────────────────────────────────────────────
// The overlay helper is the core primitive used by saved-analyses-tab.

describe('mergeUidFilter — uid overlay for saved analyses', () => {
  it('prepends an IN filter on the identity dim over the base query', () => {
    const baseQuery = {
      measures: ['mf_users.arpu_vnd'],
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
    };
    const merged = mergeUidFilter(baseQuery, 'mf_users.user_id', ['u1', 'u2']);
    const filters = merged.filters as Array<{ member: string; operator: string; values: string[] }>;
    // Original filter preserved
    expect(filters.find((f) => f.member === 'mf_users.country')).toBeDefined();
    // uid IN filter appended
    const uidFilter = filters.find((f) => f.member === 'mf_users.user_id');
    expect(uidFilter).toBeDefined();
    expect(uidFilter?.operator).toBe('in');
    expect(uidFilter?.values).toEqual(['u1', 'u2']);
    // Original measures preserved
    expect(merged.measures).toEqual(['mf_users.arpu_vnd']);
  });

  it('works on a query with no existing filters', () => {
    const merged = mergeUidFilter({}, 'mf_users.user_id', ['u1']);
    const filters = merged.filters as Array<{ member: string }>;
    expect(filters).toHaveLength(1);
    expect(filters[0].member).toBe('mf_users.user_id');
  });

  it('does not mutate the base query', () => {
    const base = { filters: [{ member: 'x', operator: 'equals', values: ['1'] }] };
    const copy = JSON.parse(JSON.stringify(base));
    mergeUidFilter(base, 'mf_users.user_id', ['u1']);
    expect(base).toEqual(copy);
  });
});

// ── buildPlaygroundDeeplink — inline overlay path ────────────────────────────

describe('buildPlaygroundDeeplink — saved-analyses uid overlay', () => {
  it('inlines a small uid list as an IN filter in the URL', () => {
    const base = { measures: ['mf_users.arpu_vnd'], filters: [] };
    const result = buildPlaygroundDeeplink({
      segmentId: 'seg-1',
      segmentName: 'Top Spenders',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids: ['u1', 'u2', 'u3'],
      baseQuery: base,
    });
    expect(result.via).toBe('inline');
    const q = JSON.parse(decodeURIComponent(result.url.replace('#/build?query=', ''))) as any;
    const uidFilter = (q.filters as any[]).find((f: any) => f.member === 'mf_users.user_id');
    expect(uidFilter).toBeDefined();
    expect(uidFilter.operator).toBe('in');
    expect(uidFilter.values).toEqual(['u1', 'u2', 'u3']);
  });

  it('falls back to sessionStorage for large uid lists', () => {
    const uids = Array.from({ length: 1500 }, (_, i) => `uid_${i}`);
    const result = buildPlaygroundDeeplink({
      segmentId: 'seg-big',
      segmentName: 'huge',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids,
    });
    expect(result.via).toBe('session-storage');
    // Query stashed with uid IN filter
    const stored = readDeeplinkFromStorage('seg-big');
    expect(stored).not.toBeNull();
    const filters = (stored as any).filters as any[];
    const uidFilter = filters.find((f: any) => f.member === 'mf_users.user_id');
    expect(uidFilter?.values).toHaveLength(1500);
  });

  it('base query measures and original filters are preserved in the overlay', () => {
    const base = {
      measures: ['mf_users.arpu_vnd'],
      filters: [{ member: 'mf_users.country', operator: 'equals', values: ['VN'] }],
      dimensions: ['mf_users.user_id'],
    };
    const result = buildPlaygroundDeeplink({
      segmentId: 'seg-2',
      segmentName: 'VN Spenders',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids: ['u1'],
      baseQuery: base,
    });
    const q = JSON.parse(decodeURIComponent(result.url.replace('#/build?query=', ''))) as any;
    // Measures preserved
    expect(q.measures).toEqual(['mf_users.arpu_vnd']);
    // Original filter preserved
    expect((q.filters as any[]).find((f: any) => f.member === 'mf_users.country')).toBeDefined();
    // Uid overlay added
    expect((q.filters as any[]).find((f: any) => f.member === 'mf_users.user_id')).toBeDefined();
  });
});
