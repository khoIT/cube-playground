/**
 * Fire-and-forget session-title summariser, triggered once a session reaches
 * its third assistant turn while still carrying the auto-generated title.
 *
 * Extracted from the turn handler: it runs in a queueMicrotask after the turn
 * is persisted and must never delay or fail the SSE response. A one-shot
 * Anthropic SDK call (no tools) produces the title; failures are logged only.
 */

import type Database from 'better-sqlite3';
import * as chatStore from '../../db/chat-store.js';
import { config } from '../../config.js';
import { summariseTitle } from '../../core/title-summariser.js';

interface Args {
  db: Database.Database;
  sessionId: string;
  /** The auto-title (first 64 chars of the user message) used to detect an
   *  untouched session whose title is still safe to overwrite. */
  autoPrefix: string;
  logger: { warn: (obj: unknown, msg?: string) => void };
}

/**
 * Schedule a title summary if (and only if) this is the 3rd assistant turn and
 * the title is still the auto-prefix or null. No-op otherwise.
 *
 * Must be called AFTER incrementTurnCount so turn_count is current.
 */
export function maybeSummariseTitle(args: Args): void {
  const { db, sessionId, autoPrefix, logger } = args;
  const sessionAfterTurn = chatStore.getSession(db, sessionId);
  if (
    !sessionAfterTurn ||
    sessionAfterTurn.turn_count !== 3 ||
    (sessionAfterTurn.title !== null && sessionAfterTurn.title !== autoPrefix)
  ) {
    return;
  }

  const allTurns = chatStore.listTurns(db, sessionId);
  queueMicrotask(() => {
    summariseTitle({
      turns: allTurns,
      deps: {
        callLlm: async (prompt) => {
          // One-shot LLM call via the Anthropic SDK; no tools needed.
          const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
          let result = '';
          for await (const msg of sdkQuery({
            prompt,
            options: {
              model: config.titleModel,
              env: {
                HOME: process.env['HOME'] ?? '/tmp',
                ANTHROPIC_API_KEY: config.anthropicApiKey,
                ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
              },
              permissionMode: 'dontAsk',
              disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
            },
          })) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const m = msg as any;
            if (m.type === 'result') result = m.result ?? '';
          }
          return result;
        },
      },
    })
      .then((title) => {
        if (title) chatStore.updateSessionTitle(db, sessionId, title);
      })
      .catch((err) => {
        logger.warn({ err }, 'Title summariser failed');
      });
  });
}
