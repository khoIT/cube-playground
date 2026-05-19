/**
 * Build a /build deeplink URL that pre-applies a uid IN-filter from a segment.
 *
 * The Cube playground reads the `?query=<encoded JSON>` URL param at boot.
 * If the encoded URL would exceed 8000 chars (typical browser limit) we stash
 * the query in sessionStorage and return a shorter `?from-segment=<id>` URL.
 *
 * Pure module — no React, no DOM globals besides sessionStorage / location.
 */

export interface DeeplinkInput {
  /** Optional starting Cube query (filters, measures, etc.). */
  baseQuery?: Record<string, unknown>;
  segmentId: string;
  segmentName: string;
  identityDim: string;
  primaryCube: string | null;
  uids: string[];
}

export interface DeeplinkResult {
  url: string;
  via: 'inline' | 'session-storage';
}

const URL_LIMIT = 8000;
const STORAGE_KEY_PREFIX = 'gds-cube:pending-deeplink:';

export function mergeUidFilter(
  baseQuery: Record<string, unknown> | undefined,
  identityDim: string,
  uids: string[],
): Record<string, unknown> {
  const filters = Array.isArray(baseQuery?.filters) ? [...(baseQuery!.filters as unknown[])] : [];
  filters.push({ member: identityDim, operator: 'in', values: uids });
  return { ...baseQuery, filters };
}

export function defaultBaseQuery(primaryCube: string | null): Record<string, unknown> {
  if (!primaryCube) return {};
  return { measures: [`${primaryCube}.count`] };
}

export function buildPlaygroundDeeplink(input: DeeplinkInput): DeeplinkResult {
  const base = input.baseQuery ?? defaultBaseQuery(input.primaryCube);
  const merged = mergeUidFilter(base, input.identityDim, input.uids);
  const encoded = encodeURIComponent(JSON.stringify(merged));

  const inlineUrl = `#/build?query=${encoded}`;

  if (inlineUrl.length <= URL_LIMIT) {
    return { url: inlineUrl, via: 'inline' };
  }

  // Fall back to sessionStorage handoff for very large uid lists.
  const key = `${STORAGE_KEY_PREFIX}${input.segmentId}`;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(key, JSON.stringify(merged));
    } catch {
      // sessionStorage full / unavailable — caller's UI surfaces failure.
    }
  }
  return { url: `#/build?from-segment=${encodeURIComponent(input.segmentId)}`, via: 'session-storage' };
}

export function readDeeplinkFromStorage(segmentId: string): Record<string, unknown> | null {
  if (typeof sessionStorage === 'undefined') return null;
  const key = `${STORAGE_KEY_PREFIX}${segmentId}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clearDeeplinkStorage(segmentId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${segmentId}`);
}
