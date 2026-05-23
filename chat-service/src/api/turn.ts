/**
 * POST /agent/turn — main SSE streaming endpoint.
 *
 * Flow:
 *   1. Validate body + required headers.
 *   2. Acquire per-session mutex (409 if held).
 *   3. Create session row if session_id is null; emit session_created event.
 *   4. Set SSE response headers, hijack reply.
 *   5. Emit loading event.
 *   6. Compose system prompt and run claudeRunner.
 *   7. Forward each SseEvent to the wire; capture query_artifact events from
 *      sseEmitter to persist with the turn and write to stream.
 *   8. On result: persist turn, release mutex, emit done, end stream.
 *   9. On error: write error event, persist audit, release mutex, end stream.
 */

import type { FastifyPluginAsync } from 'fastify';
import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';
import * as sessionManager from '../core/session-manager.js';
import { routeIntent } from '../core/intent-router.js';
import { compose } from '../core/mode-prompts.js';
import * as claudeRunner from '../core/claude-runner.js';
import { buildSdkTools } from '../tools/registry.js';
import { writeSseEvent } from '../core/sse-stream.js';
import type { SseEvent, QueryArtifact, ToolContext } from '../types.js';

interface TurnRouteOptions {
  db: Database.Database;
}

const TurnBodySchema = z.object({
  session_id: z.string().nullable().optional(),
  owner_id: z.string().min(1),
  game: z.string().min(1),
  message: z.string().min(1),
  context: z
    .object({
      page: z.string().optional(),
      selected_blocks: z.array(z.unknown()).optional(),
    })
    .optional(),
});

const turnRoutes: FastifyPluginAsync<TurnRouteOptions> = async (fastify, opts) => {
  fastify.post('/agent/turn', async (req, reply) => {
    // --- 1. Parse and validate body ---
    const parseResult = TurnBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.flatten() });
    }
    const body = parseResult.data;

    // Required headers
    const cubeToken = req.headers['x-cube-token'];
    const cubeGame = req.headers['x-cube-game'];
    const ownerIdHeader = req.headers['x-owner-id'];

    if (!cubeToken || typeof cubeToken !== 'string') {
      return reply.status(400).send({ error: 'Missing X-Cube-Token header' });
    }
    if (!cubeGame || typeof cubeGame !== 'string' || cubeGame !== body.game) {
      return reply.status(400).send({ error: 'X-Cube-Game header must match body.game' });
    }
    if (!ownerIdHeader || typeof ownerIdHeader !== 'string' || ownerIdHeader !== body.owner_id) {
      return reply.status(400).send({ error: 'X-Owner-Id header must match body.owner_id' });
    }

    // --- 2. Resolve / validate session ---
    let sessionId = body.session_id ?? null;
    if (sessionId) {
      const existing = chatStore.getSession(opts.db, sessionId);
      if (!existing) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (existing.owner_id !== body.owner_id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    // --- 3. Acquire mutex (409 if already locked) ---
    let release: (() => void) | null = null;
    try {
      if (sessionId) {
        release = await sessionManager.tryAcquire(sessionId);
      }
      // If sessionId is null, acquire after session is created below
    } catch (err) {
      if (err instanceof sessionManager.TurnInProgressError) {
        return reply.status(409).send({
          code: 'turn_in_progress',
          retry_after_ms: err.retryAfterMs,
        });
      }
      throw err;
    }

    // --- 4. Set SSE headers and hijack ---
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.hijack();

    const stream = reply.raw;

    // Helper: write an SSE event and flush
    function emit(event: SseEvent): void {
      writeSseEvent(stream, event);
    }

    // --- 5. Create session if needed ---
    if (!sessionId) {
      const session = chatStore.createSession(opts.db, {
        ownerId: body.owner_id,
        gameId: body.game,
        title: body.message.slice(0, 64),
      });
      sessionId = session.id;

      // Acquire mutex for the newly created session
      try {
        release = await sessionManager.tryAcquire(sessionId);
      } catch (err) {
        if (err instanceof sessionManager.TurnInProgressError) {
          stream.write(`event: error\ndata: ${JSON.stringify({ code: 'turn_in_progress', message: err.message })}\n\n`);
          stream.end();
          return;
        }
        throw err;
      }

      emit({ type: 'session_created', data: { id: sessionId } });
    }

    const startedAt = Date.now();

    // Persist the user turn immediately
    const existingTurns = chatStore.listTurns(opts.db, sessionId);
    const userTurnIndex = existingTurns.length;
    chatStore.appendTurn(opts.db, {
      sessionId,
      turnIndex: userTurnIndex,
      role: 'user',
      userText: body.message,
      startedAt,
      endedAt: startedAt,
    });

    // --- 6. Compose system prompt ---
    const intent = routeIntent(body.message);
    const systemPrompt = compose({
      skill: intent.skill,
      game: body.game,
      contextPreamble: body.context ? JSON.stringify(body.context) : undefined,
    });

    // SSE emitter for tool side-effects (query_artifact events)
    const sseEmitter = new EventEmitter();
    const collectedArtifacts: QueryArtifact[] = [];
    sseEmitter.on('query_artifact', (artifact: QueryArtifact) => {
      collectedArtifacts.push(artifact);
      emit({ type: 'query_artifact', data: artifact });
    });

    const turnId = sessionId + ':' + (userTurnIndex + 1);
    const toolContext: ToolContext = {
      ownerId: body.owner_id,
      gameId: body.game,
      cubeToken,
      sessionId,
      turnId,
      sseEmitter,
    };

    const tools = buildSdkTools(toolContext);

    // --- 7. Stream loading → run agent ---
    emit({ type: 'loading', data: {} });

    let assistantText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | undefined;

    try {
      for await (const event of claudeRunner.run({
        sessionId,
        systemPrompt,
        message: body.message,
        tools,
        toolContext,
      })) {
        // Accumulate result metadata; other events are forwarded directly
        if (event.type === 'result') {
          assistantText = event.data.text;
          inputTokens = event.data.input_tokens ?? 0;
          outputTokens = event.data.output_tokens ?? 0;
          costUsd = event.data.cost_usd;
        }
        // query_artifact is already emitted by the tool handler via sseEmitter
        if (event.type !== 'query_artifact') {
          emit(event);
        }
      }

      // --- 8. Persist assistant turn ---
      const endedAt = Date.now();
      const assistantTurnIndex = userTurnIndex + 1;
      chatStore.appendTurn(opts.db, {
        sessionId,
        turnIndex: assistantTurnIndex,
        role: 'assistant',
        assistantText,
        artifacts: collectedArtifacts,
        inputTokens,
        outputTokens,
        costUsd,
        skill: intent.skill,
        startedAt,
        endedAt,
      });

      chatStore.incrementTurnCount(opts.db, sessionId, inputTokens, outputTokens);

      emit({ type: 'done', data: {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', data: { code: 'agent_error', message } });

      // Persist error in audit log
      chatStore.insertAudit(opts.db, {
        sessionId,
        turnId,
        kind: 'error',
        detail: { message, stack: err instanceof Error ? err.stack : undefined },
      });
    } finally {
      if (release) release();
      stream.end();
    }
  });
};

export default turnRoutes;
