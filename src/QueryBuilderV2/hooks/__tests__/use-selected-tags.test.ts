/**
 * use-selected-tags.test.ts
 * URL <-> Set<string> parsing logic. The hook itself wraps useHistory/useLocation
 * from react-router-dom — we test the pure parsing/serialisation logic separately.
 */

import { describe, it, expect } from 'vitest';

function parseTagsParam(search: string): Set<string> {
  const params = new URLSearchParams(search);
  const raw = params.get('tags');
  if (!raw) return new Set<string>();
  return new Set(raw.split(',').filter(Boolean));
}

function serialiseTags(next: Set<string>, currentSearch: string): string {
  const params = new URLSearchParams(currentSearch);
  if (next.size === 0) {
    params.delete('tags');
  } else {
    params.set('tags', Array.from(next).sort().join(','));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

describe('useSelectedTags URL serialisation', () => {
  it('parses empty / missing tags param to empty set', () => {
    expect(parseTagsParam('').size).toBe(0);
    expect(parseTagsParam('?foo=bar').size).toBe(0);
    expect(parseTagsParam('?tags=').size).toBe(0);
  });

  it('parses single tag', () => {
    const set = parseTagsParam('?tags=revenue');
    expect([...set]).toEqual(['revenue']);
  });

  it('parses comma-delimited tags', () => {
    const set = parseTagsParam('?tags=revenue,daily,core');
    expect(new Set(set)).toEqual(new Set(['revenue', 'daily', 'core']));
  });

  it('drops empty entries from commas', () => {
    const set = parseTagsParam('?tags=,,revenue,,');
    expect([...set]).toEqual(['revenue']);
  });

  it('case-sensitive parsing', () => {
    const set = parseTagsParam('?tags=Revenue,revenue');
    expect(set.size).toBe(2);
    expect(set.has('Revenue')).toBe(true);
    expect(set.has('revenue')).toBe(true);
  });

  it('serialise empty set drops tags param', () => {
    expect(serialiseTags(new Set(), '?tags=old')).toBe('');
    expect(serialiseTags(new Set(), '?tags=old&keep=true')).toBe('?keep=true');
  });

  it('serialise non-empty set joins alphabetically', () => {
    expect(serialiseTags(new Set(['revenue', 'daily']), '')).toBe('?tags=daily%2Crevenue');
  });

  it('preserves other params during serialise', () => {
    const result = serialiseTags(new Set(['x']), '?foo=bar');
    expect(result).toContain('foo=bar');
    expect(result).toContain('tags=x');
  });
});
