/**
 * Thin fetch wrapper around the Cube REST API.
 * Reads connection details from environment variables at call time
 * so the module can be imported before env is populated in tests.
 */

const BASE_URL = () => process.env.CUBE_API_URL ?? 'http://localhost:4000';
const TOKEN = () => process.env.CUBE_TOKEN ?? '';

function authHeaders(): Record<string, string> {
  const token = TOKEN();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function cubePost(path: string, body: unknown): Promise<unknown> {
  const url = `${BASE_URL()}/cubejs-api/v1${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cube ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function cubeGet(path: string): Promise<unknown> {
  const url = `${BASE_URL()}/cubejs-api/v1${path}`;
  const res = await fetch(url, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Cube ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

/** Fetch Cube schema metadata (/meta). */
export async function getMeta(): Promise<unknown> {
  return cubeGet('/meta');
}

/** Execute a Cube query (/load). */
export async function load(query: unknown): Promise<unknown> {
  return cubePost('/load', { query });
}

/** Get the SQL for a Cube query (/sql). */
export async function sql(query: unknown): Promise<unknown> {
  return cubePost('/sql', { query });
}
