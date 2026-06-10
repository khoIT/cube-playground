/**
 * React bindings for the DB-authoritative preferences store.
 *
 * `useServerPref` is a drop-in for the legacy `useLocalStorage` hook: same
 * `[value, setValue, removeValue]` tuple and JSON value semantics, but the
 * value is persisted to the server (per owner) and only mirrored to
 * localStorage for synchronous first-paint / cross-tab reads. See
 * `server-prefs-store.ts` for the storage contract.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getPref,
  setPref,
  removePref,
  subscribe,
  hydrateServerPrefs,
} from './server-prefs-store';

function decode<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Persisted, device-portable preference. JSON-serialized like the legacy
 * localStorage hook it replaces.
 */
export function useServerPref<T>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void, () => void] {
  // Hold the latest default in a ref so the sync effect can re-read fresh
  // values without listing `defaultValue` as a dependency. An inline object/
  // array default (e.g. `useServerPref(key, {})`) changes identity on every
  // render; if it drove the effect, each render would re-run it and call
  // `setValue` with a freshly JSON-parsed (new-reference) value, looping
  // forever ("Maximum update depth exceeded"). Keying only on `key` matches
  // the loop-safe `useLocalStorage` contract this hook replaces.
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  const read = useCallback((): T => decode(getPref(key), defaultRef.current), [key]);

  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    setValue(read());
    const unsub = subscribe(key, () => setValue(read()));
    return unsub;
  }, [key, read]);

  const set = useCallback(
    (next: T) => {
      setPref(key, JSON.stringify(next));
    },
    [key],
  );

  const remove = useCallback(() => {
    removePref(key);
  }, [key]);

  return [value, set, remove];
}

/**
 * Boot hook — pulls the owner's server prefs into the cache + mirror once the
 * authenticated owner is known, then imports any legacy local-only values. Re-
 * runs when the owner identity changes (e.g. after SSO login) so the next
 * user's prefs replace the previous session's.
 */
export function useServerPrefsBootstrap(ownerKey: string | null): void {
  const lastOwner = useRef<string | null>(null);
  useEffect(() => {
    if (lastOwner.current === ownerKey) return;
    lastOwner.current = ownerKey;
    void hydrateServerPrefs();
  }, [ownerKey]);
}
