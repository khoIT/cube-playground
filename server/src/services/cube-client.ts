/**
 * Thin fetch wrapper around the Cube REST API.
 *
 * Per-request workspace ctx: each helper accepts an optional `WorkspaceCtx`
 * (base URL + token), so the same client can talk to local minted-JWT Cube
 * or an open prod cube-dev. Callers that don't pass a ctx fall back to the
 * legacy global env (`CUBE_API_URL`) for backwards compatibility.
 *
 * Per-game scoping (legacy): server-side jobs (e.g. anomaly detector) still
 * pass `tokenOverride` so Cube's `repositoryFactory` picks the right schema.
 * In workspace mode, that override is folded into the ctx.
 */

import { loadGamesConfig } from './games-config-loader.js';
import { resolveCubeTokenForGameDetailed } from './resolve-cube-token.js';

const BASE_URL = () => process.env.CUBE_API_URL ?? 'http://localhost:4000';

export interface WorkspaceCtx {
  cubeApiUrl: string;
  token: string | null;
}

// Cube can hang in a TCP-up / HTTP-stuck mode (container alive, queries
// frozen). Without an AbortController, `fetch` sits forever and propagates
// the hang into every route that calls into Cube — most visibly the metric
// detail page, which 'Loading…'s indefinitely. This DEFAULT bounds the worst
// case while still sitting ABOVE Cube's continue-wait window (25s): a shorter
// default (the old 15s) aborts before Cube emits its first `Continue wait`
// signal, so any default-timeout caller is GUARANTEED to fail a cold read.
// 30s lets a default caller receive at least one warming signal; batch callers
// that need to poll several windows pass an explicit larger timeout.
const CUBE_FETCH_TIMEOUT_MS = 30_000;

async function cubeFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = CUBE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Cube request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// Without this fallback, scope-less callers (identity-suggester, meta-cache)
// drop the Authorization header on deployments that only set
// CUBEJS_API_SECRET, and Cube /meta replies "Authorization header missing".
function defaultToken(): string {
  const direct = process.env.CUBE_TOKEN;
  if (direct && direct.length > 0) return direct;
  try {
    const { defaultGameId } = loadGamesConfig();
    return resolveCubeTokenForGameDetailed(defaultGameId).token ?? '';
  } catch {
    return '';
  }
}

function resolveTokenForCall(
  tokenOverride: string | null | undefined,
  ctx?: WorkspaceCtx,
): string {
  if (ctx) return ctx.token ?? '';
  return tokenOverride ?? defaultToken();
}

function resolveBaseForCall(ctx?: WorkspaceCtx): string {
  return ctx?.cubeApiUrl ?? BASE_URL();
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function cubePost(
  path: string,
  body: unknown,
  tokenOverride?: string | null,
  ctx?: WorkspaceCtx,
  timeoutMs?: number,
): Promise<unknown> {
  const token = resolveTokenForCall(tokenOverride, ctx);
  const url = `${resolveBaseForCall(ctx)}/cubejs-api/v1${path}`;
  const res = await cubeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cube ${path} → ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { error?: string };
  // Cube returns HTTP 200 with `{error: "Continue wait"}` while a query is
  // being pre-aggregated asynchronously. Without this guard, callers that
  // read `data ?? []` silently capture an empty result set — masking cold
  // caches as "0 matches" and writing back false-positive `uid_count=0`.
  if (json && typeof json === 'object' && typeof json.error === 'string') {
    throw new Error(`Cube ${path}: ${json.error}`);
  }
  return json;
}

async function cubeGet(
  path: string,
  tokenOverride?: string | null,
  ctx?: WorkspaceCtx,
): Promise<unknown> {
  const token = resolveTokenForCall(tokenOverride, ctx);
  const url = `${resolveBaseForCall(ctx)}/cubejs-api/v1${path}`;
  const res = await cubeFetch(url, {
    headers: { ...authHeaders(token) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cube ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Fetch Cube schema metadata (/meta). */
export async function getMeta(tokenOverride?: string | null): Promise<unknown> {
  return cubeGet('/meta', tokenOverride);
}

/** Workspace-aware /meta — preferred for new route code. */
export async function getMetaWithCtx(ctx: WorkspaceCtx): Promise<unknown> {
  return cubeGet('/meta', undefined, ctx);
}

/** Execute a Cube query (/load). `timeoutMs` overrides the default 15s fetch
 *  abort for batch callers that poll Cube's continue-wait window (see
 *  loadWithContinueWait); omit it for interactive callers. */
export async function load(
  query: unknown,
  tokenOverride?: string | null,
  timeoutMs?: number,
): Promise<unknown> {
  return cubePost('/load', { query }, tokenOverride, undefined, timeoutMs);
}

/** Workspace-aware /load. `timeoutMs` overrides the default 15s fetch abort for
 *  callers that poll Cube's continue-wait window against a cold warehouse (see
 *  loadWithContinueWait); omit it for interactive callers. */
export async function loadWithCtx(
  query: unknown,
  ctx: WorkspaceCtx,
  timeoutMs?: number,
): Promise<unknown> {
  return cubePost('/load', { query }, undefined, ctx, timeoutMs);
}

/** Get the SQL for a Cube query (/sql). */
export async function sql(
  query: unknown,
  tokenOverride?: string | null,
): Promise<unknown> {
  return cubePost('/sql', { query }, tokenOverride);
}

/** Workspace-aware /sql. */
export async function sqlWithCtx(query: unknown, ctx: WorkspaceCtx): Promise<unknown> {
  return cubePost('/sql', { query }, undefined, ctx);
}
