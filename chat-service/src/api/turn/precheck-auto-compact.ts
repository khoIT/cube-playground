/**
 * Pre-stream auto-compact check. Runs BEFORE SSE headers are sent so any
 * failure surfaces as JSON, not a half-open stream.
 *
 * If the session has spent >80% of the context budget, compact it: summarise
 * older turns into a new session, alias the old session id on the stream
 * registry (so clients holding the pre-compact id still find the active turn),
 * and return the new session id plus the events to emit once the stream opens.
 * Compaction failure is non-fatal — the original session id is returned.
 */

import type Database from 'better-sqlite3';
import * as chatStore from '../../db/chat-store.js';
import { shouldCompact, compactSession } from '../../core/compact-service.js';
import { config } from '../../config.js';
import { getStreamRegistry } from '../../core/stream-registry-instance.js';

export interface ContextCompactedEvent {
  oldSessionId: string;
  newSessionId: string;
  tokensSaved: number;
  artifactCount: number;
  summaryLength: number;
}

export interface AutoCompactResult {
  /** Possibly-swapped session id — the new id when compaction ran, else unchanged. */
  sessionId: string | null;
  pendingCompactWarning: { from: string; to: string; summary: string } | null;
  pendingContextCompactedEvent: ContextCompactedEvent | null;
}

interface Args {
  db: Database.Database;
  sessionId: string | null;
  logger: { error: (obj: unknown, msg?: string) => void };
}

export async function precheckAutoCompact(args: Args): Promise<AutoCompactResult> {
  const { db, sessionId, logger } = args;
  const result: AutoCompactResult = {
    sessionId,
    pendingCompactWarning: null,
    pendingContextCompactedEvent: null,
  };
  if (!sessionId) return result;

  const sessionForCompact = chatStore.getSession(db, sessionId);
  if (!sessionForCompact) return result;

  const decision = shouldCompact(sessionForCompact, config.contextBudgetTokens);
  if (!decision.shouldCompact) return result;

  try {
    const compacted = await compactSession({
      sessionId,
      db,
      summariserFn: async (turns) => {
        // Plain-text compaction summary without calling the LLM (the real call
        // uses claudeRunner for one-shot prompts; injected here for testability).
        const lines = turns
          .filter((t) => t.role !== 'system_preamble')
          .slice(-10)
          .map((t) => {
            if (t.role === 'user') return `User: ${t.user_text ?? ''}`;
            return `Assistant: ${(t.assistant_text ?? '').slice(0, 200)}`;
          });
        return `[Session summary]\n${lines.join('\n')}`;
      },
    });
    result.pendingCompactWarning = { from: sessionId, to: compacted.newSessionId, summary: compacted.summary };
    result.pendingContextCompactedEvent = compacted.contextCompactedEvent;
    // Alias the pre-compact id so clients holding it still resolve the active turn.
    getStreamRegistry().aliasSession(sessionId, compacted.newSessionId);
    result.sessionId = compacted.newSessionId;
  } catch (compactErr) {
    logger.error({ err: compactErr }, 'Auto-compact failed; continuing with original session');
  }
  return result;
}
