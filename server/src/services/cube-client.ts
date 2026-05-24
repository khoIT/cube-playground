/**
 * Thin fetch wrapper around the Cube REST API.
 * Reads connection details from environment variables at call time
 * so the module can be imported before env is populated in tests.
 *
 * Per-game scoping: server-side jobs (e.g. anomaly detector) need to talk to
 * Cube with a token whose `securityContext.game` claim selects the right
 * `repositoryFactory` schema. Each helper therefore accepts an optional
 * `tokenOverride` so callers can pass a game-specific JWT minted by
 * `resolve-cube-token`.
 */

import { loadGamesConfig } from './games-config-loader.js';
import { resolveCubeTokenForGameDetailed } from './resolve-cube-token.js';

const BASE_URL = () => process.env.CUBE_API_URL ?? 'http://localhost:4000';

// Cube can hang in a TCP-up / HTTP-stuck mode (container alive, queries
// frozen). Without an AbortController, `fetch` sits forever and propagates
// the hang into every route that calls into Cube — most visibly the metric
// detail page, which 'Loading…'s indefinitely. 15s is enough for legit
// /meta + /sql calls (well under Cube's own slow-query window) but bounds
// the worst case.
const CUBE_FETCH_TIMEOUT_MS = 15_000;

async function cubeFetch(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CUBE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Cube request timed out after ${CUBE_FETCH_TIMEOUT_MS / 1000}s: ${url}`);
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

function authHeaders(tokenOverride?: string): Record<string, string> {
  const token = tokenOverride ?? defaultToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function cubePost(
  path: string,
  body: unknown,
  tokenOverride?: string,
): Promise<unknown> {
  const url = `${BASE_URL()}/cubejs-api/v1${path}`;
  const res = await cubeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(tokenOverride) },
    body: JSON.stringify(body),
  });
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

async function cubeGet(path: string, tokenOverride?: string): Promise<unknown> {
  const url = `${BASE_URL()}/cubejs-api/v1${path}`;
  const res = await cubeFetch(url, {
    headers: { ...authHeaders(tokenOverride) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cube ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Fetch Cube schema metadata (/meta). */
export async function getMeta(tokenOverride?: string): Promise<unknown> {
  return cubeGet('/meta', tokenOverride);
}

/** Execute a Cube query (/load). */
export async function load(
  query: unknown,
  tokenOverride?: string,
): Promise<unknown> {
  return cubePost('/load', { query }, tokenOverride);
}

/** Get the SQL for a Cube query (/sql). */
export async function sql(
  query: unknown,
  tokenOverride?: string,
): Promise<unknown> {
  return cubePost('/sql', { query }, tokenOverride);
}
