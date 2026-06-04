/**
 * Chat proxy routes: /api/chat/*
 *
 * Forwards requests to chat-service (CHAT_SERVICE_URL env) while injecting
 * Cube credentials and owner identity.
 *
 * Routes:
 *   POST /api/chat/sessions/:id/turn  — SSE stream pass-through
 *   GET  /api/chat/sessions            — list sessions for game
 *   GET  /api/chat/sessions/:id        — session detail
 *   DELETE /api/chat/sessions/:id      — soft-archive session
 *
 * If CHAT_FEATURE_ENABLED !== 'true', all routes return 404 with { code: 'chat_disabled' }.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';

// Read at request time so tests can override CHAT_SERVICE_URL env var before each request.
// Exported so admin-chat-audit can reuse the same upstream base without duplicating it.
export function chatServiceUrl(): string {
  return process.env.CHAT_SERVICE_URL ?? 'http://localhost:3005';
}

// Body schema for the /turn endpoint (validated at runtime)
interface TurnBody {
  message: string;
  game: string;
  context?: unknown;
}

// Params carrying the session id (may be literal 'new')
interface SessionParams {
  id: string;
}

// Query string for GET /sessions
interface SessionsQuery {
  game?: string;
  q?: string;
}

// Query string for GET /stats
interface StatsQuery {
  owner?: string;
  from?: string;
  to?: string;
}

// Body for PATCH /sessions/:id (rename)
interface PatchSessionBody {
  title?: string;
}

/**
 * Forwards a plain JSON request upstream and pipes the response back.
 * Passes X-Owner-Id header through for ownership checks in chat-service.
 * Exported so admin-chat-audit can reuse the same proxy mechanism without copying it.
 */
