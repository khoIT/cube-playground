import { describe, it, expect, beforeEach } from 'vitest';

import { setPref, removePref } from '../../hooks/server-prefs-store';
import {
  createPlaygroundStore,
  PLAYGROUND_PREFS_KEY,
} from '../playground-store';

beforeEach(() => {
  // Remove via the store API so the in-memory cache is flushed alongside localStorage.
  removePref(PLAYGROUND_PREFS_KEY);
});

describe('playground-store factory', () => {
  it('C1: two stores from createPlaygroundStore() are independent', () => {
    const a = createPlaygroundStore();
    const b = createPlaygroundStore();
    a.getState().setQuery({ measures: ['a.count'] } as any);
    expect(a.getState().query).toEqual({ measures: ['a.count'] });
    expect(b.getState().query).toBeNull();
  });

  it('setQuery clears executedQuery and resultSet (existing semantics)', () => {
    const s = createPlaygroundStore();
    s.getState().setExecutedQuery({ measures: ['x'] } as any);
    s.getState().setResultSet({ x: 1 } as any);
    s.getState().setQuery({ measures: ['y'] } as any);
    expect(s.getState().query).toEqual({ measures: ['y'] });
    expect(s.getState().executedQuery).toBeNull();
    expect(s.getState().resultSet).toBeNull();
  });

  it('selector subscribers only fire when their slice changes', () => {
    const s = createPlaygroundStore();
    let queryNotifications = 0;
    let rsNotifications = 0;
    s.subscribe((state, prev) => {
      if (state.query !== prev.query) queryNotifications += 1;
      if (state.resultSet !== prev.resultSet) rsNotifications += 1;
    });
    s.getState().setResultSet({ id: 1 } as any);
    expect(queryNotifications).toBe(0);
    expect(rsNotifications).toBe(1);
    s.getState().setQuery({ measures: ['a'] } as any);
    expect(queryNotifications).toBe(1);
  });

  it('C3: persist middleware writes only chartType and pivotConfig', () => {
    const s = createPlaygroundStore();
    s.getState().setQuery({ measures: ['x.y'] } as any);
    s.getState().setChartType('bar' as any);
    s.getState().setPivotConfig({ x: ['a'], y: ['b'] } as any);

    // The store writes through to the pref store (mirror = localStorage).
    const raw = window.localStorage.getItem(PLAYGROUND_PREFS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // Zustand persist writes { state: {...}, version }.
    expect(parsed.state).toEqual({
      chartType: 'bar',
      pivotConfig: { x: ['a'], y: ['b'] },
    });
    expect(parsed.state.query).toBeUndefined();
  });

  it('hydrating from localStorage restores chartType + pivotConfig but not query', () => {
    // Seed via setPref so the in-memory cache is warmed (getPref prefers cache over localStorage).
    setPref(
      PLAYGROUND_PREFS_KEY,
      JSON.stringify({
        state: {
          chartType: 'line',
          pivotConfig: { x: ['a'] },
          // attempt to smuggle a query in — it must be ignored.
          query: { measures: ['evil.injection'] },
        },
        version: 0,
      }),
    );

    const s = createPlaygroundStore();
    // Zustand persist hydrates synchronously in default config.
    expect(s.getState().chartType).toBe('line');
    expect(s.getState().pivotConfig).toEqual({ x: ['a'] });
    // The persisted-but-ignored `query` is NOT applied to state.
    // (URL is the source of truth for query.)
    expect(s.getState().query).toBeNull();
  });

  it('reset() clears query and result set', () => {
    const s = createPlaygroundStore();
    s.getState().setQuery({ measures: ['x'] } as any);
    s.getState().setResultSet({ id: 9 } as any);
    s.getState().reset();
    expect(s.getState().query).toBeNull();
    expect(s.getState().resultSet).toBeNull();
  });
});
