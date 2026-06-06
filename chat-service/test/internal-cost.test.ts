/**
 * Admin cost bridge — GET /internal/cost-breakdown.
 *
 * Proves: per-dimension aggregation (owner / game / workspace / session) is
 * correct; stored per-turn cost_usd wins over the token-rate fallback (and a
 * stored 0 from a cache-hit replay stays 0, never re-priced); the secret gate
 * rejects without a valid x-internal-secret; default window is all-time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from '../src/db/migrate.js';
import { createSession, appendTurn } from '../src/db/chat-store.js';
import { queryCostBreakdown } from '../src/db/cost-breakdown-store.js';
import internalCostRoutes from '../src/api/internal-cost.js';

// Minimal env so config doesn't throw on required vars (also satisfied by .env).
process.env['ANTHROPIC_API_KEY'] = 'test-key';
process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:9999';

const SECRET = 'test-internal-secret';
const RATES = { costPer1kInputUsd: 0.003, costPer1kOutputUsd: 0.015 };

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

interface SeedOpts {
  ownerId: string;
  ownerLabel?: string;
  gameId: string;
  workspace?: string;
  turns: Array<{ input: number; output: number; costUsd?: number; startedAt: number }>;
}

function seedSession(db: Database.Database, opts: SeedOpts): string {
  const session = createSession(db, {
    ownerId: opts.ownerId,
    gameId: opts.gameId,
    workspace: opts.workspace,
    ownerLabel: opts.ownerLabel,
  });
  opts.turns.forEach((t, i) => {
    appendTurn(db, {
      sessionId: session.id,
      turnIndex: i,
      role: 'assistant',
      inputTokens: t.input,
      outputTokens: t.output,
      costUsd: t.costUsd,
      startedAt: t.startedAt,
      endedAt: t.startedAt + 100,
    });
  });
  return session.id;
}

describe('queryCostBreakdown (store)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it('prefers stored cost_usd and falls back to token rates for legacy NULL turns', () => {
    seedSession(db, {
      ownerId: 'alice-sub',
      gameId: 'cfm_vn',
      turns: [
        { input: 1000, output: 1000, costUsd: 0.5, startedAt: 1_000 }, // stored wins (≠ 0.018 fallback)
        { input: 1000, output: 1000, startedAt: 2_000 }, // legacy NULL → 0.003 + 0.015 = 0.018
      ],
    });

    const r = queryCostBreakdown(db, { fromMs: 0, toMs: 10_000, sessionLimit: 10, rates: RATES });
    expect(r.total.cost_usd).toBeCloseTo(0.518, 6);
    expect(r.total.turns).toBe(2);
    expect(r.total.sessions).toBe(1);
  });

  it('keeps cache-hit replay turns (stored cost 0) at zero — never re-priced from tokens', () => {
    seedSession(db, {
      ownerId: 'alice-sub',
      gameId: 'cfm_vn',
      turns: [{ input: 0, output: 0, costUsd: 0, startedAt: 1_000 }],
    });
    const r = queryCostBreakdown(db, { fromMs: 0, toMs: 10_000, sessionLimit: 10, rates: RATES });
    expect(r.total.cost_usd).toBe(0);
    expect(r.total.turns).toBe(1);
  });

  it('groups by owner, game, and workspace with per-group session counts', () => {
    seedSession(db, {
      ownerId: 'alice-sub',
      ownerLabel: 'Alice',
      gameId: 'cfm_vn',
      workspace: 'local',
      turns: [{ input: 0, output: 0, costUsd: 2, startedAt: 1_000 }],
    });
    seedSession(db, {
      ownerId: 'alice-sub',
      ownerLabel: 'Alice',
      gameId: 'cros',
      workspace: 'prod',
      turns: [{ input: 0, output: 0, costUsd: 1, startedAt: 2_000 }],
    });
    seedSession(db, {
      ownerId: 'bob-sub',
      gameId: 'cfm_vn',
      workspace: 'local',
      turns: [{ input: 0, output: 0, costUsd: 4, startedAt: 3_000 }],
    });

    const r = queryCostBreakdown(db, { fromMs: 0, toMs: 10_000, sessionLimit: 10, rates: RATES });

    expect(r.total.cost_usd).toBe(7);
    expect(r.total.sessions).toBe(3);

    // Owners sorted by cost desc; labels carried through.
    expect(r.by_owner.map((o) => o.owner_id)).toEqual(['bob-sub', 'alice-sub']);
    expect(r.by_owner[1].owner_label).toBe('Alice');
    expect(r.by_owner[1].cost_usd).toBe(3);
    expect(r.by_owner[1].sessions).toBe(2);

    expect(r.by_game.map((g) => [g.game_id, g.cost_usd])).toEqual([['cfm_vn', 6], ['cros', 1]]);
    expect(r.by_workspace.map((w) => [w.workspace, w.cost_usd])).toEqual([['local', 6], ['prod', 1]]);
  });

  it('orders sessions by cost desc, caps at sessionLimit, reports session_total', () => {
    seedSession(db, { ownerId: 'a', gameId: 'g', turns: [{ input: 0, output: 0, costUsd: 1, startedAt: 1_000 }] });
    seedSession(db, { ownerId: 'a', gameId: 'g', turns: [{ input: 0, output: 0, costUsd: 3, startedAt: 2_000 }] });
    seedSession(db, { ownerId: 'a', gameId: 'g', turns: [{ input: 0, output: 0, costUsd: 2, startedAt: 3_000 }] });

    const r = queryCostBreakdown(db, { fromMs: 0, toMs: 10_000, sessionLimit: 2, rates: RATES });
    expect(r.sessions.map((s) => s.cost_usd)).toEqual([3, 2]);
    expect(r.session_total).toBe(3);
    expect(r.sessions[0].last_turn_at).toBe(2_000);
  });

  it('respects the time window and zeroes an empty window (no NULL totals)', () => {
    seedSession(db, { ownerId: 'a', gameId: 'g', turns: [{ input: 100, output: 100, costUsd: 1, startedAt: 5_000 }] });

    const inWindow = queryCostBreakdown(db, { fromMs: 4_000, toMs: 6_000, sessionLimit: 10, rates: RATES });
    expect(inWindow.total.cost_usd).toBe(1);

    const outside = queryCostBreakdown(db, { fromMs: 0, toMs: 4_000, sessionLimit: 10, rates: RATES });
    expect(outside.total).toEqual({ cost_usd: 0, turns: 0, input_tokens: 0, output_tokens: 0, sessions: 0 });
    expect(outside.by_owner).toEqual([]);
  });
});

describe('GET /internal/cost-breakdown (endpoint)', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  const prev = process.env.AUTH_DISABLED;

  beforeEach(async () => {
    db = makeDb();
    seedSession(db, {
      ownerId: 'alice-sub',
      gameId: 'cfm_vn',
      turns: [{ input: 1000, output: 1000, costUsd: 0.25, startedAt: 1_000 }],
    });

    app = Fastify();
    await app.register(internalCostRoutes, { db, secretGate: { expectedSecret: SECRET } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    process.env.AUTH_DISABLED = prev;
  });

  it('defaults to all-time and returns the full breakdown shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/cost-breakdown',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total.cost_usd).toBeCloseTo(0.25, 6);
    expect(body.by_owner[0].owner_id).toBe('alice-sub');
    expect(body.by_game[0].game_id).toBe('cfm_vn');
    expect(body.by_workspace[0].workspace).toBe('local');
    expect(body.sessions).toHaveLength(1);
    expect(body.session_total).toBe(1);
  });

  it('400s on a malformed date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/cost-breakdown?from=not-a-date',
      headers: { 'x-internal-secret': SECRET },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects (401) without the secret EVEN when AUTH_DISABLED=true', async () => {
    process.env.AUTH_DISABLED = 'true';
    const res = await app.inject({ method: 'GET', url: '/internal/cost-breakdown' });
    expect(res.statusCode).toBe(401);
  });
});
