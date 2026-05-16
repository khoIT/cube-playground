/**
 * Origin allowlist gate on schema-write middleware (red-team finding #13).
 *
 * The gate runs BEFORE body validation, so requests from disallowed origins
 * receive 403 without leaking validator state. Requests with NO `Origin`
 * header (curl, server-to-server) are NOT gated here — that surface is not
 * the browser-CSRF threat model.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { handleWriteRequest } from '../schema-write-handler.js';

function makeReq(headers: Record<string, string>, method = 'POST'): IncomingMessage {
  const r = new EventEmitter() as unknown as IncomingMessage;
  (r as any).headers = headers;
  (r as any).method = method;
  // No body emitted — handler should reject before reading it for the origin-block path.
  setImmediate(() => {
    (r as any).emit('end');
  });
  return r;
}

function makeRes(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
  ended: () => boolean;
} {
  const chunks: string[] = [];
  let statusCode = 0;
  let ended = false;
  const res = {
    statusCode: 0,
    setHeader(_k: string, _v: string) {},
    writeHead(code: number) { statusCode = code; },
    write(c: string) { chunks.push(c); return true; },
    end(c?: string) { if (c) chunks.push(c); ended = true; return this; },
    get headersSent() { return ended; },
  } as unknown as ServerResponse;
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => { statusCode = v; },
  });
  return { res, status: () => statusCode, body: () => chunks.join(''), ended: () => ended };
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOWED = process.env.SCHEMA_WRITE_ALLOWED_ORIGINS;

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  delete process.env.SCHEMA_WRITE_ALLOWED_ORIGINS;
});
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_ALLOWED) process.env.SCHEMA_WRITE_ALLOWED_ORIGINS = ORIGINAL_ALLOWED;
  else delete process.env.SCHEMA_WRITE_ALLOWED_ORIGINS;
});

describe('schema-write origin allowlist', () => {
  it('rejects disallowed origin with 403', async () => {
    const req = makeReq({ origin: 'http://evil.example.com' });
    const { res, status, body } = makeRes();
    await handleWriteRequest(req, res, {
      modelDir: '/tmp/model',
      cubeApiUrl: 'http://localhost:4000',
      cubeToken: '',
    });
    expect(status()).toBe(403);
    expect(body()).toContain('origin-not-allowed');
  });

  it('permits default localhost:3000', async () => {
    const req = makeReq({ origin: 'http://localhost:3000' });
    const { res, status, body } = makeRes();
    await handleWriteRequest(req, res, {
      modelDir: '/tmp/model',
      cubeApiUrl: 'http://localhost:4000',
      cubeToken: '',
    });
    // Not 403 — body parse failure is fine, it means the gate passed.
    expect(status()).not.toBe(403);
    expect(body()).not.toContain('origin-not-allowed');
  });

  it('permits requests with no Origin header (non-browser)', async () => {
    const req = makeReq({});
    const { res, status, body } = makeRes();
    await handleWriteRequest(req, res, {
      modelDir: '/tmp/model',
      cubeApiUrl: 'http://localhost:4000',
      cubeToken: '',
    });
    expect(status()).not.toBe(403);
    expect(body()).not.toContain('origin-not-allowed');
  });

  it('respects SCHEMA_WRITE_ALLOWED_ORIGINS env override', async () => {
    process.env.SCHEMA_WRITE_ALLOWED_ORIGINS = 'https://app.gds.cube.internal';
    const req = makeReq({ origin: 'https://app.gds.cube.internal' });
    const { res, status } = makeRes();
    await handleWriteRequest(req, res, {
      modelDir: '/tmp/model',
      cubeApiUrl: 'http://localhost:4000',
      cubeToken: '',
    });
    expect(status()).not.toBe(403);

    const req2 = makeReq({ origin: 'http://localhost:3000' });
    const r2 = makeRes();
    await handleWriteRequest(req2, r2.res, {
      modelDir: '/tmp/model',
      cubeApiUrl: 'http://localhost:4000',
      cubeToken: '',
    });
    expect(r2.status()).toBe(403);
  });
});
