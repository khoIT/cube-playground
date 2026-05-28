/**
 * Workspace-aware Cube API proxy.
 *
 * The frontend used to talk to Cube directly via the Vite proxy
 * (`/cubejs-api/*` → :4000). That short-circuited workspace switching: the
 * server-side `x-cube-workspace` header was never inspected, every request
 * went to local Cube, and prod cube-dev was unreachable for the catalog /
 * data-model / playground surfaces.
 *
 * These routes forward `/meta`, `/load`, `/sql` to the workspace-resolved
 * Cube backend. Auth is server-authoritative — any Authorization header from
 * the client is dropped; `req.cubeCtx` decides what (if anything) to send.
 *
 * URL: `/cube-api/v1/<path>` (deliberately *not* `/cubejs-api` so the Vite
 * proxy can route them to Fastify instead of bypassing it).
 */

import type { FastifyInstance } from 'fastify';

const CUBE_FETCH_TIMEOUT_MS = 15_000;

interface ProxyTarget {
  cubeApiUrl: string;
  token: string | null;
}

async function forward(
  target: ProxyTarget,
  method: 'GET' | 'POST',
  upstreamPath: string,
  search: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CUBE_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (target.token) headers.Authorization = `Bearer ${target.token}`;
    let requestBody: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body ?? {});
    }
    const qs = search && search !== '' ? `?${search.replace(/^\?/, '')}` : '';
    const url = `${target.cubeApiUrl}/cubejs-api/v1${upstreamPath}${qs}`;
    const res = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: ctl.signal,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: text };
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 504,
        body: { error: `Cube request timed out after ${CUBE_FETCH_TIMEOUT_MS / 1000}s` },
      };
    }
    return {
      status: 502,
      body: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function cubeProxyRoutes(app: FastifyInstance): Promise<void> {
  // GET /cube-api/v1/meta(?extended=true&...)
  app.get('/cube-api/v1/meta', async (req, reply) => {
    const search = (req.raw.url ?? '').split('?')[1] ?? '';
    const { status, body } = await forward(req.cubeCtx, 'GET', '/meta', search, undefined);
    return reply.status(status).send(body);
  });

  app.post('/cube-api/v1/load', async (req, reply) => {
    const { status, body } = await forward(req.cubeCtx, 'POST', '/load', '', req.body);
    return reply.status(status).send(body);
  });

  app.post('/cube-api/v1/sql', async (req, reply) => {
    const { status, body } = await forward(req.cubeCtx, 'POST', '/sql', '', req.body);
    return reply.status(status).send(body);
  });

  // Cube SDK uses `/cubejs-api/v1/load` via long-poll for "Continue wait" — proxy
  // those too so we don't have to discriminate on the client side.
  app.post('/cube-api/v1/load/:queryHash', async (req, reply) => {
    const { queryHash } = req.params as { queryHash: string };
    const { status, body } = await forward(
      req.cubeCtx,
      'POST',
      `/load/${queryHash}`,
      '',
      req.body,
    );
    return reply.status(status).send(body);
  });
}
