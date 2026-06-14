/**
 * In-process Claude Agent SDK runtime for the Optimization Advisor.
 *
 * One session == one investigation (multi-turn). The session pins the
 * subscription OAuth lane (clean spawn env), enforces hard caps, and streams
 * normalized RuntimeEvents per turn. No real tools are wired yet — only a
 * trivial echo tool proves the loop end-to-end; the deterministic engine tools
 * attach in the next phase.
 *
 * Two distinct stop levels:
 *   - interruptTurn(): aborts the IN-FLIGHT turn (timeout / client disconnect)
 *     via the Query's interrupt(); the session stays open and resumable.
 *   - abort(): closes the whole session (eviction / explicit) via the
 *     generator's return() and closes the input queue.
 */

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { AsyncInputQueue } from './agent-input-queue.js';
import { buildAgentEnv } from './agent-oauth-env.js';
import { buildBaseSystemPrompt } from './agent-system-prompt.js';
import { resolveCaps, makeCanUseTool, type ToolDecision } from './agent-guardrails.js';
import { normalizeSdkMessage } from './agent-event-normalizer.js';
import { guardInbound } from './agent-inbound-guard.js';
import { writeTurnAudit, type AuditLogger } from './agent-audit-log.js';
import type { RuntimeEvent, SessionOpts, AgentMode, AgentStopReason, AgentErrorCode } from './agent-types.js';

const SERVER_NAME = 'advisor';
const ECHO_TOOL = 'echo';
/** The deny-by-default allowlist for this phase — only the echo health tool. */
export const ECHO_ALLOWLIST = [`mcp__${SERVER_NAME}__${ECHO_TOOL}`];

const echoTool = tool(
  ECHO_TOOL,
  'Health-check only: echoes the given text back. Do not use for analysis.',
  { text: z.string().describe('text to echo back') },
  async (args: { text: string }) => ({ content: [{ type: 'text' as const, text: `echo: ${args.text}` }] }),
);

const echoServer = createSdkMcpServer({ name: SERVER_NAME, version: '0.1.0', tools: [echoTool] });

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
  deps?: { queryFn?: AgentQueryFn },
): AdvisorAgentSession {
  const caps = resolveCaps(opts.caps);
  const env = buildAgentEnv(); // throws OAuthTokenMissingError if absent
  const systemPrompt = buildBaseSystemPrompt(opts.scope, opts.goal);
  const inputQueue = new AsyncInputQueue<SdkUserMessage>();

  let q: AgentQuery | null = null;
  let closed = false;
  let turnAbortCause: string | undefined;
  let sessionAbortCause: string | undefined;

  function startQuery(): AgentQuery {
    const options = {
      systemPrompt,
      model: opts.model ?? process.env.ADVISOR_AGENT_MODEL,
      env,
      mcpServers: { [SERVER_NAME]: echoServer },
      allowedTools: ECHO_ALLOWLIST,
      tools: [] as string[], // no built-in filesystem/Bash tools
      canUseTool: makeCanUseTool(ECHO_ALLOWLIST) as unknown as (
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
      const toolCalls: string[] = [];
      let stopReason: AgentStopReason = 'end_turn';
      let sawResult = false;
      let emittedError = false;

      const timer = setTimeout(() => session.interruptTurn('timeout'), caps.timeoutMs);

      try {
        if (!q) q = startQuery();

        const guarded = guardInbound(message);
        inputQueue.push({ type: 'user', message: { role: 'user', content: guarded.text }, parent_tool_use_id: null });

        while (true) {
          const { value, done } = await q.next();
          if (done) break;
          const raw = value as Record<string, unknown>;
          for (const ev of normalizeSdkMessage(raw)) {
            if (ev.type === 'tool_call') toolCalls.push(ev.tool);
            if ((ev.type === 'cost' || ev.type === 'done') && typeof ev.usd === 'number') {
              session.totalCostUsd = ev.usd;
            }
            if (ev.type === 'error') emittedError = true;
            if (ev.type === 'done') stopReason = ev.stopReason;
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
          if (!emittedError) yield { type: 'error', code, message: `agent turn ended (${cause ?? 'no result'})` };
          yield { type: 'done', usd: session.totalCostUsd || null, stopReason };
        }
      } catch (err) {
        stopReason = 'error';
        if (!emittedError) {
          yield { type: 'error', code: 'sdk_error', message: err instanceof Error ? err.message : String(err) };
        }
        yield { type: 'done', usd: session.totalCostUsd || null, stopReason };
      } finally {
        clearTimeout(timer);
        session.busy = false;
        session.lastActiveAt = Date.now();
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
            endedAt: Date.now(),
            abortCause: turnAbortCause ?? sessionAbortCause,
          },
          logger,
        );
      }
    },
  };

  return session;
}
