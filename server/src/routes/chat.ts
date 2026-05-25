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

// Read at request time so tests can override CHAT_SERVICE_URL env var before each request
function chatServiceUrl(): string {
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
 */
async function proxyJson(
  upstream: string,
  method: string,
  ownerId: string,
  body?: unknown,
): Promise<{ status: number; payload: unknown }> {
  const res = await fetch(upstream, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Id': ownerId,
    },
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
 * Resolves the effective owner for a request.
 * Checks both X-Owner-Id (chat-specific) and falls back to the value set by
 * the owner-header middleware (which reads X-Owner). Returns null when neither
 * header is present or non-empty.
 */
function resolveOwner(request: FastifyRequest): string | null {
  // Prefer the chat-specific X-Owner-Id header used by chat-service clients
  const ownerId = request.headers['x-owner-id'];
  if (typeof ownerId === 'string' && ownerId.trim()) {
    return ownerId.trim();
  }
  // Fall back to value populated by the existing owner-header middleware (X-Owner)
  if (request.owner && request.owner !== 'anonymous') {
    return request.owner;
  }
  return null;
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

      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(`${chatServiceUrl()}/agent/turn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cube-Token': token,
            'X-Cube-Game': body.game,
            'X-Owner-Id': owner,
          },
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'DELETE', owner);
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
        const { status, payload } = await proxyJson(url, 'PATCH', owner, request.body);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'POST', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'POST', owner, request.body);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
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
        const { status, payload } = await proxyJson(url, 'GET', owner);
        return reply.status(status).send(payload);
      } catch (err) {
        return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
      }
    },
  );
}
