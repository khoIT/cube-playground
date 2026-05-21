/**
 * Unit tests for the pure helpers + hook behavior in use-results-selection.ts.
 * Covers both modes:
 *   - identity-uid mode (rowKey extracted via identity dim)
 *   - expansion mode (rowKey = stable hash of non-identity dims)
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  extractUid,
  inferCubeAndIdentity,
  inferIdentityGap,
  stableRowHash,
  useResultsSelection,
  type GetRowKey,
} from '../use-results-selection';

describe('extractUid', () => {
  it('returns null when identityField is null', () => {
    expect(extractUid({ 'mf_users.user_id': 42 }, null)).toBeNull();
  });
  it('coerces numeric uid to string', () => {
    expect(extractUid({ 'mf_users.user_id': 42 }, 'mf_users.user_id')).toBe('42');
  });
  it('returns null when uid is missing/undefined', () => {
    expect(extractUid({}, 'mf_users.user_id')).toBeNull();
  });
});

describe('stableRowHash', () => {
  it('returns null when no dim names given', () => {
    expect(stableRowHash({ a: 1 }, [])).toBeNull();
  });
  it('produces the same hash for the same dim values regardless of insertion order in row', () => {
    const a = stableRowHash({ x: 1, y: 'V' }, ['x', 'y']);
    const b = stableRowHash({ y: 'V', x: 1 }, ['x', 'y']);
    expect(a).toBe(b);
  });
  it('differs when a value differs', () => {
    expect(stableRowHash({ x: 1 }, ['x'])).not.toBe(stableRowHash({ x: 2 }, ['x']));
  });
  it('treats null/undefined consistently', () => {
    expect(stableRowHash({ x: null }, ['x'])).toBe(stableRowHash({}, ['x']));
  });
});

describe('inferCubeAndIdentity', () => {
  const has = (c: string) => c === 'mf_users';
  const fieldFor = (c: string) => (c === 'mf_users' ? 'mf_users.user_id' : null);

  it('detects identity from a query with the mapped identity dimension', () => {
    expect(
      inferCubeAndIdentity({ dimensions: ['mf_users.user_id'] }, has, fieldFor),
    ).toEqual({ cube: 'mf_users', identityField: 'mf_users.user_id' });
  });

  it('returns nulls when no dimension matches identity', () => {
    expect(
      inferCubeAndIdentity({ dimensions: ['mf_users.country'] }, has, fieldFor),
    ).toEqual({ cube: null, identityField: null });
  });

  it('returns nulls when executedQuery is null', () => {
    expect(inferCubeAndIdentity(null, has, fieldFor)).toEqual({
      cube: null,
      identityField: null,
    });
  });
});

describe('inferIdentityGap', () => {
  const has = (c: string) => c === 'mf_users';
  const fieldFor = (c: string) => (c === 'mf_users' ? 'mf_users.user_id' : null);

  it('returns gap when identity-bearing cube is queried without identity dim', () => {
    expect(
      inferIdentityGap({ dimensions: ['mf_users.first_login_month'] }, has, fieldFor),
    ).toEqual({ cube: 'mf_users', identityField: 'mf_users.user_id' });
  });

  it('returns null when query already includes the identity dim', () => {
    expect(
      inferIdentityGap({ dimensions: ['mf_users.user_id'] }, has, fieldFor),
    ).toBeNull();
  });

  it('returns null when no queried cube has identity configured', () => {
    expect(
      inferIdentityGap({ dimensions: ['active_daily.log_date'] }, has, fieldFor),
    ).toBeNull();
  });

  it('returns null when query has no dimensions', () => {
    expect(inferIdentityGap({ dimensions: [] }, has, fieldFor)).toBeNull();
    expect(inferIdentityGap(null, has, fieldFor)).toBeNull();
  });
});

describe('useResultsSelection (uid mode)', () => {
  const query = { dimensions: ['mf_users.user_id'] };
  const uidKey: GetRowKey = (r) => extractUid(r, 'mf_users.user_id');

  it('starts empty and reflects toggled keys', () => {
    const { result } = renderHook(() => useResultsSelection(query, uidKey));
    expect(result.current.selectedUids).toEqual([]);
    act(() => result.current.toggle('u-1'));
    expect(result.current.isSelected('u-1')).toBe(true);
    act(() => result.current.toggle('u-1'));
    expect(result.current.isSelected('u-1')).toBe(false);
  });

  it('togglePage adds all unselected uids from rows, then removes if all selected', () => {
    const rows = [
      { 'mf_users.user_id': 1 },
      { 'mf_users.user_id': 2 },
      { 'mf_users.user_id': 3 },
    ];
    const { result } = renderHook(() => useResultsSelection(query, uidKey));
    act(() => result.current.togglePage(rows));
    expect(result.current.selectedUids.sort()).toEqual(['1', '2', '3']);
    expect(result.current.pageState(rows)).toBe('all');
    act(() => result.current.togglePage(rows));
    expect(result.current.selectedUids).toEqual([]);
  });

  it('pageState returns "some" when partially selected', () => {
    const rows = [
      { 'mf_users.user_id': 1 },
      { 'mf_users.user_id': 2 },
    ];
    const { result } = renderHook(() => useResultsSelection(query, uidKey));
    act(() => result.current.toggle('1'));
    expect(result.current.pageState(rows)).toBe('some');
  });

  it('clears selection when executedQuery changes', () => {
    const { result, rerender } = renderHook(
      ({ q }: { q: unknown }) => useResultsSelection(q, uidKey),
      { initialProps: { q: query as unknown } },
    );
    act(() => result.current.toggle('99'));
    expect(result.current.selectedUids).toEqual(['99']);
    rerender({ q: { dimensions: ['mf_users.user_id'], measures: ['mf_users.arpu_vnd'] } });
    expect(result.current.selectedUids).toEqual([]);
  });

  it('ignores rows missing the identity field in togglePage', () => {
    const rows = [{ 'mf_users.user_id': 1 }, { foo: 'bar' }];
    const { result } = renderHook(() => useResultsSelection(query, uidKey));
    act(() => result.current.togglePage(rows));
    expect(result.current.selectedUids).toEqual(['1']);
  });
});

describe('useResultsSelection (expansion mode)', () => {
  const aggQuery = { dimensions: ['mf_users.first_login_month'] };
  const dims = ['mf_users.first_login_month'];
  const cohortKey: GetRowKey = (r) => stableRowHash(r, dims);

  it('selects cohort rows by stable hash', () => {
    const rows = [
      { 'mf_users.first_login_month': '2025-05-01', 'mf_users.arpu_vnd': 1000 },
      { 'mf_users.first_login_month': '2025-06-01', 'mf_users.arpu_vnd': 2000 },
    ];
    const { result } = renderHook(() => useResultsSelection(aggQuery, cohortKey));
    act(() => result.current.toggle(cohortKey(rows[0])!));
    expect(result.current.isSelected(cohortKey(rows[0])!)).toBe(true);
    expect(result.current.isSelected(cohortKey(rows[1])!)).toBe(false);
  });

  it('togglePage cycles all cohort rows', () => {
    const rows = [
      { 'mf_users.first_login_month': '2025-05-01' },
      { 'mf_users.first_login_month': '2025-06-01' },
    ];
    const { result } = renderHook(() => useResultsSelection(aggQuery, cohortKey));
    act(() => result.current.togglePage(rows));
    expect(result.current.pageState(rows)).toBe('all');
    act(() => result.current.togglePage(rows));
    expect(result.current.pageState(rows)).toBe('none');
  });
});
