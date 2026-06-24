/**
 * Integration tests for /api/chat/* proxy routes.
 *
 * Strategy: spin up a tiny in-process Fastify "fake upstream" on a random port
 * that replays canned SSE / JSON responses. The real chatRoutes plugin is
 * mounted on a lightweight test app (no DB, no business-metrics) so the test
 * stays fast and fully in-process.
 *
 * resolveCubeTokenForGame is vi.mock'd to return a fixed token.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import ownerHeader from '../src/middleware/owner-header.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import chatRoutes from '../src/routes/chat.js';

// --- Mock resolveCubeTokenForGame ---
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(() => 'test-cube-token'),
  resolveCubeTokenForGameDetailed: vi.fn(() => ({ token: 'test-cube-token', source: 'env' })),
  // workspaceHeader middleware also resolves the workspace-aware variant —
  // tests don't depend on its return value, just need it to not throw.
  resolveCubeTokenForWorkspace: vi.fn(() => ({ token: 'test-cube-token', source: 'env' })),
  __envKeyFor: (g: string) => `CUBE_TOKEN_${g.toUpperCase()}`,
}));

// Re-import after mock so the mock is applied
import { resolveCubeTokenForGame } from '../src/services/resolve-cube-token.js';

// SSE events the fake upstream will emit for /agent/turn
const FAKE_SSE_EVENTS = [
  'event: loading\ndata: {}\n\n',
  'event: token\ndata: {"delta":"hi"}\n\n',
  'event: done\ndata: {}\n\n',
].join('');

// Fake upstream Fastify instance
let fakeUpstream: FastifyInstance;
let fakeUpstreamBaseUrl: string;

// Real test app (only chat routes + owner middleware)
let app: FastifyInstance;

// Saved env vars
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['CHAT_SERVICE_URL', 'CHAT_FEATURE_ENABLED'];

beforeAll(async () => {
  // --- Boot fake upstream ---
  fakeUpstream = Fastify({ logger: false });

  fakeUpstream.post('/agent/turn', (_req, reply) => {
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    reply.raw.write(FAKE_SSE_EVENTS);
    reply.raw.end();
    return reply.hijack();
  });

  fakeUpstream.get('/sessions', (_req, reply) => {
    return reply.send([{ id: 'a', game_id: 'ptg' }]);
  });

  fakeUpstream.get('/sessions/:id', (req, reply) => {
    const params = req.params as Record<string, string>;
    return reply.send({ id: params['id'], status: 'active' });
  });

  fakeUpstream.patch('/sessions/:id', (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const params = req.params as Record<string, string>;
    return reply.send({ id: params['id'], title: body['title'], status: 'active' });
  });

  fakeUpstream.delete('/sessions/:id', (_req, reply) => {
    return reply.status(204).send();
  });

  // Echo the received query so tests can assert which params the proxy forwards.
  fakeUpstream.get('/debug/sessions', (req, reply) => {
    return reply.send({ _query: req.query });
  });
  fakeUpstream.get('/debug/session-owners', (req, reply) => {
    return reply.send({ _query: req.query });
  });

  fakeUpstream.get('/stats', (req, reply) => {
    const query = req.query as Record<string, string>;
    return reply.send({
      turns: 5,
      input_tokens: 1000,
      output_tokens: 2000,
      cost_usd: 0.0015,
      by_skill: { explore: { turns: 5, input_tokens: 1000, output_tokens: 2000 } },
      _owner: query['owner'],
    });
  });

  await fakeUpstream.listen({ port: 0, host: '127.0.0.1' });

  const address = fakeUpstream.server.address();
  const port = typeof address === 'object' && address ? address.port : 3005;
  fakeUpstreamBaseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await fakeUpstream.close();
});

beforeEach(async () => {
  // Save + set env
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.CHAT_SERVICE_URL = fakeUpstreamBaseUrl;
  process.env.CHAT_FEATURE_ENABLED = 'true';

  // Reset mock return value to a valid token
  vi.mocked(resolveCubeTokenForGame).mockReturnValue('test-cube-token');

  // Build lightweight test app — no DB required
  app = Fastify({ logger: true });
  await app.register(ownerHeader);
  await app.register(workspaceHeader);
  await app.register(chatRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('POST /api/chat/sessions/new/turn — header forwarding (C1)', () => {
  it('forwards X-Bypass-Cache header to upstream when present', async () => {
    // Spin up a capture upstream to inspect forwarded headers
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json', 'x-bypass-cache': '1' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-bypass-cache']).toBe('1');
  });

  it('forwards X-Model header to upstream when present', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json', 'x-model': 'claude-opus-4-5' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-model']).toBe('claude-opus-4-5');
  });

  it('forwards X-Web-Search header to upstream when present', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json', 'x-web-search': '1' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-web-search']).toBe('1');
  });

  it('does not forward X-Web-Search when absent', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-web-search']).toBeUndefined();
  });

  it('forwards X-Research-Mode header to upstream when present', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json', 'x-research-mode': '1' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-research-mode']).toBe('1');
  });

  it('does not forward X-Research-Mode when absent', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-research-mode']).toBeUndefined();
  });

  it('forwards X-Web-Search and X-Research-Mode independently', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    // Send only X-Web-Search; X-Research-Mode must be absent.
    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: {
        'x-owner-id': 'tester',
        'content-type': 'application/json',
        'x-web-search': '1',
      },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    expect(capturedHeaders['x-web-search']).toBe('1');
    expect(capturedHeaders['x-research-mode']).toBeUndefined();
  });

  it('does not forward X-Bypass-Cache when absent', async () => {
    const captureApp = Fastify({ logger: false });
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    captureApp.post('/agent/turn', (req, reply) => {
      capturedHeaders = { ...req.headers };
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = captureApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${port}`;

    const testApp = Fastify({ logger: false });
    await testApp.register(ownerHeader);
    await testApp.register(workspaceHeader);
    await testApp.register(chatRoutes);

    await testApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await testApp.close();
    await captureApp.close();

    // Header must be absent — not forwarded as 'undefined' string
    expect(capturedHeaders['x-bypass-cache']).toBeUndefined();
    expect(capturedHeaders['x-model']).toBeUndefined();
  });
});

describe('POST /api/chat/sessions/new/turn', () => {
  it('streams SSE events from upstream when X-Owner-Id is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    const body = res.body;
    expect(body).toContain('event: loading');
    expect(body).toContain('event: token');
    expect(body).toContain('"delta":"hi"');
    expect(body).toContain('event: done');

    // Assert order: loading comes before token, token before done
    const loadingIdx = body.indexOf('event: loading');
    const tokenIdx = body.indexOf('event: token');
    const doneIdx = body.indexOf('event: done');
    expect(loadingIdx).toBeLessThan(tokenIdx);
    expect(tokenIdx).toBeLessThan(doneIdx);
  });

  it('returns 401 when X-Owner-Id header is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'no_owner' });
  });

  it('returns 503 when cube token cannot be resolved', async () => {
    vi.mocked(resolveCubeTokenForGame).mockReturnValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'no_cube_token', game: 'ptg' });
  });

  it('sets session_id=null in upstream body when id is "new"', async () => {
    // Capture what the fake upstream received via a custom route for this test
    let capturedBody: unknown = null;
    const captureApp = Fastify({ logger: false });

    captureApp.post('/agent/turn', async (req, reply) => {
      capturedBody = req.body;
      void reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
      return reply.hijack();
    });
    captureApp.get('/sessions', async (_req, reply) => reply.send([]));

    await captureApp.listen({ port: 0, host: '127.0.0.1' });
    const captureAddr = captureApp.server.address();
    const capturePort = typeof captureAddr === 'object' && captureAddr ? captureAddr.port : 0;
    process.env.CHAT_SERVICE_URL = `http://127.0.0.1:${capturePort}`;

    // Rebuild app with new CHAT_SERVICE_URL
    const captureTestApp = Fastify({ logger: false });
    await captureTestApp.register(ownerHeader);
    await captureTestApp.register(workspaceHeader);
    await captureTestApp.register(chatRoutes);

    await captureTestApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hello', game: 'ptg' },
    });

    await captureTestApp.close();
    await captureApp.close();

    expect((capturedBody as Record<string, unknown>).session_id).toBeNull();
  });
});

describe('GET /api/chat/sessions', () => {
  it('proxies the sessions list from upstream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions?game=ptg',
      headers: { 'x-owner-id': 'tester' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([{ id: 'a', game_id: 'ptg' }]);
  });
});

describe('CHAT_FEATURE_ENABLED=false', () => {
  it('returns 404 with chat_disabled for all /api/chat/* routes', async () => {
    process.env.CHAT_FEATURE_ENABLED = 'false';

    const disabledApp = Fastify({ logger: false });
    await disabledApp.register(ownerHeader);
    await disabledApp.register(chatRoutes);

    const res = await disabledApp.inject({
      method: 'POST',
      url: '/api/chat/sessions/new/turn',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { message: 'hi', game: 'ptg' },
    });

    await disabledApp.close();

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'chat_disabled' });
  });
});

describe('PATCH /api/chat/sessions/:id', () => {
  it('proxies rename request and returns updated session', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/chat/sessions/sess-123',
      headers: { 'x-owner-id': 'tester', 'content-type': 'application/json' },
      payload: { title: 'New Title' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toBe('sess-123');
    expect(body.title).toBe('New Title');
  });

  it('returns 401 when X-Owner-Id header is absent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/chat/sessions/sess-123',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'New Title' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/chat/stats', () => {
  it('proxies stats request and returns aggregated data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/stats?owner=tester&from=2026-05-01T00:00:00Z&to=2026-05-23T23:59:59Z',
      headers: { 'x-owner-id': 'tester' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.turns).toBe(5);
    expect(body.input_tokens).toBe(1000);
    expect(body.output_tokens).toBe(2000);
    expect(typeof body.cost_usd).toBe('number');
    expect(body.by_skill).toBeDefined();
    // Verify owner was forwarded in query string
    expect((body as Record<string, unknown>)._owner).toBe('tester');
  });

  it('returns 401 when X-Owner-Id header is absent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/stats?owner=tester',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/chat/debug/* — hideSynthetic forwarding (admin)', () => {
  // The debug session routes are admin-gated; build an app that decorates the
  // request with an admin role so the proxy applies its admin-only forwards.
  async function buildAdminApp(): Promise<FastifyInstance> {
    const adminApp = Fastify({ logger: false });
    adminApp.addHook('onRequest', (req, _reply, done) => {
      (req as unknown as { user: { role: string } }).user = { role: 'admin' };
      done();
    });
    await adminApp.register(ownerHeader);
    await adminApp.register(workspaceHeader);
    await adminApp.register(chatRoutes);
    await adminApp.ready();
    return adminApp;
  }

  it('forwards hideSynthetic=1 to /debug/sessions for admins', async () => {
    const adminApp = await buildAdminApp();
    const res = await adminApp.inject({
      method: 'GET',
      url: '/api/chat/debug/sessions?game=ptg&scope=all&hideSynthetic=1',
      headers: { 'x-owner-id': 'admin' },
    });
    await adminApp.close();
    expect(res.statusCode).toBe(200);
    const q = (res.json() as { _query: Record<string, string> })._query;
    expect(q.hideSynthetic).toBe('1');
    expect(q.scope).toBe('all');
  });

  it('forwards hideSynthetic=1 to /debug/session-owners for admins', async () => {
    const adminApp = await buildAdminApp();
    const res = await adminApp.inject({
      method: 'GET',
      url: '/api/chat/debug/session-owners?game=ptg&hideSynthetic=1',
      headers: { 'x-owner-id': 'admin' },
    });
    await adminApp.close();
    expect(res.statusCode).toBe(200);
    const q = (res.json() as { _query: Record<string, string> })._query;
    expect(q.hideSynthetic).toBe('1');
  });

  it('omits hideSynthetic from /debug/sessions when not requested', async () => {
    const adminApp = await buildAdminApp();
    const res = await adminApp.inject({
      method: 'GET',
      url: '/api/chat/debug/sessions?game=ptg&scope=all',
      headers: { 'x-owner-id': 'admin' },
    });
    await adminApp.close();
    const q = (res.json() as { _query: Record<string, string> })._query;
    expect(q.hideSynthetic).toBeUndefined();
  });
});
