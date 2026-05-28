/**
 * Phase-01 tests: SDK conversation id round-trip through chat-store + claude-
 * runner capture path.
 *
 * Covers:
 *   - chat-store CRUD: setSdkConversationId / clearSdkConversationId / read
 *   - claude-runner mocks the SDK to verify capture of session_id and emit of
 *     sdk_session_captured SSE event
 *   - compact-service clears the id on the old session before mark-compacted
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { migrate } from '../src/db/migrate.js';
import * as chatStore from '../src/db/chat-store.js';
import { compactSession } from '../src/core/compact-service.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// chat-store CRUD
// ---------------------------------------------------------------------------

describe('chatStore — sdk_conversation_id CRUD', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('setSdkConversationId writes the column; getSession reads it back', () => {
    const session = chatStore.createSession(db, {
      ownerId: 'owner1',
      gameId: 'ptg',
    });
    expect(session.sdk_conversation_id ?? null).toBeNull();

    chatStore.setSdkConversationId(db, session.id, 'conv_abc12345');
    const fetched = chatStore.getSession(db, session.id);
    expect(fetched?.sdk_conversation_id).toBe('conv_abc12345');
  });

  it('clearSdkConversationId nulls the column', () => {
    const session = chatStore.createSession(db, {
      ownerId: 'owner1',
      gameId: 'ptg',
    });
    chatStore.setSdkConversationId(db, session.id, 'conv_xyz');
    chatStore.clearSdkConversationId(db, session.id);
    const fetched = chatStore.getSession(db, session.id);
    expect(fetched?.sdk_conversation_id ?? null).toBeNull();
  });

  it('setSdkConversationId is idempotent (overwrite OK)', () => {
    const session = chatStore.createSession(db, {
      ownerId: 'owner1',
      gameId: 'ptg',
    });
    chatStore.setSdkConversationId(db, session.id, 'conv_old');
    chatStore.setSdkConversationId(db, session.id, 'conv_new');
    expect(chatStore.getSession(db, session.id)?.sdk_conversation_id).toBe(
      'conv_new',
    );
  });
});

// ---------------------------------------------------------------------------
// compact-service clears the id
// ---------------------------------------------------------------------------

describe('compactSession — clears sdk_conversation_id on the old session', () => {
  it('drops sdk_conversation_id before marking compacted', async () => {
    const db = makeDb();
    const old = chatStore.createSession(db, { ownerId: 'o1', gameId: 'ptg' });
    chatStore.setSdkConversationId(db, old.id, 'conv_pre_compact');

    // Seed one user + one assistant turn so summariserFn has content
    chatStore.appendTurn(db, {
      sessionId: old.id,
      turnIndex: 0,
      role: 'user',
      userText: 'hello',
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
    chatStore.appendTurn(db, {
      sessionId: old.id,
      turnIndex: 1,
      role: 'assistant',
      assistantText: 'hi',
      startedAt: Date.now(),
      endedAt: Date.now(),
    });

    const result = await compactSession({
      sessionId: old.id,
      db,
      summariserFn: async () => 'short summary text',
    });

    // Old session now compacted and id cleared
    const oldAfter = chatStore.getSession(db, old.id);
    expect(oldAfter?.status).toBe('compacted');
    expect(oldAfter?.sdk_conversation_id ?? null).toBeNull();

    // Result carries the SSE event payload
    expect(result.contextCompactedEvent.oldSessionId).toBe(old.id);
    expect(result.contextCompactedEvent.newSessionId).toBe(result.newSessionId);
    expect(result.contextCompactedEvent.summaryLength).toBe('short summary text'.length);
    expect(result.contextCompactedEvent.artifactCount).toBe(0);

    // New session has no id yet — next turn captures one
    const newSession = chatStore.getSession(db, result.newSessionId);
    expect(newSession?.sdk_conversation_id ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// claude-runner capture path (mocked SDK)
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mockTool(name: string, description: string, _schema: unknown, handler: any) {
    return { name, description, inputSchema: {}, handler, annotations: {}, _meta: undefined };
  }
  async function* mockQuery() {
    // First message exposes session_id — runner should capture it.
    yield {
      type: 'system',
      session_id: 'conv_sdk_abcdef',
    };
    // Then a benign result to close the turn.
    yield {
      type: 'result',
      result: 'ok',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  }
  return {
    query: vi.fn(() => mockQuery()),
    createSdkMcpServer: vi.fn(() => ({
      type: 'sdk',
      name: 'test',
      instance: new EventEmitter(),
    })),
    tool: vi.fn(mockTool),
  };
});

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'k',
    anthropicBaseUrl: 'https://t',
    chatModel: 'claude-test',
    anthropicPromptCacheEnabled: true,
    chatQueryPreset: 'standard',
    chatContextSdkResumeEnabled: true,
  },
  isLangfuseEnabled: () => false,
}));

describe('claude-runner — captures SDK session id', () => {
  it('emits sdk_session_captured for the first message that exposes one', async () => {
    const { run } = await import('../src/core/claude-runner.js');
    const events = [];
    for await (const ev of run({
      sessionId: 's1',
      turnId: 't1',
      systemPrompt: 'sys',
      allowedToolNames: [],
      message: 'hi',
      tools: [],
      toolContext: {
        ownerId: 'o',
        gameId: 'g',
        cubeToken: 'tok',
    workspace: 'local',
        sessionId: 's1',
        turnId: 't1',
        sseEmitter: new EventEmitter(),
      },
    })) {
      events.push(ev);
    }
    const captured = events.find((e) => e.type === 'sdk_session_captured');
    expect(captured).toBeDefined();
    if (captured && captured.type === 'sdk_session_captured') {
      expect(captured.data.sdkConversationId).toBe('conv_sdk_abcdef');
    }
  });
});
