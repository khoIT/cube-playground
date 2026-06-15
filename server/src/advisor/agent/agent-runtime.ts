/**
 * In-process Claude Agent SDK runtime for the Optimization Advisor.
 *
 * One session == one investigation (multi-turn). The session pins the
 * subscription OAuth lane (clean spawn env), enforces hard caps, and streams
 * normalized RuntimeEvents per turn. The deterministic advisor engines are
 * wired in as session-scoped SDK tools (they close over this session's
 * WorkspaceCtx, asOf anchor, and provenance ledger); the tool gate is
 * deny-by-default and allows only those tool names.
 *
 * Two distinct stop levels:
 *   - interruptTurn(): aborts the IN-FLIGHT turn (timeout / client disconnect)
 *     via the Query's interrupt(); the session stays open and resumable.
 *   - abort(): closes the whole session (eviction / explicit) via the
 *     generator's return() and closes the input queue.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { AsyncInputQueue } from './agent-input-queue.js';
import { buildAgentEnv, resolveAuthLane } from './agent-oauth-env.js';
import { scanToolOutputForError } from './tool-output-error-scan.js';
import { buildBaseSystemPrompt } from './agent-system-prompt.js';
import { buildContextPack } from './agent-context-pack.js';
import { resolveCaps, makeCanUseTool, type ToolDecision } from './agent-guardrails.js';
import { normalizeSdkMessage } from './agent-event-normalizer.js';
import { guardInbound } from './agent-inbound-guard.js';
import { writeTurnAudit, type AuditLogger } from './agent-audit-log.js';
import { sqliteRunRecorder, type RunRecorder } from './run-recorder.js';
import type { ToolCallInput, EventInput } from './advisor-run-store.js';
import { ProvenanceLedger } from './agent-provenance-gate.js';
import { buildAdvisorToolServer, ADVISOR_SERVER_NAME, ADVISOR_TOOL_ALLOWLIST } from './tools/index.js';
import type { ToolContext } from './tools/tool-context.js';
import type { RuntimeEvent, SessionOpts, AgentMode, AgentStopReason, AgentErrorCode, TokenUsage } from './agent-types.js';

/** Query object as the runtime uses it: an async generator that can interrupt. */
type AgentQuery = AsyncGenerator<unknown> & { interrupt?: () => Promise<void> };
/** Injection seam so tests can drive the loop with a stubbed query. */
export type AgentQueryFn = (args: {
  prompt: AsyncIterable<unknown>;
  options: Record<string, unknown>;
}) => AgentQuery;

export interface AdvisorAgentSession {
  readonly id: string;
  readonly opts: SessionOpts;
  turnIndex: number;
  totalCostUsd: number;
  busy: boolean;
  createdAt: number;
  lastActiveAt: number;
  runTurn(message: string, mode: AgentMode): AsyncGenerator<RuntimeEvent>;
  /** Abort the in-flight turn but keep the session resumable. */
  interruptTurn(cause?: string): void;
  /** Close the whole session (not resumable). */
  abort(cause?: string): void;
  isClosed(): boolean;
}

type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null };

