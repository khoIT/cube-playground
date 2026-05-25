/**
 * Encode / decode the `compare=` URL parameter alongside the existing `query=` param.
 *
 * Valid values:
 *   - 'prev'       → compare with prior time period
 *   - 'game:<id>'  → compare against a specific game's data
 *   - 'off' / null → no comparison (param absent)
 *
 * Uses hash-based routing: params live in the fragment after `?`.
 * e.g. `#/build?query=...&compare=game:cfm`
 *
 * Pure module — no React, no DOM writes (reads window.location.hash only).
 */

import type { CompareMode } from './derive-compare-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded compare state from the URL. null = absent/off. */
export type CompareSetting = CompareMode | null;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidCompareSetting(value: string): value is CompareMode {
  if (value === 'prev') return true;
  if (value.startsWith('game:') && value.length > 5) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read the current `compare=` value from the hash-based URL.
 * Returns null when the param is absent or its value is 'off'.
 */
export function readCompareFromUrl(): CompareSetting {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx < 0) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const raw = params.get('compare');
  if (!raw || raw === 'off') return null;
  return isValidCompareSetting(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Update the `compare=` param in the current URL without triggering a full
 * navigation — uses `history.replaceState` so the browser back-button is not
 * polluted, and dispatches `hashchange` so React Router stays in sync.
 *
 * Passing null or 'off' removes the param entirely.
 */
export function writeCompareToUrl(value: CompareSetting): void {
  if (typeof window === 'undefined') return;

  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  const path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
  const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');

  if (!value || !isValidCompareSetting(value)) {
    params.delete('compare');
  } else {
    params.set('compare', value);
  }

  const qs = params.toString();
  const nextHash = qs ? `${path}?${qs}` : path || '#/';

  window.history.replaceState(null, '', nextHash);
  // Notify React Router's hash-based listener.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---------------------------------------------------------------------------
// Encode helpers (for constructing deeplinks)
// ---------------------------------------------------------------------------

/**
 * Append or replace a `compare=` param in an existing hash URL string
 * (e.g. the output of `buildPlaygroundDeeplink`).
 *
 * @param hashUrl  A string like `#/build?query=...`
 * @param compare  The compare setting to embed, or null to strip it.
 */
export function injectCompareIntoHashUrl(hashUrl: string, compare: CompareSetting): string {
  const qIdx = hashUrl.indexOf('?');
  const path = qIdx >= 0 ? hashUrl.slice(0, qIdx) : hashUrl;
  const params = new URLSearchParams(qIdx >= 0 ? hashUrl.slice(qIdx + 1) : '');

  if (!compare || !isValidCompareSetting(compare)) {
    params.delete('compare');
  } else {
    params.set('compare', compare);
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
