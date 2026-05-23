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

      // AbortController ties upstream lifetime to client connection
      const abort = new AbortController();

      // Abort upstream when client disconnects
      request.raw.on('close', () => {
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

  // --- GET /api/chat/sessions?game=<id> ---
  app.get<{ Querystring: SessionsQuery }>(
    '/api/chat/sessions',
    async (request: FastifyRequest<{ Querystring: SessionsQuery }>, reply: FastifyReply) => {
      const owner = resolveOwner(request) ?? request.owner;
      const game = request.query.game ?? '';
      const url = `${chatServiceUrl()}/sessions?game=${encodeURIComponent(game)}`;
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
}
