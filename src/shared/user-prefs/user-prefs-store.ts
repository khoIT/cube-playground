/**
 * Tiny localStorage adapter for user prefs. Single source of truth for
 * subscribe / saved-views / recently-viewed. v1 = single-user dev profile;
 * multi-user prod will swap in a backend syncer behind the same API.
 *
 * All keys are namespaced under `compass:prefs:`. Values are JSON-serialised.
 * Reads return the default when the key is absent or storage is unavailable.
 */

const NS = 'compass:prefs:';

export interface UserPrefsStore<T> {
  read(): T;
  write(value: T): void;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
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

  return {
    read(): T {
      const ls = safeLocalStorage();
      if (!ls) return initial;
      try {
        const raw = ls.getItem(ns);
        if (!raw) return initial;
        return JSON.parse(raw) as T;
      } catch {
        return initial;
      }
    },
    write(value: T): void {
      const ls = safeLocalStorage();
      if (!ls) return;
      try {
        ls.setItem(ns, JSON.stringify(value));
        notify();
      } catch {
        // quota exceeded / disabled — surface silently
      }
    },
    clear(): void {
      const ls = safeLocalStorage();
      if (!ls) return;
      try {
        ls.removeItem(ns);
        notify();
      } catch {
        /* ignored */
      }
    },
    subscribe(cb): () => void {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
