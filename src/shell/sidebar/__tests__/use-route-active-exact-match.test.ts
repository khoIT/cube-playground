/**
 * useRouteActive — exact-match flag unit tests.
 *
 * exact:true  → matches ONLY the precise pathname, not sub-paths.
 * exact omitted → prefix behaviour (backward-compat): /liveops is active on
 *                 /liveops/retention and on /liveops itself.
 *
 * Uses renderHook + MemoryRouter to provide a real location context.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { useRouteActive } from '../use-route-active';

function wrapper(initialPath: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(MemoryRouter, { initialEntries: [initialPath] }, children);
  };
}

// ── exact:true ────────────────────────────────────────────────────────────────

describe('useRouteActive_exact_true_matches_only_precise_pathname', () => {
  it('returns true when pathname matches precisely', () => {
    const { result } = renderHook(() => useRouteActive('/liveops', undefined, true), {
      wrapper: wrapper('/liveops'),
    });
    expect(result.current).toBe(true);
  });

  it('returns false on a sub-path when exact is true', () => {
    const { result } = renderHook(() => useRouteActive('/liveops', undefined, true), {
      wrapper: wrapper('/liveops/retention'),
    });
    expect(result.current).toBe(false);
  });

  it('returns false on a deeper sub-path when exact is true', () => {
    const { result } = renderHook(() => useRouteActive('/liveops', undefined, true), {
      wrapper: wrapper('/liveops/alerts'),
    });
    expect(result.current).toBe(false);
  });

  it('returns false when pathname does not match at all', () => {
    const { result } = renderHook(() => useRouteActive('/liveops', undefined, true), {
      wrapper: wrapper('/chat'),
    });
    expect(result.current).toBe(false);
  });
});

// ── exact omitted (prefix behaviour) ─────────────────────────────────────────

describe('useRouteActive_prefix_behaviour_when_exact_omitted', () => {
  it('returns true on the exact path itself', () => {
    const { result } = renderHook(() => useRouteActive('/liveops'), {
      wrapper: wrapper('/liveops'),
    });
    expect(result.current).toBe(true);
  });

  it('returns true on a sub-path (prefix match)', () => {
    const { result } = renderHook(() => useRouteActive('/liveops'), {
      wrapper: wrapper('/liveops/retention'),
    });
    expect(result.current).toBe(true);
  });

  it('returns true on a deeper sub-path (prefix match)', () => {
    const { result } = renderHook(() => useRouteActive('/liveops'), {
      wrapper: wrapper('/liveops/alerts'),
    });
    expect(result.current).toBe(true);
  });

  it('returns false on a different top-level path', () => {
    const { result } = renderHook(() => useRouteActive('/liveops'), {
      wrapper: wrapper('/catalog'),
    });
    expect(result.current).toBe(false);
  });

  it('does NOT match /liveops-extra as a prefix of /liveops', () => {
    // The implementation appends "/" before prefix-checking, so /liveops-extra
    // must not fire for a /liveops prefix rule.
    const { result } = renderHook(() => useRouteActive('/liveops'), {
      wrapper: wrapper('/liveops-extra'),
    });
    expect(result.current).toBe(false);
  });
});

// ── root path edge case ───────────────────────────────────────────────────────

describe('useRouteActive_root_path', () => {
  it('matches "/" exactly and does not prefix-match other paths', () => {
    const { result: onRoot } = renderHook(() => useRouteActive('/'), {
      wrapper: wrapper('/'),
    });
    expect(onRoot.current).toBe(true);

    const { result: onOther } = renderHook(() => useRouteActive('/'), {
      wrapper: wrapper('/chat'),
    });
    expect(onOther.current).toBe(false);
  });
});

// ── query-string href ─────────────────────────────────────────────────────────

describe('useRouteActive_query_string_href', () => {
  it('matches only the full pathname+search when href contains "?"', () => {
    const { result: exact } = renderHook(
      () => useRouteActive('/build?query=abc'),
      { wrapper: wrapper('/build?query=abc') },
    );
    expect(exact.current).toBe(true);

    const { result: different } = renderHook(
      () => useRouteActive('/build?query=abc'),
      { wrapper: wrapper('/build?query=xyz') },
    );
    expect(different.current).toBe(false);
  });
});

// ── matchPrefix array ─────────────────────────────────────────────────────────

describe('useRouteActive_matchPrefix_array', () => {
  it('returns true when pathname matches any element in the prefix array', () => {
    const { result } = renderHook(
      () => useRouteActive(undefined, ['/liveops', '/catalog']),
      { wrapper: wrapper('/catalog/data-model') },
    );
    expect(result.current).toBe(true);
  });

  it('returns false when pathname matches none of the array elements', () => {
    const { result } = renderHook(
      () => useRouteActive(undefined, ['/liveops', '/catalog']),
      { wrapper: wrapper('/chat') },
    );
    expect(result.current).toBe(false);
  });
});
