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
import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  balanceErrorTextOf,
  isFailureResultMessage,
  anthropicAuthEnvFor,
} from '../../core/anthropic-key-failover.js';
import { proxyEnvForChild } from '../../core/claude-runner.js';
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
          // One-shot LLM call via the Anthropic SDK; no tools needed. Uses the
          // failover-aware active key; on a balance failure, mark the key
          // exhausted so the next caller rotates — no retry here, the title
          // pass is fire-and-forget.
          const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');
          // titleModel is haiku — gateway-unservable on a sonnet-only key, so
          // pass it to route this call to the OAuth lane.
          const activeKey = getActiveAnthropicKey(config.titleModel);
          let result = '';
          for await (const msg of sdkQuery({
            prompt,
            options: {
              model: config.titleModel,
              env: {
                // Org egress proxy for the network-isolated prod runner — without
                // it the child's gateway call hangs and the title pass silently dies.
                ...proxyEnvForChild(),
                HOME: process.env['HOME'] ?? '/tmp',
                // Gateway key or subscription OAuth token, per the active slot.
                ...anthropicAuthEnvFor(activeKey),
              },
              permissionMode: 'dontAsk',
              disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
            },
          })) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const m = msg as any;
            // Canonical detector (handles the gateway subtype:'success'+is_error
            // balance shape). On any failure return empty so the raw error string
            // is never written as the session title.
            if (balanceErrorTextOf(m)) {
              reportKeyBalanceExhausted(activeKey.key, config.titleModel);
              return ''; // empty title → caller skips the update
            }
            if (m.type === 'result') {
              if (isFailureResultMessage(m)) return '';
              result = m.result ?? '';
            }
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
