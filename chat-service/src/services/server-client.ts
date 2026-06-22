/**
 * Thin HTTP client for reaching the existing server/ service.
 * Forwards authentication headers so the server can enforce owner scoping.
 * Throws ServerClientError on non-2xx so callers can branch on status codes.
 */

import { config } from '../config.js';
import type { ToolContext } from '../types.js';

// ---------------------------------------------------------------------------
// Typed error — callers catch this to distinguish 404 / 5xx / network failure
// ---------------------------------------------------------------------------

export class ServerClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`server-client: HTTP ${status}`);
    this.name = 'ServerClientError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Shared header builder
// ---------------------------------------------------------------------------

function buildHeaders(ctx: ToolContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Owner-Id': ctx.ownerId,
    // cubeToken is used by the server proxy for game-scoped queries
    'X-Cube-Token': ctx.cubeToken,
    // Game + workspace must travel with every server call: the server resolves
    // the active Cube model from these headers. Without X-Cube-Game it falls
    // back to the default game (wrong population, and per-game cubes like
    // billing_detail resolve to "not found"); without X-Cube-Workspace it
    // can't pick the right model on prod.
    'X-Cube-Game': ctx.gameId,
    'X-Cube-Workspace': ctx.workspace,
  };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export async function getJson<T>(path: string, ctx: ToolContext): Promise<T> {
  const url = `${config.serverBaseUrl}${path}`;
  const res = await fetch(url, { headers: buildHeaders(ctx) });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => '');
    }
    throw new ServerClientError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export interface BodyRequestOpts {
  /** Abort signal so latency-sensitive callers (propose-time preview) can bound the wait. */
  signal?: AbortSignal;
}

export async function postJson<T>(path: string, body: unknown, ctx: ToolContext, opts?: BodyRequestOpts): Promise<T> {
  return bodyRequest<T>('POST', path, body, ctx, opts);
}

export async function patchJson<T>(path: string, body: unknown, ctx: ToolContext, opts?: BodyRequestOpts): Promise<T> {
  return bodyRequest<T>('PATCH', path, body, ctx, opts);
}

async function bodyRequest<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  ctx: ToolContext,
  opts?: BodyRequestOpts,
): Promise<T> {
  const url = `${config.serverBaseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: buildHeaders(ctx),
    body: JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text().catch(() => '');
    }
    throw new ServerClientError(res.status, errBody);
  }

  return res.json() as Promise<T>;
}
