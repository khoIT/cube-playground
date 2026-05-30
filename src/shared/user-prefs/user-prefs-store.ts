/**
 * Adapter for user prefs (saved-views, subscriptions, recently-viewed). Now
 * DB-authoritative: values persist server-side per owner via the shared
 * preferences store, with a synchronous localStorage mirror for instant reads —
 * the "backend syncer behind the same API" this module always anticipated.
 *
 * All keys are namespaced under `compass:prefs:`. Values are JSON-serialised.
 * Reads return the default when the key is absent or storage is unavailable.
 */

import { getPref, setPref, removePref, subscribe } from '../../hooks/server-prefs-store';

const NS = 'compass:prefs:';

export interface UserPrefsStore<T> {
  read(): T;
  write(value: T): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

export function createUserPrefsStore<T>(
  key: string,
  initial: T,
): UserPrefsStore<T> {
  const ns = NS + key;
  const subs = new Set<() => void>();

  function notify() {
    for (const fn of subs) fn();
  }

  // Drive notifications off the backing store so local writes, cross-tab
  // writes, AND server hydration all reach subscribers through one path.
  subscribe(ns, notify);

  return {
    read(): T {
      const raw = getPref(ns);
      if (raw == null) return initial;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return initial;
      }
    },
    write(value: T): void {
      setPref(ns, JSON.stringify(value));
    },
    clear(): void {
      removePref(ns);
    },
    subscribe(cb): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
