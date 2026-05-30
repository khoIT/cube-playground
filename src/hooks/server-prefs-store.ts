/**
 * DB-authoritative client preferences with a synchronous localStorage mirror.
 *
 * The server (`/api/user-prefs`, scoped per authenticated owner) is the source
 * of truth, so a user's preferences and view-state follow them across devices.
 * localStorage is kept ONLY as a synchronous write-through mirror: the many
 * synchronous readers (request-header injection in `api-client` /
 * `cube-api-factory`, first-paint reads) stay synchronous, and a reload that
 * races ahead of hydration still renders the last-known values.
 *
 * The one thing that never moves to the DB is the session credential
 * (`gds-cube:app-jwt` / `gds-cube:token`) — it authenticates the very request
 * that loads these prefs, so storing it server-side is circular. Cross-tab
 * event-bus keys (the `*-change` / `*-changed` signals) and the per-tab id
 * also stay local; they carry throwaway signals, not user data.
 *
 * Contract:
 *   getPref(key)          sync read   (in-memory cache → localStorage mirror)
 *   setPref(key, value)   cache + mirror (sync) + PUT  (async, best-effort)
 *   removePref(key)       cache + mirror (sync) + DELETE (async)
 *   subscribe(key, cb)    fires on local writes, cross-tab writes, AND
 *                         hydration reconciliation
 *   hydrateServerPrefs()  pull all server prefs → server wins over the mirror →
 *                         then import any legacy local-only values up once.
 *
 * Pref keys ARE the existing `gds-cube:*` localStorage keys, so the mirror is
 * byte-identical to what legacy synchronous readers already consume — the
 * migration is transparent to them.
 */

import { readAppToken } from '../auth/auth-storage';

const cache = new Map<string, string>();

type Listener = (value: string | null) => void;
const listeners = new Map<string, Set<Listener>>();

function notify(key: string, value: string | null): void {
  listeners.get(key)?.forEach((l) => l(value));
}

function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / privacy mode — cache still holds the value this session */
  }
}
function lsRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Network — plain fetch with inlined auth headers. We deliberately avoid the
// `apiFetch` wrapper to keep this module free of the
// api-client → workspace-context → server-prefs import cycle. The server reads
// the owner from the validated JWT (falling back to X-Owner in dev), exactly
// like the segments / dashboards / cube-aliases routes.
// ---------------------------------------------------------------------------

function authHeaders(json: boolean): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  const owner = lsGet('gds-cube:owner');
  if (owner) h['X-Owner'] = owner;
  const token = readAppToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function putPref(key: string, value: string): Promise<void> {
  try {
    await fetch(`/api/user-prefs/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ value }),
    });
  } catch {
    /* best-effort; the mirror already holds the value for this device */
  }
}

async function deletePref(key: string): Promise<void> {
  try {
    await fetch(`/api/user-prefs/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: authHeaders(false),
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Public sync API
// ---------------------------------------------------------------------------

export function getPref(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  return lsGet(key); // first-paint fallback before hydration lands
}

export function setPref(key: string, value: string): void {
  cache.set(key, value);
  lsSet(key, value);
  notify(key, value);
  void putPref(key, value);
}

export function removePref(key: string): void {
  cache.delete(key);
  lsRemove(key);
  notify(key, null);
  void deletePref(key);
}

export function subscribe(key: string, cb: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Hydration + one-time legacy import
// ---------------------------------------------------------------------------

/**
 * Keys that must NEVER be persisted to the server:
 *  - session credentials (circular — they authenticate the prefs request)
 *  - per-tab identity
 */
const NEVER_PERSIST = new Set<string>([
  'gds-cube:app-jwt',
  'gds-cube:token',
  'gds-cube:owner',
  'gds-cube:new-metric-tab-id',
]);

/**
 * True for cross-tab event-bus keys (throwaway signal values, not user data)
 * and other transient local-only scratch keys. These stay in localStorage.
 */
function isLocalOnlyKey(key: string): boolean {
  if (NEVER_PERSIST.has(key)) return true;
  if (/-change$|-changed$/.test(key)) return true; // *-change / *-changed buses
  if (key === 'gds-cube:auth-force-logout') return true;
  if (key.startsWith('gds-cube:pending-deeplink:')) return true;
  return false;
}

let hydrated = false;
export function isHydrated(): boolean {
  return hydrated;
}

/**
 * Test-only: clear the in-memory cache + hydration flag so a test that seeds
 * `localStorage` directly isn't shadowed by a value another test wrote through
 * `setPref` earlier in the same file. Never call in app code.
 */
export function __resetPrefsCacheForTests(): void {
  cache.clear();
  hydrated = false;
}

export async function hydrateServerPrefs(): Promise<void> {
  try {
    const res = await fetch('/api/user-prefs', { headers: authHeaders(false) });
    if (!res.ok) return;
    const all = (await res.json()) as Record<string, string>;

    // Server wins over the local mirror — reconcile cache + mirror, notify on
    // any change so already-mounted consumers repaint with the device-portable
    // value.
    for (const [key, value] of Object.entries(all)) {
      const prev = getPref(key);
      cache.set(key, value);
      lsSet(key, value);
      if (prev !== value) notify(key, value);
    }

    // One-time import: any persistable `gds-cube:*` value that exists locally
    // but not yet on the server gets uploaded, so a user's current settings
    // survive the cutover and become device-portable.
    if (typeof window !== 'undefined') {
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key) continue;
          // Our two pref namespaces — `gds-cube:*` (app prefs/view-state) and
          // `compass:prefs:*` (saved-views, subscriptions).
          if (!key.startsWith('gds-cube:') && !key.startsWith('compass:prefs:')) continue;
          if (key in all) continue;
          if (isLocalOnlyKey(key)) continue;
          const local = window.localStorage.getItem(key);
          if (local == null) continue;
          cache.set(key, local);
          void putPref(key, local);
        }
      } catch {
        /* enumeration blocked (privacy mode) — skip import */
      }
    }

    hydrated = true;
  } catch {
    /* offline / endpoint missing — the mirror keeps the app fully working */
  }
}

// Cross-tab sync: another tab's write-through mirror update fires a `storage`
// event here. Mirror the change into our cache + notify subscribers so this
// tab stays consistent without a reload (preserves the legacy useLocalStorage
// cross-tab behavior).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    const key = e.key;
    if (!key) return;
    if (!listeners.has(key) && !cache.has(key)) return;
    if (e.newValue == null) {
      cache.delete(key);
      notify(key, null);
    } else {
      cache.set(key, e.newValue);
      notify(key, e.newValue);
    }
  });
}