export async function proxyJson(
  upstream: string,
  method: string,
  ownerId: string,
  workspace: string,
  body?: unknown,
): Promise<{ status: number; payload: unknown }> {
  // Only advertise a JSON content-type when we actually send a body. A
  // bodyless POST/DELETE (e.g. the turn-cancel route) with
  // Content-Type: application/json trips the upstream's empty-JSON-body guard
  // (FST_ERR_CTP_EMPTY_JSON_BODY → 400).
  const headers: Record<string, string> = {
    'X-Owner-Id': ownerId,
    // Partition chat-service queries by the active Cube workspace. Session
    // list/detail must scope to the workspace so switching local↔prod hides
    // the other side's threads. Default 'local' is applied upstream when the
    // header is absent (legacy clients keep their existing visibility).
    'X-Cube-Workspace': workspace,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(upstream, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await res.json();
    return { status: res.status, payload };
  }
  // Non-JSON response — return raw text wrapped
  const text = await res.text();
  return { status: res.status, payload: { message: text } };
}

/**
 * Resolves the effective owner for a request — SERVER-AUTHORITATIVE.
 *
 * The verified principal wins over any client-supplied header. In real-auth
 * mode the authenticate middleware sets `request.owner = claims.sub`, so we
 * key chat ownership off the JWT, not the spoofable client `X-Owner-Id`.
 * Trusting the client header instead collapsed every user to the `'dev'`
 * default and leaked sessions across users.
 *
 * Only when no verified identity exists (AUTH_DISABLED with no X-Owner, or the
 * standalone owner-header path used by tests → `request.owner === 'anonymous'`)
 * do we fall back to the client `X-Owner-Id`. Returns null when neither yields
 * a usable owner.
 */
function resolveOwner(request: FastifyRequest): string | null {
  if (request.owner && request.owner !== 'anonymous') {
    return request.owner;
  }
  const ownerId = request.headers['x-owner-id'];
  if (typeof ownerId === 'string' && ownerId.trim()) {
    return ownerId.trim();
  }
  return null;
}

/**
 * Human-readable label for the owner, for "shared by …" display on published
 * chats. Prefers the authenticated username/email; falls back to the resolved
 * owner id when no verified user is attached (dev / legacy paths).
 */
function resolveOwnerLabel(request: FastifyRequest, owner: string): string {
  return request.user?.username ?? request.user?.email ?? owner;
}

export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  // --- Feature flag guard ---
  if (process.env.CHAT_FEATURE_ENABLED !== 'true') {
    app.all('/api/chat/*', async (_req, reply) => {
      return reply.status(404).send({ code: 'chat_disabled' });
    });
    return;
  }

  // --- POST /api/chat/sessions/:id/turn ---
  app.post<{ Params: SessionParams; Body: TurnBody }>(
    '/api/chat/sessions/:id/turn',
    async (request: FastifyRequest<{ Params: SessionParams; Body: TurnBody }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }

      const body = request.body as TurnBody;

      // Validate required fields
      if (!body || typeof body.message !== 'string' || typeof body.game !== 'string') {
        return reply.status(400).send({ code: 'invalid_body', message: 'message and game are required' });
      }

      // Resolve cube token for the game
      const token = resolveCubeTokenForGame(body.game);
      if (token === null) {
        return reply.status(503).send({ code: 'no_cube_token', game: body.game });
      }

      // Build upstream body — session_id null signals "create new session"
      const upstreamBody = {
        session_id: request.params.id === 'new' ? null : request.params.id,
        owner_id: owner,
        // Display name stamped on the session at creation so a published chat
        // can show "shared by …" without a cross-service identity lookup.
        owner_label: resolveOwnerLabel(request, owner),
        game: body.game,
        message: body.message,
        context: body.context,
      };

      // AbortController ties upstream lifetime to the client socket.
      // We listen on reply.raw (not request.raw) because request.raw fires
      // its 'close' event the moment Fastify hijacks the response, which
      // would abort the upstream fetch before it even starts.
      const abort = new AbortController();
      reply.raw.on('close', () => {
        abort.abort();
      });

      // Build forwarded headers — always include auth/routing headers, conditionally
      // forward X-Bypass-Cache and X-Model when the client sent them. Without this,
      // the FE bypass-cache toggle and per-message model selector are dead code.
      const forwardedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Cube-Token': token,
        'X-Cube-Game': body.game,
        'X-Owner-Id': owner,
        // Partition chat sessions by Cube data workspace — chat-service uses
        // this to scope sessions to the active backend (local mint vs prod
        // open access). Read off `req.workspace` populated by workspaceHeader.
        'X-Cube-Workspace': request.workspace.id,
      };
      const bypassCache = request.headers['x-bypass-cache'];
      if (typeof bypassCache === 'string') forwardedHeaders['X-Bypass-Cache'] = bypassCache;
      const xModel = request.headers['x-model'];
      if (typeof xModel === 'string') forwardedHeaders['X-Model'] = xModel;
      const xWebSearch = request.headers['x-web-search'];
      if (typeof xWebSearch === 'string') forwardedHeaders['X-Web-Search'] = xWebSearch;
      const xResearchMode = request.headers['x-research-mode'];
      if (typeof xResearchMode === 'string') forwardedHeaders['X-Research-Mode'] = xResearchMode;

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(`${chatServiceUrl()}/agent/turn`, {
          method: 'POST',
          headers: forwardedHeaders,
          body: JSON.stringify(upstreamBody),
          signal: abort.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // Client disconnected before upstream responded — nothing to send
          reply.raw.end();
          return;
        }
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }

      // Non-2xx: forward the error response verbatim (e.g. 409 turn_in_progress)
      if (!upstreamRes.ok) {
        const contentType = upstreamRes.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const errBody = await upstreamRes.json();
          return reply.status(upstreamRes.status).send(errBody);
        }
        const errText = await upstreamRes.text();
        return reply.status(upstreamRes.status).send({ code: 'upstream_error', message: errText });
      }

      // 2xx: set SSE headers and stream through
      void reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      if (!upstreamRes.body) {
        reply.raw.end();
        return;
      }

      // Pipe web ReadableStream → Node Readable → client socket
      const nodeStream = Readable.fromWeb(upstreamRes.body as import('stream/web').ReadableStream<Uint8Array>);

      nodeStream.on('error', () => {
        reply.raw.destroy();
      });

      nodeStream.pipe(reply.raw, { end: true });
    },
  );

  // --- GET /api/chat/sessions/:sessionId/stream-replay?turnId=...&from=... ---
  // SSE replay endpoint. Refreshed clients pull buffered + live tail of an
  // in-flight turn via the chat-service stream-registry.
  app.get<{ Params: { sessionId: string }; Querystring: { turnId?: string; from?: string } }>(
    '/api/chat/sessions/:sessionId/stream-replay',
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Querystring: { turnId?: string; from?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }

      const turnId = request.query.turnId;
      if (!turnId) {
        return reply.status(400).send({ code: 'missing_turn_id' });
      }
      // Shed obviously-malformed turnIds at the edge. The registry generates
      // UUID v4 (36-char hex+dash) — accept a generous superset to allow for
      // future formats, but reject anything that couldn't plausibly be one.
      if (turnId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(turnId)) {
        return reply.status(400).send({ code: 'invalid_turn_id' });
      }

      const params = new URLSearchParams();
      if (request.query.from) params.set('from', request.query.from);
      const upstream = `${chatServiceUrl()}/agent/turn/${encodeURIComponent(turnId)}/stream?${params.toString()}`;

      const abort = new AbortController();
      reply.raw.on('close', () => abort.abort());

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(upstream, {
          method: 'GET',
          headers: { 'X-Owner-Id': owner },
          signal: abort.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          reply.raw.end();
          return;
        }
        return reply.status(502).send({
          code: 'upstream_unreachable',
          message: (err as Error).message,
        });
      }

      // Non-2xx: forward the error body verbatim (e.g. 409 ring_overflow).
      if (!upstreamRes.ok) {
        const ct = upstreamRes.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          const errBody = await upstreamRes.json();
          return reply.status(upstreamRes.status).send(errBody);
        }
        const errText = await upstreamRes.text();
        return reply.status(upstreamRes.status).send({
          code: 'upstream_error',
          message: errText,
        });
      }

      // 2xx: pipe SSE.
      void reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (!upstreamRes.body) {
        reply.raw.end();
        return;
      }
      const nodeStream = Readable.fromWeb(
        upstreamRes.body as import('stream/web').ReadableStream<Uint8Array>,
      );
      nodeStream.on('error', () => reply.raw.destroy());
      nodeStream.pipe(reply.raw, { end: true });
    },
  );

  // --- POST /api/agent/turn/:turnId/cancel — Phase 04 "Stop generating" ---
  // The FE cancel button posts here; chat-service registers the upstream at
  // /agent/turn/:turnId/cancel (no /api prefix). Forward X-Owner-Id so the
  // upstream owner check can reject cross-user cancels. Pass the upstream
  // status through verbatim (202 aborted / 410 not-running / 401 / 403).
  app.post<{ Params: { turnId: string } }>(
    '/api/agent/turn/:turnId/cancel',
    async (request: FastifyRequest<{ Params: { turnId: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const url = `${chatServiceUrl()}/agent/turn/${encodeURIComponent(request.params.turnId)}/cancel`;
      try {
        const { status, payload } = await proxyJson(url, 'POST', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/sessions?game=<id> ---
  app.get<{ Querystring: SessionsQuery }>(
    '/api/chat/sessions',
    async (request: FastifyRequest<{ Querystring: SessionsQuery }>, reply: FastifyReply) => {
      const owner = resolveOwner(request) ?? request.owner;
      const params = new URLSearchParams();
      params.set('game', request.query.game ?? '');
      if (request.query.q) params.set('q', request.query.q);
      const url = `${chatServiceUrl()}/sessions?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/sessions/shared?game=<id>&q=<str> ---
  // Cross-owner "shared with team" listing. Registered before '/sessions/:id'
  // so the static path is never captured by the parametric route.
  app.get<{ Querystring: SessionsQuery }>(
    '/api/chat/sessions/shared',
    async (request: FastifyRequest<{ Querystring: SessionsQuery }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      params.set('game', request.query.game ?? '');
      if (request.query.q) params.set('q', request.query.q);
      const url = `${chatServiceUrl()}/sessions/shared?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/sessions/:id ---
  app.get<{ Params: SessionParams }>(
    '/api/chat/sessions/:id',
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const owner = resolveOwner(request) ?? request.owner;
      const url = `${chatServiceUrl()}/sessions/${encodeURIComponent(request.params.id)}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- POST /api/chat/sessions/:id/share | /unshare — owner-only publish toggle ---
  for (const action of ['share', 'unshare'] as const) {
    app.post<{ Params: SessionParams }>(
      `/api/chat/sessions/:id/${action}`,
      async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
        const owner = resolveOwner(request);
        if (!owner) return reply.status(401).send({ code: 'no_owner' });
        const url = `${chatServiceUrl()}/sessions/${encodeURIComponent(request.params.id)}/${action}`;
        try {
          const { status, payload } = await proxyJson(url, 'POST', owner, request.workspace.id);
          return reply.status(status).send(payload);
        } catch (err) {
          return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
        }
      },
    );
  }

  // --- GET /api/chat/sessions/:id/focus — Phase 03 session-focus inspection ---
  // The chat-service registers this route with the full /api/chat prefix
  // (unlike /sessions/:id), so the upstream path keeps it.
  app.get<{ Params: SessionParams }>(
    '/api/chat/sessions/:id/focus',
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const owner = resolveOwner(request) ?? request.owner;
      const url = `${chatServiceUrl()}/api/chat/sessions/${encodeURIComponent(request.params.id)}/focus`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- DELETE /api/chat/sessions/:id/focus — "Forget everything in this chat" ---
  app.delete<{ Params: SessionParams }>(
    '/api/chat/sessions/:id/focus',
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const url = `${chatServiceUrl()}/api/chat/sessions/${encodeURIComponent(request.params.id)}/focus`;
      try {
        const { status, payload } = await proxyJson(url, 'DELETE', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- DELETE /api/chat/sessions/:id ---
  app.delete<{ Params: SessionParams }>(
    '/api/chat/sessions/:id',
    async (request: FastifyRequest<{ Params: SessionParams }>, reply: FastifyReply) => {
      const owner = resolveOwner(request) ?? request.owner;
      const url = `${chatServiceUrl()}/sessions/${encodeURIComponent(request.params.id)}`;
      try {
        const { status, payload } = await proxyJson(url, 'DELETE', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- PATCH /api/chat/sessions/:id — rename session title ---
  app.patch<{ Params: SessionParams; Body: PatchSessionBody }>(
    '/api/chat/sessions/:id',
    async (request: FastifyRequest<{ Params: SessionParams; Body: PatchSessionBody }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const url = `${chatServiceUrl()}/sessions/${encodeURIComponent(request.params.id)}`;
      try {
        const { status, payload } = await proxyJson(url, 'PATCH', owner, request.workspace.id, request.body);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/notifications — list (phase-05) ---
  app.get<{ Querystring: { unread?: string; limit?: string } }>(
    '/api/chat/notifications',
    async (request: FastifyRequest<{ Querystring: { unread?: string; limit?: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const params = new URLSearchParams();
      if (request.query.unread) params.set('unread', request.query.unread);
      if (request.query.limit) params.set('limit', request.query.limit);
      const url = `${chatServiceUrl()}/notifications?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- POST /api/chat/notifications/:id/read — mark read (phase-05) ---
  app.post<{ Params: { id: string } }>(
    '/api/chat/notifications/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const url = `${chatServiceUrl()}/notifications/${encodeURIComponent(request.params.id)}/read`;
      try {
        const { status, payload } = await proxyJson(url, 'POST', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/audit/intents — recent intent_routed events (starter ranking) ---
  app.get<{ Querystring: { limit?: string } }>(
    '/api/chat/audit/intents',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const params = new URLSearchParams();
      if (request.query.limit) params.set('limit', request.query.limit);
      const url = `${chatServiceUrl()}/audit/intents?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- POST /api/chat/audit — fire-and-forget UI event log ---
  app.post(
    '/api/chat/audit',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }
      const url = `${chatServiceUrl()}/audit`;
      try {
        const { status, payload } = await proxyJson(url, 'POST', owner, request.workspace.id, request.body);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/leaderboard/skills?game=<id>&days=<n> ---
  app.get<{ Querystring: { game?: string; days?: string } }>(
    '/api/chat/debug/leaderboard/skills',
    async (request: FastifyRequest<{ Querystring: { game?: string; days?: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      if (request.query.game) params.set('game', request.query.game);
      if (request.query.days) params.set('days', request.query.days);
      const url = `${chatServiceUrl()}/debug/leaderboard/skills?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/cache-effectiveness?game=<id>&days=<n>&topN=<n>&q=<str> ---
  app.get<{ Querystring: { game?: string; days?: string; topN?: string; q?: string } }>(
    '/api/chat/debug/cache-effectiveness',
    async (
      request: FastifyRequest<{ Querystring: { game?: string; days?: string; topN?: string; q?: string } }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      const q = request.query;
      if (q.game) params.set('game', q.game);
      if (q.days) params.set('days', q.days);
      if (q.topN) params.set('topN', q.topN);
      if (q.q) params.set('q', q.q);
      const url = `${chatServiceUrl()}/debug/cache-effectiveness?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/stats?owner=<id>&from=<iso>&to=<iso> ---
  app.get<{ Querystring: StatsQuery }>(
    '/api/chat/stats',
    async (request: FastifyRequest<{ Querystring: StatsQuery }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) {
        return reply.status(401).send({ code: 'no_owner' });
      }

      const { owner: qOwner, from, to } = request.query;

      const params = new URLSearchParams();
      if (qOwner) params.set('owner', qOwner);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const url = `${chatServiceUrl()}/stats?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Debug / observability API proxy (phase-06)
  // Forwards /api/chat/debug/* → chat-service /debug/*
  // All routes enforce X-Owner-Id in chat-service; proxy passes it through.
  // ---------------------------------------------------------------------------

  // --- GET /api/chat/debug/sessions?game=&q=&limit= ---
  app.get<{ Querystring: { game?: string; q?: string; limit?: string } }>(
    '/api/chat/debug/sessions',
    async (request: FastifyRequest<{ Querystring: { game?: string; q?: string; limit?: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      if (request.query.game) params.set('game', request.query.game);
      if (request.query.q) params.set('q', request.query.q);
      if (request.query.limit) params.set('limit', request.query.limit);
      const url = `${chatServiceUrl()}/debug/sessions?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/sessions/:id ---
  app.get<{ Params: { id: string } }>(
    '/api/chat/debug/sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const url = `${chatServiceUrl()}/debug/sessions/${encodeURIComponent(request.params.id)}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/turns/:turnId ---
  app.get<{ Params: { turnId: string } }>(
    '/api/chat/debug/turns/:turnId',
    async (request: FastifyRequest<{ Params: { turnId: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const url = `${chatServiceUrl()}/debug/turns/${encodeURIComponent(request.params.turnId)}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/turns/:turnId/raw?cursor=&limit= ---
  app.get<{ Params: { turnId: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/chat/debug/turns/:turnId/raw',
    async (
      request: FastifyRequest<{ Params: { turnId: string }; Querystring: { cursor?: string; limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      if (request.query.cursor) params.set('cursor', request.query.cursor);
      if (request.query.limit) params.set('limit', request.query.limit);
      const url = `${chatServiceUrl()}/debug/turns/${encodeURIComponent(request.params.turnId)}/raw?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- POST /api/chat/debug/turns/:turnId/annotation ---
  // Upserts star/flag/note for a turn. Body: { starred?, flag?, note? }.
  app.post<{ Params: { turnId: string }; Body: unknown }>(
    '/api/chat/debug/turns/:turnId/annotation',
    async (
      request: FastifyRequest<{ Params: { turnId: string }; Body: unknown }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const url = `${chatServiceUrl()}/debug/turns/${encodeURIComponent(request.params.turnId)}/annotation`;
      try {
        const { status, payload } = await proxyJson(url, 'POST', owner, request.workspace.id, request.body);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- DELETE /api/chat/debug/turns/:turnId/annotation ---
  app.delete<{ Params: { turnId: string } }>(
    '/api/chat/debug/turns/:turnId/annotation',
    async (
      request: FastifyRequest<{ Params: { turnId: string } }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const url = `${chatServiceUrl()}/debug/turns/${encodeURIComponent(request.params.turnId)}/annotation`;
      try {
        const { status, payload } = await proxyJson(url, 'DELETE', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/search?q=&owner=&game=&starred=&cursor=&limit= ---
  // Cross-turn LIKE search over user/assistant text + tool args. Owner-scoped.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/chat/debug/search',
    async (
      request: FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(request.query)) {
        if (typeof v === 'string' && v.length > 0) params.set(k, v);
      }
      const url = `${chatServiceUrl()}/debug/search?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- GET /api/chat/debug/search/cached?q=&game=&limit= ---
  // Searches response_cache rows visible to the requesting owner. Owner-scoped.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/chat/debug/search/cached',
    async (
      request: FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
      reply: FastifyReply,
    ) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(request.query)) {
        if (typeof v === 'string' && v.length > 0) params.set(k, v);
      }
      const url = `${chatServiceUrl()}/debug/search/cached?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'GET', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );

  // --- DELETE /api/chat/debug/cache?game=<id> ---
  // Clears response_cache rows for the given game. Owner must have at least one session
  // in the game (enforced in chat-service). Returns { deleted: <n> }.
  app.delete<{ Querystring: { game?: string } }>(
    '/api/chat/debug/cache',
    async (request: FastifyRequest<{ Querystring: { game?: string } }>, reply: FastifyReply) => {
      const owner = resolveOwner(request);
      if (!owner) return reply.status(401).send({ code: 'no_owner' });
      const params = new URLSearchParams();
      if (request.query.game) params.set('game', request.query.game);
      const url = `${chatServiceUrl()}/debug/cache?${params.toString()}`;
      try {
        const { status, payload } = await proxyJson(url, 'DELETE', owner, request.workspace.id);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );
}
