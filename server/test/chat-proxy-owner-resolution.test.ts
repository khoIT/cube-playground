/**
 * Regression test for chat ownership resolution in the /api/chat/* proxy.
 *
 * The bug: the proxy trusted the client-supplied `X-Owner-Id` header over the
 * verified principal, so every authenticated user (whose FE sent the default
 * `X-Owner-Id: dev`) collapsed to a single shared owner and saw each other's
 * sessions. The fix makes resolveOwner server-authoritative: the value the
 * auth middleware put on `request.owner` (claims.sub in real auth) wins, and
 * the client header is only a fallback when no verified identity exists.
 *
 * Here the standalone `ownerHeader` middleware stands in for auth: it sets
 * `request.owner` from the `X-Owner` header (else 'anonymous'). The fake
 * upstream echoes back the `X-Owner-Id` it received from the proxy, so we can
 * assert which identity actually reached chat-service.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import ownerHeader from '../src/middleware/owner-header.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import chatRoutes from '../src/routes/chat.js';

let fakeUpstream: FastifyInstance;
let baseUrl: string;
let app: FastifyInstance;
const saved: Record<string, string | undefined> = {};
const ENV = ['CHAT_SERVICE_URL', 'CHAT_FEATURE_ENABLED'];

beforeAll(async () => {
  fakeUpstream = Fastify({ logger: false });
  // Echo the forwarded owner so the test can assert what reached chat-service.
  fakeUpstream.get('/sessions/:id', (req, reply) => {
    return reply.send({ id: (req.params as Record<string, string>)['id'], forwardedOwner: req.headers['x-owner-id'] });
  });
  await fakeUpstream.listen({ port: 0, host: '127.0.0.1' });
  const addr = fakeUpstream.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 3005}`;
});

afterAll(async () => {
  await fakeUpstream.close();
});

beforeEach(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.CHAT_SERVICE_URL = baseUrl;
  process.env.CHAT_FEATURE_ENABLED = 'true';
  app = Fastify({ logger: false });
  await app.register(ownerHeader);
  await app.register(workspaceHeader);
  await app.register(chatRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('chat proxy — server-authoritative owner resolution', () => {
  it('verified principal (request.owner) wins over a spoofable client X-Owner-Id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/s1',
      // X-Owner → request.owner (the "verified" identity); X-Owner-Id is the
      // stale client default. The real owner must reach the upstream.
      headers: { 'x-owner': 'khoitn-sub', 'x-owner-id': 'dev' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().forwardedOwner).toBe('khoitn-sub');
  });

  it('falls back to client X-Owner-Id when no verified identity exists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat/sessions/s1',
      headers: { 'x-owner-id': 'legacy-tester' }, // request.owner stays 'anonymous'
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().forwardedOwner).toBe('legacy-tester');
  });
});
