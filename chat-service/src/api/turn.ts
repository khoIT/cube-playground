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
import { getModelDigestText } from '../core/model-graph-digest.js';
import { readResolvedContext, renderResolvedContext } from '../core/resolved-context.js';
import { resolveRevenueDefault, renderSmartDefaults } from '../core/smart-defaults.js';
import { fetchOfficialGlossary } from '../nl-to-query/glossary-client.js';
import { resolveTurnLanguage } from '../core/turn-language.js';
import * as claudeRunner from '../core/claude-runner.js';
import { buildSdkTools } from '../tools/registry.js';
import { writeSseEvent } from '../core/sse-stream.js';
import { classifyLlmError } from '../core/llm-error-classifier.js';
import { config } from '../config.js';
import { getStreamRegistry } from '../core/stream-registry-instance.js';
import { RegistryOverflowError } from '../core/stream-registry.js';
import type { SseEvent, QueryArtifact, ChartArtifact, ToolContext } from '../types.js';
import type { SegmentProposal } from '../tools/propose-segment.js';
import { diffRecordings } from '../observability/parallel-emit-shim.js';
import { appendParallelEmitDiff } from '../observability/parallel-emit-log.js';
import { createTurnTimer } from '../observability/turn-timing.js';
import { buildTurnObserver } from './turn/build-observer.js';
import { maybeSummariseTitle } from './turn/maybe-summarise-title.js';
import { salvageTimeoutAnswer } from './turn/salvage-timeout-answer.js';
import { isHeavyAnalysisQuestion } from './turn/heavy-question-timeout.js';
import { writeSessionFocus } from './turn/write-session-focus.js';
import { precheckAutoCompact } from './turn/precheck-auto-compact.js';
import { maybeWriteResponseCache } from '../cache/response-cache-write.js';
import { tryResponseCacheHit } from './turn/try-response-cache-hit.js';
import { getFocus, type SessionFocus } from '../cache/session-focus-adapter.js';

interface TurnRouteOptions {
  db: Database.Database;
}

