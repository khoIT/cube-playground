/**
 * Unit tests for the pure helpers + hook behavior in use-results-selection.ts.
 * Covers the bug class fixed in this change: row-level checkbox selection on
 * Playground Results when the executed query exposes a configured identity
 * dimension.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  extractUid,
  inferCubeAndIdentity,
  useResultsSelection,
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

describe('useResultsSelection', () => {
  const query = { dimensions: ['mf_users.user_id'] };

  it('starts empty and reflects toggled uids', () => {
    const { result } = renderHook(() => useResultsSelection(query, 'mf_users.user_id'));
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
    const { result } = renderHook(() => useResultsSelection(query, 'mf_users.user_id'));
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
    const { result } = renderHook(() => useResultsSelection(query, 'mf_users.user_id'));
    act(() => result.current.toggle('1'));
    expect(result.current.pageState(rows)).toBe('some');
  });

  it('clears selection when executedQuery changes', () => {
    const { result, rerender } = renderHook(
      ({ q }) => useResultsSelection(q, 'mf_users.user_id'),
      { initialProps: { q: query } },
    );
    act(() => result.current.toggle('99'));
    expect(result.current.selectedUids).toEqual(['99']);
    rerender({ q: { dimensions: ['mf_users.user_id'], measures: ['mf_users.arpu_vnd'] } });
    expect(result.current.selectedUids).toEqual([]);
  });

  it('ignores rows missing the identity field in togglePage', () => {
    const rows = [{ 'mf_users.user_id': 1 }, { foo: 'bar' }];
    const { result } = renderHook(() => useResultsSelection(query, 'mf_users.user_id'));
    act(() => result.current.togglePage(rows));
    expect(result.current.selectedUids).toEqual(['1']);
  });
});
