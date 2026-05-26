/**
 * Auto-compact logic: when a session's cumulative token usage crosses 80% of
 * the configured budget, a summary of recent turns is created, a new session
 * is started with that summary as a system preamble, and the old session is
 * marked as compacted.
 */

import type Database from 'better-sqlite3';
import * as chatStore from '../db/chat-store.js';
import type { ChatSessionRow, ChatTurnRow } from '../types.js';

// How many recent turns to include in the compaction summary
const COMPACT_TURNS_WINDOW = 20;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface CompactDecision {
  shouldCompact: boolean;
  reason?: string;
}

/**
 * Determine whether a session should be compacted based on its token usage
 * relative to the configured context budget.
 */
export function shouldCompact(session: ChatSessionRow, budgetTokens: number): CompactDecision {
  const total = (session.total_input_tokens ?? 0) + (session.total_output_tokens ?? 0);
  if (total > 0.8 * budgetTokens) {
    return {
      shouldCompact: true,
      reason: `Session used ${total}/${budgetTokens} tokens (>80%)`,
    };
  }
  return { shouldCompact: false };
}

// ---------------------------------------------------------------------------
// Compact
// ---------------------------------------------------------------------------

export interface CompactOpts {
  sessionId: string;
  db: Database.Database;
  /** Injected summariser so tests can mock the LLM call. */
  summariserFn: (turns: ChatTurnRow[]) => Promise<string>;
}

export interface CompactResult {
  newSessionId: string;
  summary: string;
  /** Phase-01: emit context_compacted SSE event with this payload. */
  contextCompactedEvent: {
    oldSessionId: string;
    newSessionId: string;
    tokensSaved: number;
    artifactCount: number;
    summaryLength: number;
  };
}

/**
 * Compact a session:
 * 1. Read the last COMPACT_TURNS_WINDOW turns.
 * 2. Summarise them via the injected summariserFn.
 * 3. Create a new session linked to the old one.
 * 4. Insert a system_preamble turn in the new session with the summary.
 * 5. Mark the old session as compacted.
 */
export async function compactSession(opts: CompactOpts): Promise<CompactResult> {
  const { sessionId, db, summariserFn } = opts;

  const oldSession = chatStore.getSession(db, sessionId);
  if (!oldSession) throw new Error(`Session not found: ${sessionId}`);

  const recentTurns = chatStore.listTurnsRecent(db, sessionId, COMPACT_TURNS_WINDOW);
  const summary = await summariserFn(recentTurns);

  const newSession = chatStore.createSessionWithParent(db, {
    ownerId: oldSession.owner_id,
    gameId: oldSession.game_id,
    title: oldSession.title ?? undefined,
    parentSessionId: sessionId,
  });

  // Insert the summary as the first turn in the new session
  chatStore.appendTurn(db, {
    sessionId: newSession.id,
    turnIndex: 0,
    role: 'system_preamble',
    assistantText: summary,
    startedAt: Date.now(),
    endedAt: Date.now(),
  });

  // Phase-01: drop the SDK conversation id on the old session before marking
  // it compacted. The new session starts a fresh SDK thread; the summary
  // preamble carries forward goal + artifacts + resolved slots (layer B in
  // phase 02) so the model still has continuity.
  chatStore.clearSdkConversationId(db, sessionId);

  chatStore.markSessionCompacted(db, sessionId, newSession.id);

  // Best-effort artifact count from recent turns — counts artifacts_json rows
  // with non-empty payloads. Used for the context_compacted SSE event so the
  // FE can render "compacted N artifacts forward".
  let artifactCount = 0;
  for (const t of recentTurns) {
    if (t.artifacts_json && t.artifacts_json !== '[]' && t.artifacts_json !== 'null') {
      artifactCount += 1;
    }
  }

  const tokensSaved =
    (oldSession.total_input_tokens ?? 0) + (oldSession.total_output_tokens ?? 0);

  return {
    newSessionId: newSession.id,
    summary,
    contextCompactedEvent: {
      oldSessionId: sessionId,
      newSessionId: newSession.id,
      tokensSaved,
      artifactCount,
      summaryLength: summary.length,
    },
  };
}
