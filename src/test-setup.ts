/**
 * Global test setup (src/ jsdom tests).
 *
 * Resets the server-pref store's in-memory cache before every test so a test
 * that seeds `localStorage` directly is read through to its value, instead of
 * being shadowed by something a prior test wrote via `setPref`. We deliberately
 * do NOT clear `localStorage` here — some suites rely on cross-test mirror
 * persistence and clear it themselves where needed.
 */
import { beforeEach } from 'vitest';

import { __resetPrefsCacheForTests } from './hooks/server-prefs-store';

beforeEach(() => {
  __resetPrefsCacheForTests();
});
