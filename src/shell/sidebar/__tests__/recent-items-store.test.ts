/**
 * Regression tests for the recent-items-store contract that the playground
 * tray relies on. The store is the source of truth for sidebar Q-rows; if
 * pushRecent stops deduping by id, editing a query in the query builder
 * spawns a duplicate tray entry per edit.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  getRecent,
  pushRecent,
  removeRecent,
} from '../recent-items-store';

const ITEM = (id: string, title = `t-${id}`) => ({
  id,
  title,
  updatedAt: new Date().toISOString(),
  href: `/build?query=${id}`,
});

beforeEach(() => {
  localStorage.clear();
});

describe('pushRecent — playground module', () => {
  it('replaces an existing row when the same id is pushed again (edit-in-place)', () => {
    pushRecent('playground', ITEM('1', 'Q1: count'));
    pushRecent('playground', ITEM('1', 'Q1: count × country'));

    const rows = getRecent('playground');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Q1: count × country');
  });

  it('keeps distinct tab ids as separate rows', () => {
    pushRecent('playground', ITEM('1'));
    pushRecent('playground', ITEM('2'));

    const ids = getRecent('playground').map((r) => r.id);
    expect(ids.sort()).toEqual(['1', '2']);
  });

  it('removeRecent evicts the matching tab id', () => {
    pushRecent('playground', ITEM('1'));
    pushRecent('playground', ITEM('2'));

    removeRecent('playground', '1');

    const ids = getRecent('playground').map((r) => r.id);
    expect(ids).toEqual(['2']);
  });
});

describe('getRecent — playground self-healing filter', () => {
  it('strips non-numeric ids left over from the prior fingerprint-keyed scheme', () => {
    // Hand-craft a v2 bucket containing one stale fingerprint id and one valid
    // tab-id row, mimicking a localStorage state from before the fix landed.
    const stored = [
      { id: 'abc12xy', title: 'stale', updatedAt: 'x', href: '/build' },
      { id: '1', title: 'fresh', updatedAt: 'y', href: '/build' },
    ];
    // Key shape: gds-cube.recent.v2.{module}.{workspace}.{gameId}; both
    // localStorage keys are unset in this test → both axes fall back to
    // '__default__'.
    localStorage.setItem(
      'gds-cube.recent.v2.playground.__default__.__default__',
      JSON.stringify(stored),
    );

    const rows = getRecent('playground');
    expect(rows.map((r) => r.id)).toEqual(['1']);
  });
});
