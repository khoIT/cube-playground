/**
 * Shared fetch wrapper for the segments service.
 * Attaches the X-Owner header from localStorage (v1 pretend-auth) and parses
 * { error: { code, message } } envelopes into typed ApiError throws.
 */

import type { ApiError } from '../types/segment-api';
import { getActiveWorkspaceId, WORKSPACE_HEADER } from '../components/workspace-context';
import { getActiveGameId, GAME_HEADER } from '../components/Header/active-game-storage';
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

export function getOwner(): string {
  if (typeof window === 'undefined') return 'anonymous';
  try {
    return window.localStorage.getItem(OWNER_STORAGE_KEY) ?? 'anonymous';
  } catch {
    return 'anonymous';
  }
}

export function setOwner(owner: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OWNER_STORAGE_KEY, owner);
  } catch {
    // ignore quota / privacy-mode errors
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

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, query, headers, ...rest } = init;
  const url = buildUrl(path, query);

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    'X-Owner': getOwner(),
    ...((headers as Record<string, string>) ?? {}),
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

  // Bearer auth: forward the app JWT when present. Server still accepts
  // X-Owner in AUTH_DISABLED dev mode, so this layer is additive — no
  // breakage when the token is absent (e.g. AUTH_DISABLED=true).
  const appToken = readAppToken();
  if (appToken && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${appToken}`;
  }

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
