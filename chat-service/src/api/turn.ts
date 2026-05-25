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
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as chatStore from '../db/chat-store.js';
import * as sessionManager from '../core/session-manager.js';
import { routeIntent } from '../core/intent-router.js';
import { compose } from '../core/mode-prompts.js';
import * as claudeRunner from '../core/claude-runner.js';
import { buildSdkTools } from '../tools/registry.js';
import { writeSseEvent } from '../core/sse-stream.js';
import { shouldCompact, compactSession } from '../core/compact-service.js';
import { summariseTitle } from '../core/title-summariser.js';
import { config, isLangfuseEnabled } from '../config.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';
import { RegistryOverflowError } from '../core/stream-registry.js';
import type { SseEvent, QueryArtifact, ChartArtifact, ToolContext } from '../types.js';
import { LlmTraceRecorder, BufferedLlmTraceRecorder } from '../observability/llm-trace-recorder.js';
import { LangfuseTracer } from '../observability/langfuse-tracer.js';
import { buildCompositeObserver } from '../observability/composite-observer.js';
import type { ObserverHooks } from '../observability/observer-types.js';
import { getMetaVersion } from '../core/cube-meta-cache.js';
import { computeCacheKey, hashSystemPrompt, normalize } from '../cache/response-cache-key.js';
import { getByKey, incrementHit } from '../db/response-cache-store.js';
import { replayCachedTurn } from '../cache/replay-cached-turn.js';
import { maybeWriteResponseCache } from '../cache/response-cache-write.js';

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
  mode: z.enum(['targeted', 'aggressive']).optional(),
});

/**
 * Resolve the model to use for a turn.
 * Honors the X-Model header when the value is in config.allowedModels;
 * unknown values silently fall back to config.chatModel — never echoed raw.
 */
