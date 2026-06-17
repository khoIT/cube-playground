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

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { gamePrefixFor, filterMetaToGamePrefix } from '../services/prefix-meta-filter.js';
import { recordActivity, projectQueryShape } from '../services/activity-store.js';
import { recordQueryPerf, shouldCapture } from '../services/query-perf-store.js';

// Per-upstream-fetch ceiling. Cube emits `{error:"Continue wait"}` (HTTP 200)
// once it has held a query for its continue-wait window (25s), so a single
// fetch must outlast that window to receive either the data or the warming
// signal — 30s gives it ~5s of slack.
const CUBE_FETCH_TIMEOUT_MS = 30_000;

// Total budget for a /load that keeps warming. A cold pre-agg / raw per-user
// read returns `Continue wait` each 25s window and needs several to materialise;
// the proxy polls across windows up to this ceiling instead of handing back a
// 30s single-shot 504. Kept just under nginx's `proxy_read_timeout 120s` so the
// warm completes here rather than tripping the upstream timeout. Only cold
// queries poll — a fast query returns on the first fetch and is unaffected.
const CUBE_LOAD_MAX_WAIT_MS = Number(process.env.CUBE_LOAD_MAX_WAIT_MS) || 110_000;

// Cube's warming signal: a 200 body of `{error:"Continue wait"}`.
const CONTINUE_WAIT_RE = /Continue wait/i;
export function isContinueWait(status: number, body: unknown): boolean {
  if (status !== 200) return false;
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' && CONTINUE_WAIT_RE.test(e);
}

// Header carrying the active game (mirrors workspace-header.ts GAME_HEADER).
const GAME_HEADER = 'x-cube-game';
// Header carrying the originating app surface (set by the client).
const SOURCE_HEADER = 'x-cube-source';

function gameIdOf(req: FastifyRequest): string | null {
  const raw = req.headers[GAME_HEADER];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Which app surface issued the query. Prefers the explicit `x-cube-source`
 * header the client sets (e.g. `query-builder`, `dashboard:123`,
 * `segment:45:care`, `chat:<sessionId>`) — a stable machine string, not PII.
 * Falls back to the browser Referer path for any caller that didn't tag itself,
 * and null when neither is present (shown as "API / server" in the admin UI).
 * Bounded length so a hostile header can't bloat a row.
 */
function sourceOf(req: FastifyRequest): string | null {
  const explicit = req.headers[SOURCE_HEADER];
  const tag = Array.isArray(explicit) ? explicit[0] : explicit;
  if (typeof tag === 'string' && tag.trim()) return tag.trim().slice(0, 200);

  const raw = req.headers.referer ?? req.headers.referrer;
  const ref = Array.isArray(raw) ? raw[0] : raw;
  if (typeof ref !== 'string' || !ref) return null;
  try {
    return new URL(ref).pathname.slice(0, 200);
  } catch {
    return ref.split('?')[0].slice(0, 200) || null;
  }
}

/**
 * Fire-and-forget telemetry for a successful Cube query. `query` is the raw
 * Cube payload — `projectQueryShape` strips it to member names before it is
 * ever persisted (no filter values, no UIDs). Only emitted on a 200 so failed
 * / malformed queries don't pollute the activity spine.
 */
function emitQueryRun(req: FastifyRequest, status: number, query: unknown): void {
  if (status !== 200 || query == null) return;
  recordActivity(req.principal, {
    eventType: 'query_run',
    workspace: req.workspace.id,
    game: gameIdOf(req),
    detail: projectQueryShape(query),
  });
}

// Monotonic per-process counter for the fast-200 sampling decision. Kept here
// (not on the request) so a single fast-query storm samples deterministically.
let perfSeq = 0;

/**
 * Fire-and-forget performance telemetry for a `/load` query — captured for ALL
 * statuses (failures are never sampled; fast 200s are sampled — see
 * `shouldCapture`). Records latency, status, used pre-aggregations, and the
 * NAMES-only query shape. Never awaited; called after the reply is queued so it
 * stays off the hot path. A 200 body carries `usedPreAggregations` (raw, may be
 * '[]' for lambda rollups); non-200 bodies carry an error message excerpt only.
 */
function emitQueryPerf(
  req: FastifyRequest,
  method: 'GET' | 'POST',
  status: number,
  latencyMs: number,
  query: unknown,
  body: unknown,
): void {
  if (!shouldCapture(status, latencyMs, perfSeq++)) return;
  const ok = status === 200;
  const usedPreaggs = ok
    ? (body as { usedPreAggregations?: unknown } | null)?.usedPreAggregations ?? []
    : undefined;
  recordQueryPerf({
    actorSub: req.principal.sub,
    actorEmail: req.principal.email,
    workspace: req.workspace.id,
    game: gameIdOf(req),
    method,
    status,
    latencyMs,
    query,
    usedPreaggs,
    errorBody: ok ? undefined : body,
    source: sourceOf(req),
  });
}

/** Best-effort parse of the GET `/load?query=<json>` querystring param. */
function parseGetQuery(req: FastifyRequest): unknown {
  const raw = (req.query as { query?: unknown } | undefined)?.query;
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

/**
 * Forward a /load and transparently poll Cube's continue-wait protocol. Each
 * inner `forward()` outlasts one 25s window; while Cube keeps returning
 * `Continue wait` we re-issue the same query until it resolves or the total
 * budget elapses, then hand back the last response (data on success, or the
 * final `Continue wait` so an SDK client can keep polling on its own). Mirrors
 * the server-side `loadWithContinueWait` used by batch jobs, but over the
 * workspace-resolved proxy target. Replaces the old 30s single-shot that 504'd
 * cold reads well below the 120s the infra already allows.
 */
export async function forwardLoadWithContinueWait(
  target: ProxyTarget,
  method: 'GET' | 'POST',
  search: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const deadline = Date.now() + CUBE_LOAD_MAX_WAIT_MS;
  for (;;) {
    const res = await forward(target, method, '/load', search, body);
    if (!isContinueWait(res.status, res.body) || Date.now() >= deadline) return res;
    await new Promise((r) => setTimeout(r, Math.min(700, deadline - Date.now())));
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
    const started = performance.now();
    const { status, body } = await forwardLoadWithContinueWait(req.cubeCtx, 'GET', search, undefined);
    const latencyMs = performance.now() - started;
    const query = parseGetQuery(req);
    emitQueryRun(req, status, query);
    emitQueryPerf(req, 'GET', status, latencyMs, query, body);
    return reply.status(status).send(body);
  });

  app.post('/cube-api/v1/load', async (req, reply) => {
    const started = performance.now();
    const { status, body } = await forwardLoadWithContinueWait(req.cubeCtx, 'POST', '', req.body);
    const latencyMs = performance.now() - started;
    const query = (req.body as { query?: unknown } | undefined)?.query;
    emitQueryRun(req, status, query);
    emitQueryPerf(req, 'POST', status, latencyMs, query, body);
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
