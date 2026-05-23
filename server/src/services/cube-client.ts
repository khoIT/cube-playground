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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