function resolveModel(xModelHeader: string | string[] | undefined): string {
  const requested =
    typeof xModelHeader === 'string' ? xModelHeader.trim() : undefined;
  if (requested && config.allowedModels.includes(requested)) return requested;
  return config.chatModel;
}

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
      // Treat soft-deleted sessions as not found — mirrors sessions.ts:104 pattern.
      // Without this check a client retaining a deleted session_id can silently
      // resurrect it by posting turns (turns appended while deleted_at stays set).
      if (!existing || existing.deleted_at != null) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (existing.owner_id !== body.owner_id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }

    // --- 2b. Auto-compact pre-check (before SSE headers so errors are JSON) ---
    // If the session has used >80% of the context budget, compact it first.
    let pendingCompactWarning: { from: string; to: string; summary: string } | null = null;
    if (sessionId) {
      const sessionForCompact = chatStore.getSession(opts.db, sessionId);
      if (sessionForCompact) {
        const decision = shouldCompact(sessionForCompact, config.contextBudgetTokens);
        if (decision.shouldCompact) {
          try {
            const result = await compactSession({
              sessionId,
              db: opts.db,
              summariserFn: async (turns) => {
                // Build a plain-text compaction summary without calling the LLM in tests
                // (the real call uses claudeRunner for one-shot prompts; injected via
                // summariserFn for testability)
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
            pendingCompactWarning = { from: sessionId, to: result.newSessionId, summary: result.summary };
            // Compact-alias map: clients holding the pre-compact sessionId still
            // need to find the active turn after the swap (Q1).
            getStreamRegistry().aliasSession(sessionId, result.newSessionId);
            sessionId = result.newSessionId;
          } catch (compactErr) {
            // Compact failure is non-fatal — continue with the original session
            fastify.log.error({ err: compactErr }, 'Auto-compact failed; continuing with original session');
          }
        }
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

    // turnId — UUID v4 (unguessable; replaces the legacy sessionId:index).
    const turnId = randomUUID();
    const registry = getStreamRegistry();

    // Helper: write an SSE event, mirror into the registry's ring buffer.
    function emit(event: SseEvent): void {
      registry.append(turnId, event);
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

    // Register the turn with the stream registry now that sessionId is final.
    try {
      registry.register(turnId, sessionId);
    } catch (err) {
      if (err instanceof RegistryOverflowError) {
        stream.write(
          `event: error\ndata: ${JSON.stringify({ code: 'registry_full', message: err.message })}\n\n`,
        );
        stream.end();
        if (release) release();
        return;
      }
      throw err;
    }

    // Emit `turn_started` immediately so clients get a stable handle before
    // any token arrives.
    emit({ type: 'turn_started', data: { turnId } });

    // Emit compact_warning if auto-compact ran before the stream was opened
    if (pendingCompactWarning) {
      emit({ type: 'compact_warning', data: pendingCompactWarning });
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
    chatStore.insertAudit(opts.db, {
      sessionId,
      kind: 'intent_routed',
      detail: {
        skill: intent.skill,
        confidence: intent.confidence,
        autoRoute: intent.autoRoute,
        owner_id: body.owner_id,
      },
    });
    const { systemPrompt, allowedToolNames } = compose({
      skill: intent.skill,
      game: body.game,
      contextPreamble: body.context ? JSON.stringify(body.context) : undefined,
    });

    // --- 6b. Response-cache lookup (exact-match, per-game) ---
    // Gate: RESPONSE_CACHE_ENABLED=true AND X-Bypass-Cache header not set to '1'.
    const bypassCache = req.headers['x-bypass-cache'] === '1';
    // Resolve model: X-Model header if allowlisted, else server default.
    const resolvedModel = resolveModel(req.headers['x-model']);
    let cacheKey: string | null = null;
    // Hoisted so the cache-write path can persist cubeMetaHash on the response_cache row.
    let resolvedCubeMetaHash: string | null = null;
    if (config.responseCacheEnabled && !bypassCache) {
      try {
        const cubeMetaHash = await getMetaVersion(body.game, cubeToken);
        resolvedCubeMetaHash = cubeMetaHash;
        const systemPromptHash = hashSystemPrompt(systemPrompt);
        cacheKey = computeCacheKey({
          skill: intent.skill,
          gameId: body.game,
          userText: body.message,
          cubeMetaHash,
          model: resolvedModel,
          systemPromptHash,
        });
        const cached = getByKey(opts.db, cacheKey);
        if (cached) {
          // Cache hit — replay and persist a new turn row marked cache_hit=1.
          // Pass `emit` so replay events go through the stream-registry ring buffer,
          // enabling refresh-resume mid-replay (N1 fix). The emit closure also
          // ensures `loading` and token events appear in registry.findRunning() output.
          await replayCachedTurn(cached, stream, emit);
          incrementHit(opts.db, cacheKey);

          const hitAt = Date.now();
          const assistantIdx = userTurnIndex + 1;
          chatStore.appendTurn(opts.db, {
            id: turnId,
            sessionId,
            turnIndex: assistantIdx,
            role: 'assistant',
            assistantText: JSON.parse(cached.value_json).text ?? '',
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            cacheHit: 1,
            originalTurnId: cached.original_turn_id,
            skill: intent.skill,
            model: resolvedModel,
            // Cache hits are gated at write time on stop_reason='end_turn', so a
            // replayed turn represents a successful end_turn outcome. Set explicitly
            // because the observability stack is skipped on this path — without it
            // stop_reason stays NULL and leaderboard inflates legacyCount.
            stopReason: 'end_turn',
            startedAt,
            endedAt: hitAt,
          });
          chatStore.incrementTurnCount(opts.db, sessionId, 0, 0);

          emit({ type: 'done', data: {} });
          registry.finish(turnId, 'done');
          if (release) release();
          stream.end();
          return;
        }
      } catch (cacheErr) {
        // Cache lookup failure is non-fatal — fall through to live LLM call.
        fastify.log.warn({ err: cacheErr }, '[turn] cache lookup failed, falling through to LLM');
        cacheKey = null;
      }
    }

    // SSE emitter for tool side-effects (query_artifact + chart events)
    const sseEmitter = new EventEmitter();
    const collectedArtifacts: QueryArtifact[] = [];
    const collectedCharts: ChartArtifact[] = [];
    sseEmitter.on('query_artifact', (artifact: QueryArtifact) => {
      collectedArtifacts.push(artifact);
      emit({ type: 'query_artifact', data: artifact });
    });
    sseEmitter.on('chart', (chart: ChartArtifact) => {
      collectedCharts.push(chart);
      emit({ type: 'chart', data: chart });
    });

    const toolContext: ToolContext = {
      ownerId: body.owner_id,
      gameId: body.game,
      cubeToken,
      sessionId,
      turnId,
      sseEmitter,
      disambiguationMode: body.mode ?? 'targeted',
    };

    const tools = buildSdkTools(toolContext);

    // --- 7. Stream loading → run agent ---
    emit({ type: 'loading', data: {} });

    let assistantText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | undefined;
    // Phase-02: turn-level stop_reason from SDK result message.
    let stopReason: string | undefined;
    // Phase-03: cache token breakdown from SDK result usage block.
    let cacheCreationTokens: number | undefined;
    let cacheReadTokens: number | undefined;

    // Observability: construct observer inside the try block so a failing
    // constructor (bad config, missing dep) falls back to a no-op and never
    // crashes the turn before SSE headers are sent.
    let observer: ObserverHooks | undefined;
    let tracer: LangfuseTracer | undefined;
    let bufferedRecorder: BufferedLlmTraceRecorder | undefined;
    try {
      // Recorder writes go through a buffer: chat_turns FK rejects inserts for
      // the assistant turn until that row exists, and that INSERT happens
      // *after* the runner loop. Buffered events are flushed once appendTurn
      // has committed the assistant row below.
      bufferedRecorder = new BufferedLlmTraceRecorder(
        new LlmTraceRecorder({ db: opts.db, turnId }),
      );
      tracer = new LangfuseTracer({ turnId, sessionId, ownerId: body.owner_id, skill: intent.skill });
      observer = buildCompositeObserver([bufferedRecorder, tracer]);
      chatStore.insertAudit(opts.db, {
        sessionId,
        turnId,
        kind: 'observability',
        detail: { enabled_recorder: true, enabled_langfuse: isLangfuseEnabled(), owner_id: body.owner_id },
      });
    } catch (obsErr) {
      fastify.log.warn({ err: obsErr }, '[turn] observer construction failed — continuing without observability');
      observer = undefined;
      tracer = undefined;
    }

    try {
      for await (const event of claudeRunner.run({
        sessionId,
        turnId,
        systemPrompt,
        allowedToolNames,
        message: body.message,
        tools,
        toolContext,
        observer,
      })) {
        // Accumulate result metadata; other events are forwarded directly
        if (event.type === 'result') {
          assistantText = event.data.text;
          inputTokens = event.data.input_tokens ?? 0;
          outputTokens = event.data.output_tokens ?? 0;
          costUsd = event.data.cost_usd;
          // Phase-03: cache token breakdown (undefined when not present in SDK response).
          cacheCreationTokens = event.data.cache_creation_tokens;
          cacheReadTokens = event.data.cache_read_tokens;
        }
        // query_artifact and chart are already emitted via sseEmitter
        if (event.type !== 'query_artifact' && event.type !== 'chart') {
          emit(event);
        }
      }

      // --- 8. Persist assistant turn ---
      const endedAt = Date.now();
      const assistantTurnIndex = userTurnIndex + 1;

      // Finalize the Langfuse trace with aggregate token usage before persisting
      // the turn row (so the tracer has the full picture before flush).
      if (tracer) {
        tracer.finalize({ inputTokens, outputTokens, totalCostUsd: costUsd });
      }

      chatStore.appendTurn(opts.db, {
        // Use the SSE turnId as chat_turns.id so observability FKs (llm_calls,
        // tool_invocations, sdk_events) which were buffered against turnId
        // resolve to a real chat_turns row.
        id: turnId,
        sessionId,
        turnIndex: assistantTurnIndex,
        role: 'assistant',
        assistantText,
        artifacts: collectedArtifacts,
        charts: collectedCharts,
        inputTokens,
        outputTokens,
        costUsd,
        // Phase-03: cache token breakdown (undefined when SDK omits them).
        cacheCreationTokens,
        cacheReadTokens,
        skill: intent.skill,
        systemPromptText: systemPrompt,
        model: resolvedModel,
        startedAt,
        endedAt,
      });

      // chat_turns now has the assistant row → FK is satisfied; drain the
      // buffered observability events. Errors are swallowed by the inner
      // recorder's per-row try/catch so one bad row can't sink the rest.
      bufferedRecorder?.flush();

      // --- Phase-06: write response-cache entry on eligible turns ---
      // stop_reason is persisted by the buffered recorder's onTurnFinalized flush above.
      // Read it from the DB row (single cheap SELECT) to gate the cache write.
      if (cacheKey) {
        try {
          const turnRow = chatStore.getTurnById(opts.db, turnId);
          const persistedStopReason = turnRow?.stop_reason ?? undefined;
          maybeWriteResponseCache({
            db: opts.db,
            enabled: config.responseCacheEnabled,
            key: cacheKey,
            gameId: body.game,
            skill: intent.skill,
            model: resolvedModel,
            userText: body.message,
            assistantText,
            inputTokens,
            outputTokens,
            costUsd: costUsd ?? 0,
            stopReason: persistedStopReason,
            collectedArtifacts,
            collectedCharts,
            hadError: false,
            turnId,
            sessionId,
            cubeMetaHash: resolvedCubeMetaHash,
          });
        } catch (writeErr) {
          fastify.log.warn({ err: writeErr }, '[turn] cache write failed (non-fatal)');
        }
      }

      chatStore.incrementTurnCount(opts.db, sessionId, inputTokens, outputTokens);

      // Fire-and-forget title summariser after the 3rd assistant turn.
      // Reads the session state after incrementTurnCount so turn_count is current.
      const sessionAfterTurn = chatStore.getSession(opts.db, sessionId);
      const autoPrefix = body.message.slice(0, 64);
      if (
        sessionAfterTurn &&
        sessionAfterTurn.turn_count === 3 &&
        (sessionAfterTurn.title === null || sessionAfterTurn.title === autoPrefix)
      ) {
        const allTurns = chatStore.listTurns(opts.db, sessionId);
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
              if (title) chatStore.updateSessionTitle(opts.db, sessionId, title);
            })
            .catch((err) => {
              fastify.log.warn({ err }, 'Title summariser failed');
            });
        });
      }

      emit({ type: 'done', data: {} });
      registry.finish(turnId, 'done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', data: { code: 'agent_error', message } });
      registry.finish(turnId, 'error');

      // Persist error in audit log
      chatStore.insertAudit(opts.db, {
        sessionId,
        turnId,
        kind: 'error',
        detail: { message, stack: err instanceof Error ? err.stack : undefined },
      });
    } finally {
      // Fire-and-forget Langfuse flush — must not delay SSE close or throw.
      // The Langfuse SDK queues internally; a missed flush is bounded loss.
      if (tracer) {
        void tracer.flush().catch((err) => fastify.log.warn({ err }, '[turn] langfuse flush failed'));
      }
      if (release) release();
      stream.end();
    }
  });
};

export default turnRoutes;
