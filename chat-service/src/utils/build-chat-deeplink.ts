/**
 * Build a /build deeplink URL for a free-form Cube query.
 *
 * Mirrors the shape of src/utils/playground-deeplink.ts in the FE, but
 * accepts any CubeQuery directly (no segment-specific helpers).
 *
 * Inline path: encodes query JSON into `#/build?query=<encoded>`.
 * Session-storage path (URL > 8000 chars): returns `#/build?from-chat-artifact=<artifactId>`
 *   — the caller writes `payload` to sessionStorage before navigation.
 *
 * Pure module — no DOM, no React. Safe to use in Node.js.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CubeQuery } from '../types.js';

const URL_LIMIT = 8000;
export const STORAGE_KEY_PREFIX = 'gds-cube:pending-chat-deeplink:';

export interface ChatDeeplinkResult {
  url: string;
  via: 'inline' | 'session-storage';
  artifactId: string;
  /** Only set when via === 'session-storage'. The FE writes this to sessionStorage. */
  payload?: CubeQuery;
}

/**
 * Build a deeplink for the given Cube query.
 * Always returns a stable artifactId (uuid) for React keying regardless of via.
 */
export function buildChatDeeplink(query: CubeQuery): ChatDeeplinkResult {
  const artifactId = uuidv4();
  const encoded = encodeURIComponent(JSON.stringify(query));
  const inlineUrl = `#/build?query=${encoded}`;

  if (inlineUrl.length <= URL_LIMIT) {
    return { url: inlineUrl, via: 'inline', artifactId };
  }

  // Fallback: session-storage handoff for very large queries.
  const url = `#/build?from-chat-artifact=${encodeURIComponent(artifactId)}`;
  return { url, via: 'session-storage', artifactId, payload: query };
}

/**
 * Build a deeplink for a COMBINED (dual-axis) artifact. Always session-storage,
 * never inline: the URL carries `&combined=1`, `payload` stays the primary
 * CubeQuery (so a pre-combined consumer runs the primary metric and degrades
 * gracefully), and the overlay rides the sibling key the FE writes separately.
 *
 * Two small queries would otherwise pass the inline threshold and lose the
 * `payload` field — forcing session-storage keeps the primary payload present.
 */
export function buildCombinedChatDeeplink(primary: CubeQuery): ChatDeeplinkResult {
  const artifactId = uuidv4();
  const url = `#/build?from-chat-artifact=${encodeURIComponent(artifactId)}&combined=1`;
  return { url, via: 'session-storage', artifactId, payload: primary };
}
