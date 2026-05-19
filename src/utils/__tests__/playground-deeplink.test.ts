import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPlaygroundDeeplink,
  mergeUidFilter,
  defaultBaseQuery,
  readDeeplinkFromStorage,
  clearDeeplinkStorage,
} from '../playground-deeplink';

beforeEach(() => {
  sessionStorage.clear();
});

describe('mergeUidFilter', () => {
  it('appends an IN filter on top of an existing query', () => {
    const out = mergeUidFilter(
      { measures: ['mf_users.count'] },
      'mf_users.user_id',
      ['u1', 'u2'],
    );
    expect(out.filters).toEqual([
      { member: 'mf_users.user_id', operator: 'in', values: ['u1', 'u2'] },
    ]);
    expect(out.measures).toEqual(['mf_users.count']);
  });
});

describe('defaultBaseQuery', () => {
  it('returns a count measure for the primary cube', () => {
    expect(defaultBaseQuery('mf_users')).toEqual({ measures: ['mf_users.count'] });
  });
  it('returns an empty query when cube is null', () => {
    expect(defaultBaseQuery(null)).toEqual({});
  });
});

describe('buildPlaygroundDeeplink', () => {
  it('inlines small uid lists in the URL', () => {
    const out = buildPlaygroundDeeplink({
      segmentId: 'seg1',
      segmentName: 'tiny',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids: ['u1', 'u2', 'u3'],
    });
    expect(out.via).toBe('inline');
    expect(out.url).toContain('#/build?query=');
  });

  it('falls back to sessionStorage handoff for huge uid lists', () => {
    const uids = Array.from({ length: 1500 }, (_, i) => `uid_${i}`);
    const out = buildPlaygroundDeeplink({
      segmentId: 'seg-big',
      segmentName: 'huge',
      identityDim: 'mf_users.user_id',
      primaryCube: 'mf_users',
      uids,
    });
    expect(out.via).toBe('session-storage');
    expect(out.url).toContain('from-segment=seg-big');

    const restored = readDeeplinkFromStorage('seg-big');
    expect(restored).not.toBeNull();
    expect(((restored as { filters: Array<{ values: string[] }> }).filters[0].values)).toHaveLength(1500);
  });

  it('clearDeeplinkStorage removes the persisted entry', () => {
    sessionStorage.setItem('gds-cube:pending-deeplink:seg-x', 'whatever');
    clearDeeplinkStorage('seg-x');
    expect(sessionStorage.getItem('gds-cube:pending-deeplink:seg-x')).toBeNull();
  });
});
