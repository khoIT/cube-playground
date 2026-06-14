/**
 * advisor-run-store — round-trip persistence + retention prune for the advisor
 * agent audit trail (migration 055). Uses an in-memory DB via setDb so the dev
 * DB is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  persistTurn,
  listRuns,
  getRunDetail,
  listEvents,
  listOwners,
  pruneOlderThan,
  type TurnFlush,
} from '../src/advisor/agent/advisor-run-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function flushFor(sessionId: string, turnIndex: number, createdAt: number, overrides: Partial<TurnFlush> = {}): TurnFlush {
  const base: TurnFlush = {
    run: {
      sessionId,
      gameId: 'cfm_vn',
      segmentId: 'seg-abc-123',
      scopeKind: 'segment',
      goal: 'revenue',
      mode: 'drive',
      owner: 'analyst@corp.com',
      model: 'claude-opus-4-8',
      turnCount: turnIndex,
      totalCostUsd: 0.05 * turnIndex,
      finalStopReason: 'end_turn',
      hadError: false,
      createdAt,
      lastActiveAt: createdAt + 1000,
    },
    turn: {
      sessionId,
      turnIndex,
      mode: 'drive',
      message: `prompt ${turnIndex}`,
      narration: `narration ${turnIndex}`,
      toolCallCount: 2,
      stopReason: 'end_turn',
      costUsd: 0.05,
      startedAt: createdAt,
      endedAt: createdAt + 500,
      durationMs: 500,
    },
    toolCalls: [
      { callId: 'c1', tool: 'diagnose', seq: 0, inputJson: '{"scope":"seg"}', outputDigest: 'ok', state: 'ok', startedAt: createdAt, endedAt: createdAt + 100, durationMs: 100 },
      { callId: 'c2', tool: 'cube_query', seq: 1, inputJson: '{"measures":["revenue"]}', state: 'failed', errorMessage: 'timeout', startedAt: createdAt, endedAt: createdAt + 400, durationMs: 400 },
    ],
    events: [
      { turnIndex, eventIndex: 0, eventType: 'assistant_delta', eventJson: '{"type":"assistant_delta","text":"hi"}', ts: createdAt },
      { turnIndex, eventIndex: 1, eventType: 'tool_call', eventJson: '{"type":"tool_call","tool":"cube_query"}', ts: createdAt + 50 },
      { turnIndex, eventIndex: 2, eventType: 'done', eventJson: '{"type":"done","stopReason":"end_turn"}', ts: createdAt + 500 },
    ],
    ...overrides,
  };
  return base;
}

describe('advisor-run-store', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('round-trips a run with turns, tool calls, and events', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('sess-1', 1, now));
    persistTurn(flushFor('sess-1', 2, now, { run: { ...flushFor('sess-1', 2, now).run, turnCount: 2, totalCostUsd: 0.1 } }));

    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ sessionId: 'sess-1', gameId: 'cfm_vn', goal: 'revenue', turnCount: 2, totalCostUsd: 0.1, hadError: false });

    const detail = getRunDetail('sess-1');
    expect(detail).not.toBeNull();
    expect(detail!.turns).toHaveLength(2);
    expect(detail!.turns[0].toolCalls).toHaveLength(2);
    const failed = detail!.turns[0].toolCalls.find((c) => c.state === 'failed');
    expect(failed).toMatchObject({ tool: 'cube_query', errorMessage: 'timeout', durationMs: 400 });

    const events = listEvents('sess-1', { turnIndex: 1 });
    expect(events.events).toHaveLength(3);
    expect(events.events[0].eventType).toBe('assistant_delta');
  });

  it('round-trips the observability fields: auth lane, token usage, and embedded errors', () => {
    const now = 1_700_000_000_000;
    const f = flushFor('obs-run', 1, now);
    f.run.authLane = 'subscription';
    f.run.authSource = 'CLAUDE_CODE_OAUTH_TOKEN';
    f.run.inputTokens = 12_000;
    f.run.outputTokens = 3_400;
    f.run.cacheReadTokens = 50_000;
    f.run.cacheCreationTokens = 8_000;
    f.turn.inputTokens = 12_000;
    f.turn.outputTokens = 3_400;
    // a tool that returned ok but embeds an upstream failure
    f.toolCalls = [
      {
        callId: 'd1',
        tool: 'diagnose',
        seq: 0,
        outputDigest: 'inconclusive: not found for path',
        state: 'ok',
        startedAt: now,
        endedAt: now + 80,
        durationMs: 80,
        embeddedError: true,
        embeddedErrorMessage: "'total_active_days' not found for path",
      },
    ];
    persistTurn(f);

    const run = listRuns({ q: 'obs-run' })[0];
    expect(run).toMatchObject({
      authLane: 'subscription',
      authSource: 'CLAUDE_CODE_OAUTH_TOKEN',
      inputTokens: 12_000,
      outputTokens: 3_400,
      cacheReadTokens: 50_000,
      cacheCreationTokens: 8_000,
    });

    const detail = getRunDetail('obs-run')!;
    expect(detail.turns[0]).toMatchObject({ inputTokens: 12_000, outputTokens: 3_400 });
    const call = detail.turns[0].toolCalls[0];
    expect(call.state).toBe('ok');
    expect(call.embeddedError).toBe(true);
    expect(call.embeddedErrorMessage).toContain('not found for path');
  });

  it('defaults embeddedError to false when not flagged', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('plain-run', 1, now));
    const detail = getRunDetail('plain-run')!;
    expect(detail.turns[0].toolCalls.every((c) => c.embeddedError === false)).toBe(true);
  });

  it('upsert keeps created_at and the same single row across turns', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('sess-2', 1, now));
    persistTurn(flushFor('sess-2', 2, now + 99999)); // a later createdAt in the payload must NOT overwrite the stored one
    const detail = getRunDetail('sess-2');
    expect(detail!.run.createdAt).toBe(now);
    expect(listRuns({ q: 'sess-2' })).toHaveLength(1);
  });

  it('filters by stopReason, owner, game, and free-text q', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('ok-run', 1, now));
    const timedOut = flushFor('to-run', 1, now);
    timedOut.run.finalStopReason = 'timeout';
    timedOut.run.hadError = true;
    timedOut.run.goal = 'retention';
    persistTurn(timedOut);

    expect(listRuns({ stopReason: 'timeout' }).map((r) => r.sessionId)).toEqual(['to-run']);
    expect(listRuns({ owner: 'analyst@corp.com' })).toHaveLength(2);
    expect(listRuns({ game: 'cfm_vn' })).toHaveLength(2);
    expect(listRuns({ q: 'retention' }).map((r) => r.sessionId)).toEqual(['to-run']);
  });

  it('paginates events with a cursor', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('sess-3', 1, now));
    const first = listEvents('sess-3', { limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = listEvents('sess-3', { cursor: first.nextCursor!, limit: 2 });
    expect(second.events).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('lists distinct owners', () => {
    const now = 1_700_000_000_000;
    persistTurn(flushFor('a', 1, now));
    const other = flushFor('b', 1, now);
    other.run.owner = 'lead@corp.com';
    persistTurn(other);
    expect(listOwners().sort()).toEqual(['analyst@corp.com', 'lead@corp.com']);
  });

  it('prunes runs older than the cutoff and cascades to children', () => {
    const old = 1_600_000_000_000;
    const recent = 1_700_000_000_000;
    persistTurn(flushFor('old-run', 1, old));
    persistTurn(flushFor('new-run', 1, recent));

    const removed = pruneOlderThan(1_650_000_000_000);
    expect(removed).toBe(1);

    expect(getRunDetail('old-run')).toBeNull();
    expect(getRunDetail('new-run')).not.toBeNull();
    // children of the pruned run are gone
    expect(listEvents('old-run', {}).events).toHaveLength(0);
  });
});