export function createAdvisorAgentSession(
  id: string,
  opts: SessionOpts,
  logger?: AuditLogger,
  deps?: { queryFn?: AgentQueryFn; recorder?: RunRecorder },
): AdvisorAgentSession {
  const caps = resolveCaps(opts.caps);
  // Durable run-audit recorder. Defaults to SQLite; tests inject a fake/no-op.
  // It never throws (errors are swallowed in the recorder) so it can't break a turn.
  const recorder: RunRecorder = deps?.recorder ?? sqliteRunRecorder;
  const model = opts.model ?? process.env.ADVISOR_AGENT_MODEL;
  const env = buildAgentEnv(); // throws OAuthTokenMissingError if absent
  // Credential lane the agent runs on (always subscription OAuth) — recorded per
  // run so a $0.00 cost reads as "subscription flat-rate", not "free".
  const authLane = resolveAuthLane();
  // The model the SDK actually used (from result/assistant messages), and the
  // run's cumulative token usage — both filled in as turns stream. `model` above
  // is the *configured* override (often undefined); actualModel wins when known.
  let actualModel: string | undefined;
  let cumInputTokens = 0;
  let cumOutputTokens = 0;
  let cumCacheReadTokens = 0;
  let cumCacheCreationTokens = 0;
  // Anchor every time-based computation to session-creation time (the I/O
  // boundary) so a multi-turn investigation stays internally consistent.
  const asOf = new Date();
  const ledger = new ProvenanceLedger();
  const toolContext: ToolContext = {
    sessionId: id,
    scope: opts.scope,
    goal: opts.goal,
    ctx: opts.ctx,
    asOf,
    ledger,
  };
  const toolServer = buildAdvisorToolServer(toolContext);
  const systemPrompt = `${buildBaseSystemPrompt(opts.scope, opts.goal)}\n\n${buildContextPack(opts.scope)}`;
  const inputQueue = new AsyncInputQueue<SdkUserMessage>();

  let q: AgentQuery | null = null;
  let closed = false;
  let turnAbortCause: string | undefined;
  let sessionAbortCause: string | undefined;

  function startQuery(): AgentQuery {
    const options = {
      systemPrompt,
      model,
      env,
      mcpServers: { [ADVISOR_SERVER_NAME]: toolServer },
      allowedTools: ADVISOR_TOOL_ALLOWLIST,
      tools: [] as string[], // belt-and-suspenders; the real gate is canUseTool below
      // Deny-by-default: this is what actually blocks built-in filesystem/Bash
      // tools and anything outside the advisor surface — not the line above.
      canUseTool: makeCanUseTool(ADVISOR_TOOL_ALLOWLIST) as unknown as (
        t: string,
        i: Record<string, unknown>,
      ) => Promise<ToolDecision>,
      permissionMode: 'default' as const,
      maxTurns: caps.maxTurns,
      maxBudgetUsd: caps.maxBudgetUsd,
    };
    if (deps?.queryFn) {
      return deps.queryFn({ prompt: inputQueue, options: options as unknown as Record<string, unknown> });
    }
    return query({ prompt: inputQueue as AsyncIterable<SdkUserMessage>, options }) as unknown as AgentQuery;
  }

  const session: AdvisorAgentSession = {
    id,
    opts,
    turnIndex: 0,
    totalCostUsd: 0,
    busy: false,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    isClosed: () => closed,
    interruptTurn(cause?: string) {
      turnAbortCause = cause ?? 'aborted';
      void q?.interrupt?.();
    },
    abort(cause?: string) {
      sessionAbortCause = cause ?? 'aborted';
      closed = true;
      inputQueue.close();
      void q?.return?.(undefined as never);
    },
    async *runTurn(message: string, mode: AgentMode): AsyncGenerator<RuntimeEvent> {
      if (closed) {
        yield { type: 'error', code: 'aborted', message: 'session is closed' };
        yield { type: 'done', usd: session.totalCostUsd || null, stopReason: 'aborted' };
        return;
      }
      session.busy = true;
      session.turnIndex += 1;
      turnAbortCause = undefined; // fresh per turn
      const startedAt = Date.now();
      const costBefore = session.totalCostUsd;
      const toolCalls: string[] = [];
      let stopReason: AgentStopReason = 'end_turn';
      let sawResult = false;
      let emittedError = false;
      // Token usage for THIS turn, captured from the SDK result's `done` event.
      let turnUsage: TokenUsage | undefined;

      // ── Run-audit buffer (Phase: durable per-turn trace) ──────────────────
      // Pair tool_call→tool_result by callId for duration/state/error; buffer
      // every normalized event for SSE replay; accumulate assistant narration.
      type OpenCall = { callId?: string; tool: string; seq: number; startedAt: number; inputJson?: string };
      const openCalls: OpenCall[] = [];
      const recordedToolCalls: ToolCallInput[] = [];
      const recordedEvents: EventInput[] = [];
      let narration = '';
      let seq = 0;
      let eventIndex = 0;
      const safeJson = (v: unknown): string | undefined => {
        if (v === undefined) return undefined;
        try {
          return JSON.stringify(v);
        } catch {
          return undefined;
        }
      };
      const bufferEvent = (ev: RuntimeEvent): void => {
        recordedEvents.push({
          turnIndex: session.turnIndex,
          eventIndex: eventIndex++,
          eventType: ev.type,
          eventJson: safeJson(ev) ?? '{}',
          ts: Date.now(),
        });
        switch (ev.type) {
          case 'assistant_delta':
            narration += ev.text;
            break;
          case 'tool_call':
            openCalls.push({ callId: ev.callId, tool: ev.tool, seq: seq++, startedAt: Date.now(), inputJson: safeJson(ev.input) });
            break;
          case 'tool_result': {
            const endedAt = Date.now();
            const idx = ev.callId ? openCalls.findIndex((c) => c.callId === ev.callId) : openCalls.length ? 0 : -1;
            const open = idx >= 0 ? openCalls.splice(idx, 1)[0] : undefined;
            // A clean (ok) tool can still carry an upstream failure folded into
            // its payload (e.g. a Cube 400 inside a diagnose lens). Flag it so the
            // semantic failure isn't hidden behind the ok state.
            const embedded = ev.ok ? scanToolOutputForError(ev.resultText) : null;
            recordedToolCalls.push({
              callId: ev.callId ?? open?.callId,
              tool: open?.tool ?? ev.tool,
              seq: open?.seq ?? seq++,
              inputJson: open?.inputJson,
              outputDigest: ev.resultText,
              state: ev.ok ? 'ok' : 'failed',
              errorMessage: ev.ok ? undefined : ev.resultText,
              startedAt: open?.startedAt,
              endedAt,
              durationMs: open ? endedAt - open.startedAt : undefined,
              embeddedError: embedded != null,
              embeddedErrorMessage: embedded ?? undefined,
            });
            break;
          }
          case 'denied':
            // Forward-compat handler for the 'denied' RuntimeEvent. Today the
            // SDK surfaces canUseTool denials as a tool_result with is_error
            // (recorded as 'failed' above), so this branch only fires if a
            // future normalizer emits an explicit 'denied' event.
            recordedToolCalls.push({ tool: ev.tool, seq: seq++, state: 'denied', errorMessage: ev.reason });
            break;
          default:
            break;
        }
      };

      const timer = setTimeout(() => session.interruptTurn('timeout'), caps.timeoutMs);

      try {
        if (!q) q = startQuery();

        const guarded = guardInbound(message);
        inputQueue.push({ type: 'user', message: { role: 'user', content: guarded.text }, parent_tool_use_id: null });

        while (true) {
          const { value, done } = await q.next();
          if (done) break;
          const raw = value as Record<string, unknown>;
          // Capture the model the SDK actually used (carried on assistant
          // messages) — the configured `model` is usually undefined.
          if (raw.type === 'assistant' && !actualModel) {
            const m = (raw.message as { model?: string } | undefined)?.model;
            if (typeof m === 'string' && m) actualModel = m;
          }
          for (const ev of normalizeSdkMessage(raw)) {
            if (ev.type === 'tool_call') toolCalls.push(ev.tool);
            if ((ev.type === 'cost' || ev.type === 'done') && typeof ev.usd === 'number') {
              session.totalCostUsd = ev.usd;
            }
            if (ev.type === 'error') emittedError = true;
            if (ev.type === 'done') {
              stopReason = ev.stopReason;
              if (ev.usage) turnUsage = ev.usage;
              if (ev.model && !actualModel) actualModel = ev.model;
            }
            bufferEvent(ev);
            yield ev;
          }
          if (raw.type === 'result') {
            sawResult = true;
            break; // turn complete; query stays open for the next turn
          }
          if (turnAbortCause) break; // interrupted mid-turn
        }

        // Budget exhaustion closes the session (no point continuing).
        if (session.totalCostUsd >= caps.maxBudgetUsd) {
          closed = true;
          sessionAbortCause = sessionAbortCause ?? 'budget';
        }

        // No SDK result == interrupted turn (timeout/disconnect) or query ended.
        if (!sawResult) {
          const cause = turnAbortCause ?? sessionAbortCause;
          const code: AgentErrorCode =
            cause === 'timeout' ? 'timeout' : cause === 'budget' ? 'budget_exceeded' : cause ? 'aborted' : 'sdk_error';
          stopReason =
            code === 'timeout' ? 'timeout' : code === 'budget_exceeded' ? 'budget' : code === 'aborted' ? 'aborted' : 'error';
          if (!emittedError) {
            const errEv: RuntimeEvent = { type: 'error', code, message: `agent turn ended (${cause ?? 'no result'})` };
            bufferEvent(errEv);
            yield errEv;
          }
          const doneEv: RuntimeEvent = { type: 'done', usd: session.totalCostUsd || null, stopReason };
          bufferEvent(doneEv);
          yield doneEv;
        }
      } catch (err) {
        stopReason = 'error';
        if (!emittedError) {
          const errEv: RuntimeEvent = { type: 'error', code: 'sdk_error', message: err instanceof Error ? err.message : String(err) };
          bufferEvent(errEv);
          yield errEv;
        }
        const doneEv: RuntimeEvent = { type: 'done', usd: session.totalCostUsd || null, stopReason };
        bufferEvent(doneEv);
        yield doneEv;
      } finally {
        clearTimeout(timer);
        session.busy = false;
        const endedAt = Date.now();
        session.lastActiveAt = endedAt;
        const abortCause = turnAbortCause ?? sessionAbortCause;
        writeTurnAudit(
          {
            sessionId: id,
            turnIndex: session.turnIndex,
            scope: opts.scope,
            goal: opts.goal,
            mode,
            owner: opts.owner,
            toolCalls,
            stopReason,
            totalCostUsd: session.totalCostUsd,
            startedAt,
            endedAt,
            abortCause,
          },
          logger,
        );

        // Durable audit trail. Any tool call still open at turn end (e.g. a
        // cube_query interrupted by the timeout) is recorded as failed with its
        // elapsed duration, so the failure that stopped the turn is visible.
        // Fully guarded: persistence must never break a turn or change its SSE.
        try {
          for (const open of openCalls) {
            recordedToolCalls.push({
              callId: open.callId,
              tool: open.tool,
              seq: open.seq,
              inputJson: open.inputJson,
              state: 'failed',
              errorMessage: `interrupted (${abortCause ?? stopReason})`,
              startedAt: open.startedAt,
              endedAt,
              durationMs: endedAt - open.startedAt,
            });
          }
          // Roll this turn's token usage into the run-level cumulative totals.
          cumInputTokens += turnUsage?.inputTokens ?? 0;
          cumOutputTokens += turnUsage?.outputTokens ?? 0;
          cumCacheReadTokens += turnUsage?.cacheReadTokens ?? 0;
          cumCacheCreationTokens += turnUsage?.cacheCreationTokens ?? 0;
          recorder.flushTurn({
            run: {
              sessionId: id,
              gameId: opts.scope.gameId,
              segmentId: opts.scope.kind === 'segment' ? opts.scope.segmentId : undefined,
              scopeKind: opts.scope.kind,
              goal: opts.goal,
              mode,
              owner: opts.owner,
              model: actualModel ?? model,
              turnCount: session.turnIndex,
              totalCostUsd: session.totalCostUsd,
              finalStopReason: stopReason,
              hadError: stopReason !== 'end_turn',
              createdAt: session.createdAt,
              lastActiveAt: endedAt,
              authLane: authLane.lane,
              authSource: authLane.source ?? undefined,
              inputTokens: cumInputTokens,
              outputTokens: cumOutputTokens,
              cacheReadTokens: cumCacheReadTokens,
              cacheCreationTokens: cumCacheCreationTokens,
            },
            turn: {
              sessionId: id,
              turnIndex: session.turnIndex,
              mode,
              message,
              narration: narration || undefined,
              toolCallCount: recordedToolCalls.length,
              stopReason,
              abortCause,
              costUsd: Math.max(0, session.totalCostUsd - costBefore),
              startedAt,
              endedAt,
              durationMs: endedAt - startedAt,
              inputTokens: turnUsage?.inputTokens,
              outputTokens: turnUsage?.outputTokens,
              cacheReadTokens: turnUsage?.cacheReadTokens,
              cacheCreationTokens: turnUsage?.cacheCreationTokens,
            },
            toolCalls: recordedToolCalls,
            events: recordedEvents,
          });
        } catch {
          /* recorder is already guarded; this is belt-and-suspenders */
        }
      }
    },
  };

  return session;
}
