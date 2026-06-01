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
import { gamePrefixFor, filterMetaToGamePrefix } from '../services/prefix-meta-filter.js';

const CUBE_FETCH_TIMEOUT_MS = 15_000;

// Header carrying the active game (mirrors workspace-header.ts GAME_HEADER).
const GAME_HEADER = 'x-cube-game';

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
    // On prefix workspaces, Cube returns every game's cubes. Scope the response
    // to the active game's prefix so consumers (chat agent, Playground) don't
    // see the same measure name across games. No-op on game_id workspaces or
    // when no game header is present.
    if (status === 200) {
      const rawGame = req.headers[GAME_HEADER];
      const gameId = typeof rawGame === 'string' && rawGame.trim() ? rawGame.trim() : null;
      const prefix = gamePrefixFor(req.workspace, gameId);
      if (prefix) return reply.status(status).send(filterMetaToGamePrefix(body, prefix));
    }
    return reply.status(status).send(body);
  });

  // /load and /sql have BOTH GET (with ?query=…&queryType=multi) and POST
  // (with the query in the body) flavors. The Cube SDK in the playground uses
  // GET; the chat-service tools use POST. Both go through the same workspace-
  // resolved upstream.
  app.get('/cube-api/v1/load', async (req, reply) => {
    const search = (req.raw.url ?? '').split('?')[1] ?? '';
    const { status, body } = await forward(req.cubeCtx, 'GET', '/load', search, undefined);
    return reply.status(status).send(body);
  });

  app.post('/cube-api/v1/load', async (req, reply) => {
    const { status, body } = await forward(req.cubeCtx, 'POST', '/load', '', req.body);
    return reply.status(status).send(body);
  });

  // /dry-run validates a query without executing it — the Cube SDK in the
  // playground hits this on every query change. Returning 404 here breaks
  // the QueryBuilder's pre-flight check and surfaces as a render error even
  // when /load itself would have succeeded.
  app.get('/cube-api/v1/dry-run', async (req, reply) => {
    const search = (req.raw.url ?? '').split('?')[1] ?? '';
    const { status, body } = await forward(req.cubeCtx, 'GET', '/dry-run', search, undefined);
    return reply.status(status).send(body);
  });

  app.post('/cube-api/v1/dry-run', async (req, reply) => {
    const { status, body } = await forward(req.cubeCtx, 'POST', '/dry-run', '', req.body);
    return reply.status(status).send(body);
  });

  app.get('/cube-api/v1/sql', async (req, reply) => {
    const search = (req.raw.url ?? '').split('?')[1] ?? '';
    const { status, body } = await forward(req.cubeCtx, 'GET', '/sql', search, undefined);
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
