/**
 * Shared fetch wrapper for the segments service.
 * Attaches the X-Owner header from localStorage (v1 pretend-auth) and parses
 * { error: { code, message } } envelopes into typed ApiError throws.
 */

import type { ApiError } from '../types/segment-api';

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
