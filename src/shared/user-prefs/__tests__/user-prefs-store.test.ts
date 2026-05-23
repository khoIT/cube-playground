import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createUserPrefsStore } from '../user-prefs-store';

beforeEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
});

afterEach(() => {
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('createUserPrefsStore', () => {
  it('returns initial when nothing stored', () => {
    const s = createUserPrefsStore<{ items: string[] }>('a', { items: [] });
    expect(s.read()).toEqual({ items: [] });
  });

  it('roundtrips writes', () => {
    const s = createUserPrefsStore<{ items: string[] }>('b', { items: [] });
    s.write({ items: ['x', 'y'] });
    expect(s.read()).toEqual({ items: ['x', 'y'] });
  });

  it('notifies subscribers on write + clear', () => {
    const s = createUserPrefsStore<number>('c', 0);
    let count = 0;
    const unsub = s.subscribe(() => count++);
    s.write(1);
    s.write(2);
    s.clear();
    unsub();
    s.write(3);
    expect(count).toBe(3);
  });

  it('returns initial on malformed JSON', () => {
    const s = createUserPrefsStore<number>('d', 99);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('compass:prefs:d', '{not-json');
    }
    expect(s.read()).toBe(99);
  });

  it('namespaces keys under compass:prefs:', () => {
    const s = createUserPrefsStore<string>('e', 'init');
    s.write('hello');
    if (typeof window !== 'undefined') {
      expect(window.localStorage.getItem('compass:prefs:e')).toBe('"hello"');
    }
  });
});
