import { describe, it, expect, beforeEach } from 'vitest';
import deepEqual from 'fast-deep-equal';
import {
  createPlaygroundStore,
  PLAYGROUND_PREFS_KEY,
} from '../playground-store';

// H6 (red team): the bridge effect that mirrors useQueryBuilder state into
// the playground store must (a) skip writes when source equals destination
// to avoid infinite loops, (b) treat `resultSet` as a one-way slice so
// store readers never write back to the hook state. These tests exercise
// the deep-equal-skip semantics that the bridge will reuse.

beforeEach(() => {
  try {
    window.localStorage.removeItem(PLAYGROUND_PREFS_KEY);
  } catch {
    /* noop */
  }
});

describe('bridge comparator semantics (H6)', () => {
  it('deep-equal skip: re-applying the same query does not trigger subscribers', () => {
    const s = createPlaygroundStore();
    s.getState().setQuery({ measures: ['x'] } as any);

    let notifications = 0;
    s.subscribe((state, prev) => {
      if (state.query !== prev.query) notifications += 1;
    });

    // Simulate the bridge re-evaluating: deep-equal check would skip.
    const next = { measures: ['x'] } as any;
    if (!deepEqual(s.getState().query, next)) {
      s.getState().setQuery(next);
    }
    expect(notifications).toBe(0);
  });

  it('shallow-different but deep-equal query objects skip writes', () => {
    const s = createPlaygroundStore();
    const first = { measures: ['x'], dimensions: ['a'] } as any;
    s.getState().setQuery(first);

    let notifications = 0;
    s.subscribe((state, prev) => {
      if (state.query !== prev.query) notifications += 1;
    });

    // New literal with same shape — reference is different but deepEqual passes.
    const second = { measures: ['x'], dimensions: ['a'] } as any;
    expect(first).not.toBe(second);
    if (!deepEqual(s.getState().query, second)) {
      s.getState().setQuery(second);
    }
    expect(notifications).toBe(0);
  });

  it('one-way slice: setResultSet always writes (treated as new identity)', () => {
    const s = createPlaygroundStore();
    let notifications = 0;
    s.subscribe((state, prev) => {
      if (state.resultSet !== prev.resultSet) notifications += 1;
    });
    s.getState().setResultSet({ id: 1 } as any);
    s.getState().setResultSet({ id: 1 } as any); // fresh literal, same data
    expect(notifications).toBe(2);
  });

  it('two-slice update in a single tick does not loop', () => {
    const s = createPlaygroundStore();
    let totalNotifications = 0;
    s.subscribe(() => {
      totalNotifications += 1;
    });
    s.getState().setQuery({ measures: ['a'] } as any);
    s.getState().setPivotConfig({ x: ['a'] } as any);
    // Two writes, two notifications — no runaway loop.
    expect(totalNotifications).toBe(2);
  });
});
