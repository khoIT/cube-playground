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

const BASE_URL = () => process.env.CUBE_API_URL ?? 'http://localhost:4000';
const TOKEN = () => process.env.CUBE_TOKEN ?? '';

function authHeaders(tokenOverride?: string): Record<string, string> {
  const token = tokenOverride ?? TOKEN();
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
  return res.json();
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
