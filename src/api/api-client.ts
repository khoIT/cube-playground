/**
 * Shared fetch wrapper for the segments service.
 * Attaches the X-Owner header from localStorage (v1 pretend-auth) and parses
 * { error: { code, message } } envelopes into typed ApiError throws.
 */

import type { ApiError } from '../types/segment-api';
import { getActiveWorkspaceId, WORKSPACE_HEADER } from '../components/workspace-context';
import { getActiveGameId, GAME_HEADER } from '../components/Header/active-game-storage';
import { deriveCubeSource, CUBE_SOURCE_HEADER } from './cube-query-source';
import { readAppToken, clearAppToken } from '../auth/auth-storage';

const AUTH_FORCE_LOGOUT_EVENT = 'gds-cube:auth-force-logout';

export class SegmentApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'SegmentApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const OWNER_STORAGE_KEY = 'gds-cube:owner';

// Default identity when no owner is stored. Must match getOwnerId() in
// chat-owner-id.ts — both read OWNER_STORAGE_KEY, so a divergent default makes
// the two halves of the app disagree about who the caller is (segments would
// act as one identity while chat acts as another, e.g. 403 on dev-owned
// sessions). `|| ` (not `??`) so a stray empty string also falls back.
// The default is the org's first bootstrap admin — the AUTH_DISABLED server
// synthesizes the same identity (server/src/auth/dev-identity.ts), so local
// dev runs as the real person, not a 'dev' placeholder. Only meaningful when
// no JWT is attached; real-auth mode derives the owner from the verified token.
const DEFAULT_OWNER = 'khoitn@vng.com.vn';

export function getOwner(): string {
  if (typeof window === 'undefined') return DEFAULT_OWNER;
  try {
    const stored = window.localStorage.getItem(OWNER_STORAGE_KEY);
    // Migrate the retired 'dev' placeholder: a browser that stored it before
    // the bootstrap-admin rename would keep sending X-Owner: dev, which
    // overrides the synth identity server-side and locks the user out of
    // their own (backfilled) artifacts.
    if (stored === 'dev') {
      window.localStorage.removeItem(OWNER_STORAGE_KEY);
      return DEFAULT_OWNER;
    }
    return stored || DEFAULT_OWNER;
  } catch {
    return DEFAULT_OWNER;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body' | 'signal'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: ApiRequestInit['query']): string {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Build the standard request headers (owner + workspace + game + bearer) shared
 * by apiFetch and the streaming clients. Extracted so SSE/EventSource-style
 * fetches carry identical auth/tenant context. Does NOT set Content-Type — the
 * caller adds it based on the body.
 */
export function buildRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    'X-Owner': getOwner(),
    ...(extra ?? {}),
  };

  // Attach the active workspace id so the server resolves Cube ctx per-request.
  // Read from localStorage rather than threading context through every call site.
  const wsId = getActiveWorkspaceId();
  if (wsId && !finalHeaders[WORKSPACE_HEADER]) {
    finalHeaders[WORKSPACE_HEADER] = wsId;
  }

  // Attach the active game so the gateway scopes the minted Cube token to the
  // right tenant on game_id (multi-tenant) workspaces. Centralized here — like
  // the workspace header above — so endpoints that need tenant scope (e.g.
  // /api/identity-map, which drives the segment row-picker) can't silently
  // fall back to a game-less token and an empty /meta. Harmless on prefix
  // workspaces, where the shared schema ignores the claim.
  const gameId = getActiveGameId();
  if (gameId && !finalHeaders[GAME_HEADER]) {
    finalHeaders[GAME_HEADER] = gameId;
  }

  // Tag which app surface issued this request (for /cube-api query telemetry).
  // Derived from the live route; the server only reads it on the proxy path.
  const source = deriveCubeSource();
  if (source && !finalHeaders[CUBE_SOURCE_HEADER]) {
    finalHeaders[CUBE_SOURCE_HEADER] = source;
  }

  // Bearer auth: forward the app JWT when present. Server still accepts
  // X-Owner in AUTH_DISABLED dev mode, so this layer is additive — no
  // breakage when the token is absent (e.g. AUTH_DISABLED=true).
  const appToken = readAppToken();
  if (appToken && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${appToken}`;
  }

  return finalHeaders;
}

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, query, headers, ...rest } = init;
  const url = buildUrl(path, query);

  const finalHeaders = buildRequestHeaders(headers as Record<string, string>);

  const hasBody = body !== undefined && body !== null;
  if (hasBody && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: hasBody
      ? (body instanceof FormData ? (body as FormData) : JSON.stringify(body))
      : undefined,
  });

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    // 401 in SSO mode means the app JWT expired (or was revoked). Drop it
    // and broadcast — AuthContext picks the event up and re-bootstraps,
    // surfacing a fresh KC login. AUTH_DISABLED requests never carry a
    // token so this can't fire spuriously there.
    if (response.status === 401 && typeof window !== 'undefined') {
      if (readAppToken()) {
        clearAppToken();
        window.dispatchEvent(new CustomEvent(AUTH_FORCE_LOGOUT_EVENT));
      }
    }
    let code = 'HTTP_ERROR';
    let message = `Request failed with status ${response.status}`;
    let details: unknown;
    if (isJson) {
      try {
        const parsed = (await response.json()) as ApiError;
        if (parsed?.error) {
          code = parsed.error.code ?? code;
          message = parsed.error.message ?? message;
          details = parsed.error.details;
        }
      } catch {
        // fall through with default code/message
      }
    }
    throw new SegmentApiError(code, message, response.status, details);
  }

  if (!isJson) {
    return undefined as unknown as T;
  }
  return (await response.json()) as T;
}
