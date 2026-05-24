import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import * as monitoringStore from '../src/db/monitoring-store.js';
import { scheduler } from '../src/services/scheduler.js';

process.env['ANTHROPIC_API_KEY'] = 'test-key';
process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:9999';

describe('notifications routes', () => {
  let app: FastifyInstance;
  let db: import('better-sqlite3').Database;

  beforeEach(async () => {
    const built = await buildApp(':memory:');
    app = built.fastify;
    db = built.db;
    scheduler.clear();
  });

  afterEach(async () => {
    await app.close();
    scheduler.clear();
  });

  it('GET /notifications requires X-Owner-Id', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /notifications returns unread first', async () => {
    monitoringStore.insertNotification(db, {
      id: 'n1', ownerId: 'alice', kind: 'refresh_succeeded',
      payload: { message: 'first' }, createdAt: 1,
    });
    monitoringStore.insertNotification(db, {
      id: 'n2', ownerId: 'alice', kind: 'refresh_failed',
      payload: { message: 'second' }, createdAt: 2,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { 'x-owner-id': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; unread: number };
    expect(body.unread).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual(['n2', 'n1']);
  });

  it('POST /notifications/:id/read marks a notification read', async () => {
    monitoringStore.insertNotification(db, {
      id: 'n1', ownerId: 'alice', kind: 'k', payload: {}, createdAt: 1,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/n1/read',
      headers: { 'x-owner-id': 'alice' },
    });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({
      method: 'GET',
      url: '/notifications?unread=1',
      headers: { 'x-owner-id': 'alice' },
    });
    expect((list.json() as { unread: number }).unread).toBe(0);
  });

  it('GET /notifications/scheduler returns registered jobs', async () => {
    scheduler.register('hello', '*/1 * * * *', async () => undefined);
    const res = await app.inject({ method: 'GET', url: '/notifications/scheduler' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { jobs: Array<{ name: string }> };
    expect(body.jobs.map((j) => j.name)).toContain('hello');
  });
});
