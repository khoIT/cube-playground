import { describe, it, expect } from 'vitest';

/**
 * The useLibraryUrlState hook relies on react-router hooks at runtime. The
 * pure URL <-> state mapping is captured by the regex-light helpers below,
 * which mirror what the hook does for `readInitial` and the serialize step.
 *
 * If you change the hook, also update these tests + the hook.
 */

const FILTERS = ['all', 'live', 'static', 'broken'] as const;
const SORTS = ['recent', 'name', 'size'] as const;
type Filter = (typeof FILTERS)[number];
type Sort = (typeof SORTS)[number];

function readInitial(search: string): { query: string; filter: Filter; sort: Sort } {
  const sp = new URLSearchParams(search);
  const rawFilter = sp.get('filter');
  const rawSort = sp.get('sort');
  return {
    query: sp.get('q') ?? '',
    filter: (FILTERS as readonly string[]).includes(rawFilter ?? '') ? (rawFilter as Filter) : 'all',
    sort: (SORTS as readonly string[]).includes(rawSort ?? '') ? (rawSort as Sort) : 'recent',
  };
}

function serialize(state: { query: string; filter: Filter; sort: Sort }): string {
  const sp = new URLSearchParams();
  if (state.query) sp.set('q', state.query);
  if (state.filter !== 'all') sp.set('filter', state.filter);
  if (state.sort !== 'recent') sp.set('sort', state.sort);
  return sp.toString();
}

describe('useLibraryUrlState (pure mapping)', () => {
  it('reads defaults when search is empty', () => {
    expect(readInitial('')).toEqual({ query: '', filter: 'all', sort: 'recent' });
  });

  it('reads valid query+filter+sort from search', () => {
    expect(readInitial('?q=hello&filter=broken&sort=size')).toEqual({
      query: 'hello',
      filter: 'broken',
      sort: 'size',
    });
  });

  it('falls back to defaults on unknown filter / sort values', () => {
    expect(readInitial('?filter=garbage&sort=nope')).toEqual({
      query: '',
      filter: 'all',
      sort: 'recent',
    });
  });

  it('omits defaults from the serialized URL', () => {
    expect(serialize({ query: '', filter: 'all', sort: 'recent' })).toBe('');
  });

  it('serializes only non-default values', () => {
    expect(serialize({ query: 'hi', filter: 'live', sort: 'recent' })).toBe('q=hi&filter=live');
    expect(serialize({ query: '', filter: 'broken', sort: 'size' })).toBe('filter=broken&sort=size');
  });
});