// Heartbeat cadence while a turn streams. Comfortably shorter than the client's
// stall watchdog so a healthy turn always lands ≥2 pings before it would trip.
const PING_INTERVAL_MS = 20_000;

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

    // Tool-call start times, keyed by tool_use id, so tool_result can report
    // real wall-clock latency. The SDK user-message carrying tool_result has no
    // timing, so sse-stream emits ms:0; we pair it with the earlier tool_call
    // here to stamp the true duration on the live chip.
    const toolCallStartMs = new Map<string, number>();

    // Helper: write an SSE event, mirror into the registry's ring buffer.
    function emit(event: SseEvent): void {
      let outEvent = event;
      if (event.type === 'tool_call') {
        toolCallStartMs.set(event.data.id, Date.now());
      } else if (event.type === 'tool_result' && event.data.ms === 0) {
        const startedMs = toolCallStartMs.get(event.data.id);
        if (startedMs !== undefined) {
          outEvent = { ...event, data: { ...event.data, ms: Date.now() - startedMs } };
        }
      }
      registry.append(turnId, outEvent);
      writeSseEvent(stream, outEvent);
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

    // Reply-language guardrail: detect from the current message, falling back
    // to the session's earlier user turns when ambiguous (default: English).
    // `existingTurns` was read BEFORE the current user turn was appended, so
    // it contains exactly the prior history.
    const turnLanguage = resolveTurnLanguage(
      body.message,
      existingTurns
        .filter((t) => t.role === 'user' && typeof t.user_text === 'string')
        .map((t) => t.user_text as string),
    );

    // Model-graph digest — compact per-game join map injected into the
    // cacheable prompt prefix. Resolver memoises on the meta-version hash and
    // returns '' on any failure, so this never blocks or slows a turn beyond a
    // cold /meta fetch. `undefined` when the flag is off keeps the prompt
    // byte-identical to pre-digest behaviour.
    const modelDigest = config.agentModelDigestEnabled
      ? await getModelDigestText(body.game, workspace)
      : undefined;

    // Resolved-context block — what the session has already pinned, read from
    // the same disambiguation memory the engine writes. `undefined` when the
    // flag is off keeps the prompt byte-identical to pre-P2 behaviour.
    const resolvedContext = config.agentResolvedContextEnabled
      ? renderResolvedContext(readResolvedContext(opts.db, sessionId))
      : undefined;

    // Smart-default guidance — resolves the game's Revenue measure from the
    // (in-memory cached) glossary. Tolerates a glossary fetch failure: the
    // resolver just sees [] and renders metric as ask-first.
    let smartDefaults: string | undefined;
    if (config.agentSmartDefaultsEnabled) {
      const glossary = await fetchOfficialGlossary().catch(() => []);
      smartDefaults = renderSmartDefaults(resolveRevenueDefault(glossary));
    }

    // Asking posture bound to the disambiguation toggle. Default to aggressive
    // (auto-answer) when the flag is on and the client sent no explicit mode —
    // the engine's own default (targeted) is unchanged for default-off users.
    const agentPosture = config.agentModeGovernsPosture
      ? (body.mode ?? 'aggressive')
      : undefined;

    const { systemPrompt, allowedToolNames, skillMeta } = compose({
      skill: intent.skill,
      game: body.game,
      contextPreamble: body.context ? JSON.stringify(body.context) : undefined,
      focus: priorFocus,
      language: turnLanguage,
      modelDigest,
      resolvedContext,
      smartDefaults,
      agentPosture,
      engineRouting: config.agentEngineRouting,
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
    // Research mode doubles the budget; funnel/journey-class questions get the
    // same doubling (they fan out into many sequential cube queries and were
    // routinely killed mid-analysis). 0 disables the timeout entirely.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    // Liveness heartbeat handle — armed once the live-LLM stream starts, cleared
    // in the finally before the stream closes (writing to a closed stream throws).
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    const effectiveTimeoutMs =
      researchModeEnabled || isHeavyAnalysisQuestion(body.message)
        ? config.chatTurnTimeoutMs * 2
        : config.chatTurnTimeoutMs;
    if (config.chatTurnTimeoutMs > 0) {
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
    const collectedProposals: SegmentProposal[] = [];
    sseEmitter.on('query_artifact', (artifact: QueryArtifact) => {
      collectedArtifacts.push(artifact);
      emit({ type: 'query_artifact', data: artifact });
    });
    sseEmitter.on('chart', (chart: ChartArtifact) => {
      collectedCharts.push(chart);
      emit({ type: 'chart', data: chart });
    });
    // Segment proposals are forwarded live AND persisted on the turn row so the
    // card re-renders when the session reloads. The segment itself is still only
    // created on FE confirm (POST /api/segments) — chat proposes, FE writes.
    sseEmitter.on('segment_proposal', (data: Extract<SseEvent, { type: 'segment_proposal' }>['data']) => {
      collectedProposals.push(data as SegmentProposal);
      emit({ type: 'segment_proposal', data });
    });
    // Action proposals are forwarded live. The write (care case / sweep /
    // experiment) still happens only on explicit FE confirm — chat proposes,
    // the user confirms.
    sseEmitter.on('action_proposal', (data: Extract<SseEvent, { type: 'action_proposal' }>['data']) => {
      emit({ type: 'action_proposal', data });
    });
    let clarifyEmitted = false;
    // Last disambig_options frame the turn emitted, kept so it can be persisted
    // on the assistant row and re-rendered as choice chips when the session
    // reloads (otherwise the chips are live-only and vanish on refresh).
    let lastDisambig: Extract<SseEvent, { type: 'disambig_options' }>['data'] | null = null;
    sseEmitter.on('disambig_options', (data: Extract<SseEvent, { type: 'disambig_options' }>['data']) => {
      clarifyEmitted = true;
      lastDisambig = data;
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
    // Auth lane ('primary'|'stg'|'backup'|'subscription') the runner used —
    // last attempt wins; persisted to chat_turns.llm_auth_label.
    let llmAuthLabel: string | undefined;
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
      // Heartbeat: a periodic ping keeps proxy hops from idle-closing the SSE
      // connection and lets the client's stall watchdog distinguish a slow-but-
      // alive turn from a dead socket (no pings → watchdog trips → reconnect).
      // Fans out to replay listeners via the registry, so refreshed clients get
      // it too. Cleared in the finally before stream.end().
      pingTimer = setInterval(() => emit({ type: 'ping', data: {} }), PING_INTERVAL_MS);

      let sawFirstEvent = false;
      for await (const event of claudeRunner.run({
        sessionId,
        turnId,
        systemPrompt,
        allowedToolNames,
        message: body.message,
        model: resolvedModel,
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
        // Server-internal auth-lane marker from the runner — persist, never
        // forward to FE. A key-failover retry emits a fresh one (last wins).
        if (event.type === 'auth_lane_used') {
          llmAuthLabel = event.data.label;
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

      // Timeout abort with no answer text: the model did real work (reasoning
      // + tool calls) but the budget expired before it composed an answer.
      // Salvage one bounded, tool-less LLM pass over the reasoning transcript
      // so the user gets a best-effort answer instead of a blank aborted turn
      // (degrades to a deterministic notice). User cancels are NOT salvaged —
      // the user asked to stop.
      if (
        controller.signal.aborted &&
        registry.get(turnId)?.abortReason === 'timeout' &&
        !assistantText
      ) {
        assistantText = await salvageTimeoutAnswer({
          question: body.message,
          reasoningText,
          artifactCount: collectedArtifacts.length,
          timeoutMs: effectiveTimeoutMs,
          model: resolvedModel,
          logger: fastify.log,
        });
        // Surface the salvaged text on the live stream; the FE accumulates
        // token deltas into the message body, then turn_aborted (emitted
        // below) marks the turn as timed out — honestly — on top of it.
        emit({ type: 'token', data: { delta: assistantText } });
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

      // When the turn was aborted (timeout timer or user cancel), the SDK stream
      // ends WITHOUT a `result` message — so emitTurnFinalized never fires and
      // stop_reason would otherwise persist as NULL, hiding the abort as a
      // pre-phase-02 "legacy" row in the leaderboard. Stamp the abort reason
      // here so timeouts/cancels are visible and scored honestly.
      const abortStopReason = controller.signal.aborted
        ? registry.get(turnId)?.abortReason ?? 'server_error'
        : undefined;

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
        proposals: collectedProposals,
        inputTokens,
        outputTokens,
        costUsd,
        // Phase-03: cache token breakdown (undefined when SDK omits them).
        cacheCreationTokens,
        cacheReadTokens,
        // On a clean (non-abort) finish this stays undefined and the buffered
        // recorder's onTurnFinalized flush writes the real SDK stop_reason.
        stopReason: abortStopReason,
        skill: intent.skill,
        systemPromptText: systemPrompt,
        model: resolvedModel,
        llmAuthLabel,
        disambigJson: lastDisambig ? JSON.stringify(lastDisambig) : undefined,
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

      // Asking-behaviour telemetry — proves the disambiguation toggle changes
      // what the agent does (mode → did it clarify?). Gated by the profiling
      // flag so it adds nothing when off; consumed by the agent-intelligence eval.
      if (config.chatTurnProfilingEnabled) {
        fastify.log.info(
          {
            turnId,
            mode: body.mode ?? 'targeted',
            agentPosture: agentPosture ?? null,
            askedClarification: clarifyEmitted,
            modelDigest: config.agentModelDigestEnabled,
            resolvedContext: config.agentResolvedContextEnabled,
            smartDefaults: config.agentSmartDefaultsEnabled,
          },
          '[turn] asking-behaviour',
        );
      }

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
          // Lane that failed (when the runner got far enough to announce one)
          // — keeps error turns attributable in the auth-lane breakdown.
          llmAuthLabel,
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
      // Stop the heartbeat before the stream closes — a ping written to a
      // closed stream would throw.
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
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
