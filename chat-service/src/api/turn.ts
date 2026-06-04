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
import { classifyLlmError } from '../core/llm-error-classifier.js';
import { config } from '../config.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';
import { RegistryOverflowError } from '../core/stream-registry.js';
import type { SseEvent, QueryArtifact, ChartArtifact, ToolContext } from '../types.js';
import { diffRecordings } from '../observability/parallel-emit-shim.js';
import { appendParallelEmitDiff } from '../observability/parallel-emit-log.js';
import { createTurnTimer } from '../observability/turn-timing.js';
import { buildTurnObserver } from './turn/build-observer.js';
import { maybeSummariseTitle } from './turn/maybe-summarise-title.js';
import { writeSessionFocus } from './turn/write-session-focus.js';
import { precheckAutoCompact } from './turn/precheck-auto-compact.js';
import { maybeWriteResponseCache } from '../cache/response-cache-write.js';
import { tryResponseCacheHit } from './turn/try-response-cache-hit.js';
import { getFocus, type SessionFocus } from '../cache/session-focus-adapter.js';

interface TurnRouteOptions {
  db: Database.Database;
}

const TurnBodySchema = z.object({
  session_id: z.string().nullable().optional(),
  owner_id: z.string().min(1),
  // Display name for the owner, stamped on a newly-created session for
  // "shared by …" UI. Optional — legacy callers omit it.
  owner_label: z.string().optional(),
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

    // X-Cube-Workspace partitions sessions by the active Cube data backend.
    // Default 'local' so legacy turn requests without the header keep working
    // against the existing local-only session bucket.
    const wsRaw = req.headers['x-cube-workspace'];
    const workspace =
      typeof wsRaw === 'string' && wsRaw.trim() ? wsRaw.trim() : 'local';

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
    const compactResult = await precheckAutoCompact({
      db: opts.db,
      sessionId,
      logger: fastify.log,
    });
    sessionId = compactResult.sessionId;
    const pendingCompactWarning = compactResult.pendingCompactWarning;
    const pendingContextCompactedEvent = compactResult.pendingContextCompactedEvent;

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
    // Per-turn stage timer — no-op cost unless CHAT_TURN_PROFILING is set.
    // Verifies where turn latency goes (compose / meta / cache / LLM / persist).
    const timer = createTurnTimer(turnId);

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
        workspace,
        ownerLabel: body.owner_label ?? null,
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

    // Phase 04 — create an AbortController per turn. Stored on the registry
    // entry so the cancel endpoint + timeout timer can signal it.
    // NOTE: timeout is armed further below (after compose()) so phase-06
    // research-mode doubling can read the skill meta before the timer starts.
    const controller = new AbortController();

    // Register the turn with the stream registry now that sessionId is final.
    try {
      registry.register(turnId, sessionId, controller);
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
    // Phase-01: emit context_compacted alongside the legacy warning so the FE
    // can render a structured compaction indicator (artifact count, tokens
    // saved) without parsing the warning text.
    if (pendingContextCompactedEvent) {
      emit({ type: 'context_compacted', data: pendingContextCompactedEvent });
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
    // Phase 02 — read the session-focus snapshot left by the previous
    // assistant turn so compose() can inject a `## Conversation focus` block.
    // The adapter no-ops when the flag is off; passing `undefined` here keeps
    // the system prompt identical to phase-01 behaviour.
    const priorFocus: SessionFocus | undefined = config.chatContextFocusStoreEnabled
      ? getFocus(opts.db, sessionId)
      : undefined;

    const { systemPrompt, allowedToolNames, skillMeta } = compose({
      skill: intent.skill,
      game: body.game,
      contextPreamble: body.context ? JSON.stringify(body.context) : undefined,
      focus: priorFocus,
    });
    timer.mark('compose');

    // Phase 06 — resolve per-turn web search and research mode flags independently.
    // Each header gates only its own feature; env master flags remain the kill-switch.
    // X-Web-Search: 1  → webSearchEnabled only (web search tool, does not affect timeout).
    // X-Research-Mode: 1 → researchModeEnabled only (timeout doubling, does not enable web search).
    const webSearchOverride = req.headers['x-web-search'] === '1';
    const researchOverride = req.headers['x-research-mode'] === '1';
    const webSearchEnabled =
      config.chatEnableWebSearch && (webSearchOverride || skillMeta?.enableWebSearch || false);
    const researchModeEnabled =
      config.chatEnableResearchMode && (researchOverride || skillMeta?.enableResearchMode || false);

    // Phase 04/06 — arm the per-turn timeout now that skill meta is resolved.
    // Research mode doubles the budget; 0 disables the timeout entirely.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (config.chatTurnTimeoutMs > 0) {
      const effectiveTimeoutMs = researchModeEnabled
        ? config.chatTurnTimeoutMs * 2
        : config.chatTurnTimeoutMs;
      timeoutHandle = setTimeout(() => {
        registry.abort(turnId, 'timeout');
      }, effectiveTimeoutMs);
    }

    // --- 6b. Response-cache lookup (exact-match, per-game) ---
    // Gate: RESPONSE_CACHE_ENABLED=true AND X-Bypass-Cache header not set to '1'.
    const bypassCache = req.headers['x-bypass-cache'] === '1';
    // Resolve model: X-Model header if allowlisted, else server default.
    const resolvedModel = resolveModel(req.headers['x-model']);
    const cacheLookup = await tryResponseCacheHit({
      db: opts.db,
      enabled: config.responseCacheEnabled,
      bypassCache,
      gameId: body.game,
      workspace,
      userText: body.message,
      skill: intent.skill,
      systemPrompt,
      resolvedModel,
      turnId,
      sessionId,
      userTurnIndex,
      startedAt,
      emit,
      stream,
      timer,
      registry,
      release,
      logger: fastify.log,
    });
    if (cacheLookup.hit) return;
    // Carried into the live-LLM path: key + meta hash to write the cache after
    // the turn completes (null when the cache is disabled or lookup failed).
    const cacheKey = cacheLookup.cacheKey;
    const resolvedCubeMetaHash = cacheLookup.resolvedCubeMetaHash;

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
    let clarifyEmitted = false;
    sseEmitter.on('disambig_options', (data: Extract<SseEvent, { type: 'disambig_options' }>['data']) => {
      clarifyEmitted = true;
      emit({ type: 'disambig_options', data });
    });

    const toolContext: ToolContext = {
      ownerId: body.owner_id,
      gameId: body.game,
      cubeToken,
      workspace,
      sessionId,
      turnId,
      sseEmitter,
      db: opts.db,
      disambiguationMode: body.mode ?? 'targeted',
    };

    const tools = buildSdkTools(toolContext);

    // --- 7. Stream loading → run agent ---
    emit({ type: 'loading', data: {} });

    let assistantText = '';
    let reasoningText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | undefined;
    // Set when the runner surfaces an LLM/gateway failure as a result-subtype
    // error (vs a thrown error caught below). Routes the turn through the same
    // error finalization path so it's classified, audited, and persisted as an
    // error turn instead of an empty "successful" answer.
    let resultError: string | null = null;
    // Phase-02: turn-level stop_reason from SDK result message.
    let stopReason: string | undefined;
    // Phase-03: cache token breakdown from SDK result usage block.
    let cacheCreationTokens: number | undefined;
    let cacheReadTokens: number | undefined;
    // Phase-01: SDK resume id flow.
    //   - resumeId: id we hand to the SDK on this turn (null when flag off
    //     or session has none yet)
    //   - capturedSdkConversationId: id the SDK reveals during this turn
    //     (always captured when present so phases 02+/UI can read it; only
    //     persisted on the session row when the flag is on)
    let resumeId: string | undefined;
    let capturedSdkConversationId: string | undefined;
    if (config.chatContextSdkResumeEnabled && sessionId) {
      const sessionForResume = chatStore.getSession(opts.db, sessionId);
      if (sessionForResume?.sdk_conversation_id) {
        resumeId = sessionForResume.sdk_conversation_id;
        // Truncate id for debug visibility — full id never crosses to FE.
        const priorTurnCount = sessionForResume.turn_count ?? 0;
        emit({
          type: 'context_resumed',
          data: {
            sdkConversationId: resumeId.slice(0, 8),
            priorTurnCount,
          },
        });
      }
    }

    // Observability: build the observer stack. Construction failures degrade
    // to a no-op bundle (logged) so a turn whose SSE headers are already sent
    // never crashes on a bad observer config.
    const {
      observer,
      tracer,
      bufferedRecorder,
      parallelLegacyRecorder,
      parallelShadowSink,
      shadowTracer,
    } = buildTurnObserver({
      db: opts.db,
      turnId,
      sessionId,
      ownerId: body.owner_id,
      skill: intent.skill,
      logger: fastify.log,
    });

    try {
      let sawFirstEvent = false;
      for await (const event of claudeRunner.run({
        sessionId,
        turnId,
        systemPrompt,
        allowedToolNames,
        message: body.message,
        tools,
        toolContext,
        observer,
        tracer: shadowTracer,
        resumeId,
        signal: controller.signal,
        webSearchEnabled,
      })) {
        if (!sawFirstEvent) {
          sawFirstEvent = true;
          timer.mark('llm-first-event');
        }
        // LLM/gateway failure surfaced as a result-subtype error (sse-stream
        // maps it to `error`). Capture the raw text and stop consuming — the
        // post-loop error path classifies, audits, and persists it.
        if (event.type === 'error') {
          resultError = event.data.message;
          break;
        }
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
        // Phase-01: SDK exposed the conversation id; capture for post-turn
        // persistence. Do NOT forward to FE — id is server-internal.
        if (event.type === 'sdk_session_captured') {
          capturedSdkConversationId = event.data.sdkConversationId;
          continue;
        }
        // Capture the assistant's chain-of-thought so the FE can render it as a
        // collapsible Reasoning toggle on the persisted turn (not just live).
        if (event.type === 'thinking') {
          reasoningText += event.data.delta;
        }
        // query_artifact and chart are already emitted via sseEmitter
        if (event.type !== 'query_artifact' && event.type !== 'chart') {
          emit(event);
        }
      }

      // A result-subtype LLM error short-circuits the success path: throw so the
      // catch below classifies, audits, and persists it as an error turn (one
      // error-handling path for both thrown and result-surfaced failures).
      if (resultError) {
        throw new Error(resultError);
      }

      // Phase-05 parallel-emit shim: the runner has consumed every message and
      // called shadowTracer.finalize(). Diff the legacy dispatch against the
      // shadow tracer and append one record to the soak log. Best-effort —
      // a diff failure must never affect the user-facing turn.
      if (parallelLegacyRecorder && parallelShadowSink) {
        try {
          const diff = diffRecordings(parallelLegacyRecorder.events, parallelShadowSink.events);
          appendParallelEmitDiff({
            ts: Date.now(),
            turnId,
            sessionId: sessionId ?? '',
            message: body.message.slice(0, 120),
            match: diff.match,
            legacyCount: diff.legacyCount,
            shadowCount: diff.shadowCount,
            kindCounts: diff.kindCounts,
            maxLatencyDeltaMs: diff.maxLatencyDeltaMs,
            mismatchCount: diff.mismatches.length,
            mismatchSample: diff.mismatches.slice(0, 5),
          });
        } catch (diffErr) {
          fastify.log.warn({ err: diffErr }, '[turn] parallel-emit diff failed');
        }
      }

      // Phase-01: persist captured SDK conversation id so the next turn can
      // resume the same thread. Only writes when the flag is on — capture
      // happens regardless so we have telemetry on what the SDK exposes.
      if (
        config.chatContextSdkResumeEnabled &&
        sessionId &&
        capturedSdkConversationId
      ) {
        try {
          chatStore.setSdkConversationId(
            opts.db,
            sessionId,
            capturedSdkConversationId,
          );
        } catch (sdkErr) {
          fastify.log.warn(
            { err: sdkErr },
            '[turn] failed to persist sdk_conversation_id',
          );
        }
      }

      // --- 8. Persist assistant turn ---
      timer.mark('llm-done');
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
        reasoningJson: reasoningText || undefined,
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

      // Snapshot resolved disambig slots + skill + last artifact id into the
      // session focus bag and broadcast it on the open stream.
      writeSessionFocus({
        db: opts.db,
        sessionId,
        ownerId: body.owner_id,
        skill: intent.skill,
        collectedArtifacts,
        logger: fastify.log,
      });

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
            clarifyEmitted,
          });
        } catch (writeErr) {
          fastify.log.warn({ err: writeErr }, '[turn] cache write failed (non-fatal)');
        }
      }

      chatStore.incrementTurnCount(opts.db, sessionId, inputTokens, outputTokens);

      // Fire-and-forget title summariser after the 3rd assistant turn.
      // Called after incrementTurnCount so turn_count is current.
      maybeSummariseTitle({
        db: opts.db,
        sessionId,
        autoPrefix: body.message.slice(0, 64),
        logger: fastify.log,
      });

      // Phase 04 — if the controller was aborted during the runner loop,
      // emit `turn_aborted` so the FE can render the right state. Reason
      // is read from the registry entry (set by the cancel route / timeout
      // timer). Always followed by `done` to close the SSE stream cleanly.
      if (controller.signal.aborted) {
        const entry = registry.get(turnId);
        emit({
          type: 'turn_aborted',
          data: {
            reason: entry?.abortReason ?? 'server_error',
            message: typeof controller.signal.reason === 'string'
              ? controller.signal.reason
              : undefined,
          },
        });
      }

      emit({ type: 'done', data: {} });
      timer.mark('persist');
      timer.flush(fastify.log, 'finish');
      registry.finish(turnId, 'done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Classify into an actionable category so the FE banner can tell the user
      // where to fix (VPN / key / connectivity) and the audit row is triageable.
      const classified = classifyLlmError({ message });
      emit({
        type: 'error',
        data: {
          code: classified.code,
          message,
          title: classified.title,
          hint: classified.hint,
        },
      });
      timer.flush(fastify.log, 'error');
      registry.finish(turnId, 'error');

      // Persist error in audit log — include the classification so the DevAudit
      // triage view surfaces the category + fix hint alongside the raw cause.
      chatStore.insertAudit(opts.db, {
        sessionId,
        turnId,
        kind: 'error',
        detail: {
          message,
          code: classified.code,
          title: classified.title,
          hint: classified.hint,
          retriable: classified.retriable,
          stack: err instanceof Error ? err.stack : undefined,
        },
      });
      fastify.log.error(
        { turnId, sessionId, errorCode: classified.code, message },
        `[turn] ${classified.code}: ${classified.title}`,
      );

      // Persist a visible assistant turn so the failure survives a reload.
      // stop_reason='error' tags the row so listTurnsRecent excludes it from
      // the agent's context on retry (otherwise the next turn sees "I failed"
      // and may apologise instead of re-answering).
      try {
        const endedAt = Date.now();
        chatStore.appendTurn(opts.db, {
          id: turnId,
          sessionId,
          turnIndex: userTurnIndex + 1,
          role: 'assistant',
          assistantText: message,
          stopReason: 'error',
          model: resolvedModel ?? config.chatModel,
          skill: intent.skill,
          startedAt,
          endedAt,
        });
      } catch (persistErr) {
        fastify.log.warn(
          { err: persistErr, turnId, sessionId },
          '[turn] failed to persist assistant error turn (audit row still written)',
        );
      }
    } finally {
      // Phase 04 — cancel the timeout timer if the turn finishes naturally.
      // Otherwise it would fire after the SSE stream closed and try to abort
      // a finished turn (registry.abort is a no-op on finished turns, but
      // the unowned timer is a leak).
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      // Fire-and-forget Langfuse flush — must not delay SSE close or throw.
      // The Langfuse SDK queues internally; a missed flush is bounded loss.
      if (tracer) {
        void tracer.flush().catch((err) => fastify.log.warn({ err }, '[turn] langfuse flush failed'));
      }
      if (release) release();
      stream.end();
    }
  });

  // ---------------------------------------------------------------------
  // Phase 04 — cancel a running turn.
  //
  // POST /agent/turn/:turnId/cancel
  //   → 202 with { aborted: true } when the turn was running and abort
  //     was signalled
  //   → 410 Gone when the turn isn't running (race: cancel arrived after
  //     natural completion or for an unknown turnId)
  //
  // The cancel does NOT touch sdk_conversation_id (phase 01) or focus
  // (phase 02) — cancel ≠ session end. Owner check is performed via the
  // X-Owner-Id header so a client cannot cancel another user's turn.
  // ---------------------------------------------------------------------
  fastify.post<{ Params: { turnId: string } }>(
    '/agent/turn/:turnId/cancel',
    async (req, reply) => {
      const registry = getStreamRegistry();
      const entry = registry.get(req.params.turnId);
      if (!entry || entry.status !== 'running') {
        return reply.status(410).send({ aborted: false, code: 'not_running' });
      }
      // Owner check: look up the session row and compare with the calling
      // owner. Headers + Fastify request shape match the POST /agent/turn
      // contract; missing owner header → 401.
      const ownerHeader = req.headers['x-owner-id'];
      const ownerId = typeof ownerHeader === 'string' ? ownerHeader : null;
      if (!ownerId) return reply.status(401).send({ error: 'X-Owner-Id required' });
      const session = chatStore.getSession(opts.db, entry.sessionId);
      if (!session) {
        return reply.status(410).send({ aborted: false, code: 'session_missing' });
      }
      if (session.owner_id !== ownerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const aborted = registry.abort(req.params.turnId, 'user_cancel');
      return reply.status(202).send({ aborted });
    },
  );
};

export default turnRoutes;
