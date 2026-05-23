/**
 * Integration tests for GET /stats endpoint.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';
import * as chatStore from '../src/db/chat-store.js';
import { buildApp } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

// Minimal env setup so config doesn't throw on required vars
process.env['ANTHROPIC_API_KEY'] = 'test-key';
process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:9999';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function seedTurns(
  db: Database.Database,
  opts: {
    ownerId: string;
    gameId: string;
    turns: Array<{ inputTokens: number; outputTokens: number; skill: string; startedAt: number }>;
  },
): void {
  const session = chatStore.createSession(db, { ownerId: opts.ownerId, gameId: opts.gameId });
  opts.turns.forEach((t, i) => {
    chatStore.appendTurn(db, {
      sessionId: session.id,
      turnIndex: i,
      role: 'assistant',
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      skill: t.skill,
      startedAt: t.startedAt,
      endedAt: t.startedAt + 100,
    });
  });
}

describe('GET /stats', () => {
  let app: FastifyInstance;
  let db: Database.Database;

  const NOW = new Date('2026-05-23T10:00:00Z').getTime();
  const FROM = new Date('2026-05-23T00:00:00Z').toISOString();
  const TO = new Date('2026-05-23T23:59:59Z').toISOString();

  beforeEach(async () => {
    db = makeDb();

    // Seed turns for owner1: 3 turns across 2 skills
    seedTurns(db, {
      ownerId: 'owner1',
      gameId: 'ptg',
      turns: [
        { inputTokens: 100, outputTokens: 200, skill: 'explore', startedAt: NOW },
        { inputTokens: 150, outputTokens: 250, skill: 'explore', startedAt: NOW + 1000 },
        { inputTokens: 200, outputTokens: 300, skill: 'diagnose', startedAt: NOW + 2000 },
      ],
    });

    // Seed turns for owner2: 2 turns (should NOT appear in owner1's stats)
    seedTurns(db, {
      ownerId: 'owner2',
      gameId: 'ptg',
      turns: [
        { inputTokens: 999, outputTokens: 999, skill: 'explore', startedAt: NOW },
        { inputTokens: 999, outputTokens: 999, skill: 'explore', startedAt: NOW + 1000 },
      ],
    });

    const built = await buildApp(':memory:');
    // Replace internal db with our seeded one
    // buildApp creates its own db, so we use the db directly via inject approach
    // Instead, we build with a temp file and re-seed, OR we expose db in buildApp
    // The existing buildApp returns { fastify, db } — we'll use that db
    app = built.fastify;

    // Re-seed the app's own db (we can't inject our db directly without refactoring)
    // So we seed the app's db instead
    const appDb = built.db;

    seedTurns(appDb, {
      ownerId: 'owner1',
      gameId: 'ptg',
      turns: [
        { inputTokens: 100, outputTokens: 200, skill: 'explore', startedAt: NOW },
        { inputTokens: 150, outputTokens: 250, skill: 'explore', startedAt: NOW + 1000 },
        { inputTokens: 200, outputTokens: 300, skill: 'diagnose', startedAt: NOW + 2000 },
      ],
    });

    seedTurns(appDb, {
      ownerId: 'owner2',
      gameId: 'ptg',
      turns: [
        { inputTokens: 999, outputTokens: 999, skill: 'explore', startedAt: NOW },
        { inputTokens: 999, outputTokens: 999, skill: 'explore', startedAt: NOW + 1000 },
      ],
    });

    await app.ready();
  });

  it('returns correct aggregated stats for owner1', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/stats?owner=owner1&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: { 'x-owner-id': 'owner1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    expect(body.turns).toBe(3);
    expect(body.input_tokens).toBe(450);   // 100+150+200
    expect(body.output_tokens).toBe(750);  // 200+250+300
    expect(typeof body.cost_usd).toBe('number');
    expect((body.cost_usd as number)).toBeGreaterThan(0);

    const bySkill = body.by_skill as Record<string, { turns: number; input_tokens: number; output_tokens: number }>;
    expect(bySkill['explore'].turns).toBe(2);
    expect(bySkill['explore'].input_tokens).toBe(250);
    expect(bySkill['diagnose'].turns).toBe(1);
    expect(bySkill['diagnose'].input_tokens).toBe(200);
  });

  it('returns 403 when owner query param does not match X-Owner-Id header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/stats?owner=owner2&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers: { 'x-owner-id': 'owner1' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when X-Owner-Id header is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/stats?owner=owner1`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when owner query param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stats',
      headers: { 'x-owner-id': 'owner1' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns zero counts when date range has no matching turns', async () => {
    const pastFrom = '2020-01-01T00:00:00Z';
    const pastTo = '2020-01-02T00:00:00Z';

    const res = await app.inject({
      method: 'GET',
      url: `/stats?owner=owner1&from=${encodeURIComponent(pastFrom)}&to=${encodeURIComponent(pastTo)}`,
      headers: { 'x-owner-id': 'owner1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.turns).toBe(0);
    expect(body.input_tokens).toBe(0);
    expect(body.cost_usd).toBe(0);
  });
});
