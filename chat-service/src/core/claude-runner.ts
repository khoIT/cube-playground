/**
 * Wraps @anthropic-ai/claude-agent-sdk query() to produce typed SseEvent streams.
 *
 * Key isolation: sets HOME to runtime/claude-home before invoking the SDK
 * subprocess so it doesn't inherit host ~/.claude/ settings or hooks.
 *
 * Tools are registered as an in-process MCP server via createSdkMcpServer().
 * The ToolContext (per-request) is injected into tool handlers via the closure
 * passed in buildSdkTools().
 */

import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from '../config.js';
import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  isBalanceExhaustedError,
  anthropicKeyCount,
} from './anthropic-key-failover.js';
import { mapSdkMessage } from './sse-stream.js';
import { buildQueryOptions } from './query-options-presets.js';
import type { SseEvent, ToolContext } from '../types.js';
import type { ObserverHooks } from '../observability/observer-types.js';
import type { TurnTracer } from '../observability/turn-tracer.js';
import {
  emitSdkEvent,
  emitLlmCall,
  emitToolInvocations,
  emitTurnFinalized,
  flushPendingTools,
  type PendingTool,
} from '../observability/sdk-event-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_HOME = resolve(__dirname, '../../runtime/claude-home');
const SETTINGS_PATH = resolve(CLAUDE_HOME, '.claude/settings.json');

// Seed an isolated Claude home on first use — disable all hooks, pre-approve our MCP tools.
let homeInitialised = false;
async function ensureClaudeHome(): Promise<void> {
  if (homeInitialised) return;
  await mkdir(resolve(CLAUDE_HOME, '.claude'), { recursive: true });
  if (!existsSync(SETTINGS_PATH)) {
    await writeFile(
      SETTINGS_PATH,
      JSON.stringify(
        {
          hooks: {},
          permissions: {
            allow: ['mcp__cube-playground-tools__*'],
          },
        },
        null,
        2,
      ),
    );
  }
  homeInitialised = true;
}

// Egress proxy vars to forward to the Claude Code subprocess. The LLM gateway
// (ANTHROPIC_BASE_URL) is a public host; on the network-isolated prod runner it
// is reachable only through the org HTTP proxy. The SDK passes our explicit env
// bag to the child verbatim (no process.env inheritance), so the proxy vars must
// be copied in by hand or the CLI's HTTPS call to the gateway hangs until the
// turn times out. Internal compose calls bypass the proxy via NO_PROXY (set on
// the container). Empty in local dev (direct connection) — the loop copies only
// vars that are actually set, so nothing is forced on.
function proxyEnvForChild(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['http_proxy', 'https_proxy', 'no_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) {
    const v = process.env[k];
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Extract balance-exhaustion error text from an SDK message, or null.
 *
 * Two shapes carry it (verified live against the LiteLLM gateway):
 *   - `result` message — NOTE the CLI reports this failure with
 *     `subtype: "success"` but `is_error: true, api_error_status: 400`, so the
 *     error flag (or a non-success subtype) is the discriminator, NOT subtype;
 *   - an `assistant` message the CLI emits FIRST (model `<synthetic>`), whose
 *     only content is the short error echo ("Credit balance is too low") —
 *     capped at 300 chars so a genuine long answer that merely mentions the
 *     phrase is never matched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function balanceErrorTextOf(msg: any): string | null {
  if (msg?.type === 'result') {
    const isError = msg.is_error === true || (msg.subtype && msg.subtype !== 'success');
    if (!isError) return null;
    const text = typeof msg.result === 'string' ? msg.result : '';
    return isBalanceExhaustedError(text) ? text : null;
  }
  if (msg?.type === 'assistant') {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    const text = blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b?.type === 'text')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text ?? '')
      .join('');
    return text.length > 0 && text.length <= 300 && isBalanceExhaustedError(text) ? text : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool definition shape accepted by this runner
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>; // Zod shape passed to sdkTool()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface RunParams {
  sessionId: string;
  /** The persisted turn id for this request — required for observer correlation. */
  turnId: string;
  systemPrompt: string;
  /** Tool names permitted for this turn (from skill frontmatter). Empty = allow all. */
  allowedToolNames: string[];
  message: string;
  tools: ToolDefinition[];
  toolContext: ToolContext;
  /**
   * Optional side-channel observer. Receives per-LLM-call, per-tool-invocation,
   * and raw SDK event signals WITHOUT affecting the yielded SseEvent stream.
   * All observer callbacks are try/catch guarded — a throwing observer cannot
   * break the turn for the user.
   */
  observer?: ObserverHooks;
  /**
   * Phase-05 parallel-emit shim: a shadow TurnTracer driven from the same
   * message stream as the legacy `observer` dispatch. When present, the runner
   * calls `tracer.onSdkMessage(msg)` for every message and `tracer.finalize()`
   * after the loop — mirroring the legacy emit* sites — so a soak can diff the
   * two paths. The shadow tracer only records; it never writes to the DB or
   * Langfuse. All calls are try/catch guarded — a throwing tracer can't break
   * the turn for the user.
   */
  tracer?: TurnTracer;
  /**
   * Phase-01: prior SDK conversation id to resume. When present, the SDK opens
   * the next turn with the full prior thread visible. Pass undefined to start
   * a fresh thread.
   */
  resumeId?: string;
  /**
   * Phase-04: abort signal. When the controller is aborted, the iterator
   * breaks and the runner yields no further events. Forwarded to the SDK via
   * buildQueryOptions().abortSignal — if the SDK honours it, the upstream
   * subprocess is killed; otherwise the defensive break inside the for-await
   * loop keeps the local turn from dragging on. Spike B confirms the SDK
   * surface.
   */
  signal?: AbortSignal;
  /**
   * Phase-06: when true, the SDK WebSearch tool is added to allowedTools and
   * removed from disallowedTools for this turn. Gated by env flag
   * CHAT_ENABLE_WEB_SEARCH and skill-level opt-in (enable_web_search: true).
   */
  webSearchEnabled?: boolean;
}

/**
 * Run a single Claude agent turn. Yields SseEvent objects as the SDK streams
 * messages, including tool_call, tool_result, token, thinking, and result events.
 */
export async function* run(params: RunParams): AsyncIterable<SseEvent> {
  await ensureClaudeHome();

  const { sessionId, turnId, systemPrompt, allowedToolNames, message, tools, toolContext, observer, tracer, resumeId, signal, webSearchEnabled } = params;

  // Filter tools to only those permitted by the active skill's frontmatter.
  // An empty allowedToolNames list means no restriction (pass-through all tools).
  const permittedTools =
    allowedToolNames.length > 0
      ? tools.filter((t) => allowedToolNames.includes(t.name))
      : tools;

  // Bind tool context into handlers via closure
  const sdkTools = permittedTools.map((t) =>
    sdkTool(
      t.name,
      t.description,
      t.inputSchema,
      async (args: Record<string, unknown>) => {
        const result = await t.handler(args, toolContext);
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        return { content: [{ type: 'text' as const, text }] };
      },
    ),
  );

  const mcpServer = createSdkMcpServer({
    name: 'cube-playground-tools',
    tools: sdkTools,
  });

  const sdkAllowedTools = permittedTools.map((t) => t.name);

  // sessionId is our internal uuid; the Claude SDK manages its own session ids
  // separately. When resumeId is supplied (phase 01), the SDK opens the next
  // turn with the prior thread visible.
  void sessionId;

  // Anthropic's SDK does automatic prefix caching when the system prompt is
  // byte-stable across turns. The kill-switch (ANTHROPIC_PROMPT_CACHE_ENABLED=
  // false) appends a per-turn nonce as a non-semantic suffix to bust that
  // cache, useful for a/b comparison or if caching ever produces unexpected
  // model behavior in prod. The nonce sits in a comment so it can't be
  // interpreted as instructions by the model.
  const finalSystemPrompt = config.anthropicPromptCacheEnabled
    ? systemPrompt
    : `${systemPrompt}\n\n<!-- cache-bust:${turnId} -->`;

  // Observer per-turn state — counters always declared; helpers no-op when
  // observer is undefined (guard at each call site). Declared OUTSIDE the
  // key-failover attempt loop so observer sequencing stays monotonic across
  // a retried first call.
  let stepIndex = 0;
  let seq = 0;
  let lastBoundary = Date.now();
  const pendingTools = new Map<string, PendingTool>();

  // Phase-01: capture the SDK session/conversation id from the first message
  // that exposes one. The exact field name on v0.3.150 is confirmed by
  // Spike A — we walk the candidate fields to stay robust to minor SDK
  // shifts. The capture fires at most once per turn (the first id wins) and
  // is forwarded via `sdk_session_captured` so api/turn.ts can persist it.
  let capturedSdkConversationId: string | undefined;

  // Key-failover: a balance-exhausted gateway key fails on the FIRST LLM call,
  // before any assistant tokens stream. When that happens and a fallback key
  // (ANTHROPIC_API_STG_KEY / ANTHROPIC_API_BACKUP_KEY) is configured, rotate
  // and transparently re-run the turn — but only while nothing user-visible
  // has been yielded yet (a mid-stream retry would duplicate output).
  let meaningfulYielded = false;
  const maxAttempts = Math.max(1, anthropicKeyCount());

  attempts: for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const activeKey = getActiveAnthropicKey();

  // The SDK streams by default: iterating `query()` yields assistant tokens,
  // tool calls, tool results, and the final `result` message as they arrive.
  // No flag toggles streaming — `for await` IS the streaming surface.
  const options = buildQueryOptions(
    config.chatQueryPreset ?? 'standard',
    {
      model: config.chatModel,
      systemPrompt: finalSystemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServers: { 'cube-playground-tools': mcpServer as any },
      allowedTools: sdkAllowedTools,
      env: {
        // Forward the org egress proxy first so the explicit keys below can't be
        // clobbered; the CLI needs it to reach the public LLM gateway from the
        // isolated runner. No-op in local dev (no proxy vars set).
        ...proxyEnvForChild(),
        HOME: CLAUDE_HOME,
        ANTHROPIC_API_KEY: activeKey.key,
        ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
        // The prod container runs as root, and permissionMode:'bypassPermissions'
        // makes the CLI pass --dangerously-skip-permissions, which Claude Code
        // refuses under uid 0 unless IS_SANDBOX=1 (verified against the CLI's own
        // root check). Safe here: every builtin tool is disabled
        // (DISABLED_BUILTIN_TOOLS) so the agent can only call our curated cube MCP
        // tools — there is no filesystem/shell to "skip permissions" on.
        IS_SANDBOX: '1',
      },
    },
    { resumeId, abortSignal: signal, webSearchEnabled },
  );

  // Capture the Claude Code subprocess stderr. The SDK surfaces a child crash
  // as the opaque "process exited with code 1"; buffering stderr lets us attach
  // the real cause (gateway URL/model/key rejected, missing runtime, etc.) to
  // the error so it reaches the SSE error event instead of just the exit code.
  let childStderr = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkOptions = options as any;
  sdkOptions.stderr = (data: string) => {
    if (childStderr.length < 4000) childStderr += data;
  };
  const iter = query({ prompt: message, options: sdkOptions });

  try {
  for await (const msg of iter) {
    // Phase 04 — defensive abort check. If the SDK respects the signal it
    // already stopped yielding; this is the belt-and-braces local exit so
    // an SDK that ignores the signal still terminates the turn cleanly.
    if (signal?.aborted) break;

    // Try to capture session id once. The SDK can surface it on the
    // `system` init message or on the final `result` message. We don't know
    // the canonical field name until Spike A confirms, so probe the common
    // shapes safely.
    if (!capturedSdkConversationId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyMsg = msg as any;
      const candidate =
        anyMsg?.session_id ??
        anyMsg?.conversation_id ??
        anyMsg?.message?.id ??
        anyMsg?.result?.session_id ??
        anyMsg?.result?.conversation_id;
      if (typeof candidate === 'string' && candidate.length > 0) {
        capturedSdkConversationId = candidate;
        yield {
          type: 'sdk_session_captured',
          data: { sdkConversationId: candidate },
        };
      }
    }

    // Side channel: raw SDK event firehose (before SSE mapping, no yield).
    // Fires even for a balance-failure result that triggers a key retry, so
    // the raw audit trail shows the failed attempt.
    if (observer) {
      try { emitSdkEvent(observer, turnId, seq++, msg); }
      catch (err) { console.warn('[observer] onSdkEvent threw:', err); }
    }

    // Key-failover intercept. Verified live: the CLI streams the gateway's
    // balance error TWICE — first as an assistant text message ("Credit
    // balance is too low"), then as a `result` with a non-success subtype (or
    // a thrown error). Both shapes must be suppressed from the client stream
    // while nothing real has been yielded, or the error-text tokens would (a)
    // poison the FE transcript and (b) flip meaningfulYielded, foreclosing
    // the silent retry.
    const balanceErrorText = balanceErrorTextOf(msg);
    if (balanceErrorText !== null) {
      if (msg.type === 'result') {
        // Always mark the key drained — even when a same-turn retry isn't
        // possible, the NEXT turn must start on a fallback key.
        const rotation = reportKeyBalanceExhausted(activeKey.key);
        if (rotation.rotated && !meaningfulYielded && attempt < maxAttempts) {
          console.warn(
            `[claude-runner] turn ${turnId}: '${activeKey.label}' key exhausted — retrying with '${rotation.nextLabel}' (attempt ${attempt + 1}/${maxAttempts})`,
          );
          // Re-arm session-id capture: the failed call's SDK conversation id
          // is dead for resume; the retry yields a fresh sdk_session_captured
          // and downstream persistence keeps the last one.
          capturedSdkConversationId = undefined;
          continue attempts;
        }
        // No retry available → fall through and yield the error normally so
        // the turn surfaces a classifiable llm_budget_exhausted failure.
      } else if (!meaningfulYielded) {
        // Error-shaped assistant echo before any real content: swallow it.
        // The terminal result/throw right behind it drives rotation; if no
        // key remains, the classified error event covers the user-facing
        // message, so dropping this duplicate loses nothing.
        continue;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = mapSdkMessage(msg as any);
    for (const event of events) {
      yield event;
      // sdk_session_captured is internal metadata; anything else reaching the
      // client (tokens, tool calls, errors) forecloses a silent key retry.
      if (event.type !== 'sdk_session_captured') meaningfulYielded = true;
    }

    // Side channel: per-LLM-call signal on every assistant message.
    if (observer && msg.type === 'assistant') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lastBoundary = emitLlmCall(observer, turnId, stepIndex++, config.chatModel, lastBoundary, msg as any, pendingTools);
      } catch (err) { console.warn('[observer] onLlmCall threw:', err); }
    }

    // Side channel: per-tool-invocation signal on every user (tool_result) message.
    if (observer && msg.type === 'user') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emitToolInvocations(observer, turnId, msg as any, pendingTools);
      } catch (err) { console.warn('[observer] onToolInvocation threw:', err); }
    }

    // Phase-02: emit turn-level stop_reason + permission_denials on result message.
    if (observer && msg.type === 'result') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emitTurnFinalized(observer, turnId, msg as any);
      } catch (err) { console.warn('[observer] emitTurnFinalized threw:', err); }
    }

    // Phase-05 parallel-emit shim: drive the shadow tracer from the same msg.
    // onSdkMessage internally fans the equivalent emit* calls to its sinks.
    if (tracer) {
      try { tracer.onSdkMessage(msg); }
      catch (err) { console.warn('[tracer] onSdkMessage threw:', err); }
    }
  }
  } catch (err) {
    // Attach the captured subprocess stderr to the opaque SDK exit error so the
    // turn's agent_error event carries the actionable cause. Empty stderr →
    // rethrow unchanged (don't mask the original).
    const detail = childStderr.trim();
    const base = err instanceof Error ? err.message : String(err);
    const full = detail ? `${base} — claude stderr: ${detail.slice(0, 1500)}` : base;

    // Key-failover on the thrown route (subprocess crash whose stderr carries
    // the balance error). Always mark the key drained so later turns rotate;
    // retry this turn only before anything user-visible streamed and while
    // another key remains.
    if (isBalanceExhaustedError(full)) {
      const rotation = reportKeyBalanceExhausted(activeKey.key);
      if (rotation.rotated && !meaningfulYielded && attempt < maxAttempts) {
        console.warn(
          `[claude-runner] turn ${turnId}: '${activeKey.label}' key exhausted (thrown) — retrying with '${rotation.nextLabel}' (attempt ${attempt + 1}/${maxAttempts})`,
        );
        capturedSdkConversationId = undefined;
        continue attempts;
      }
    }

    if (detail) throw new Error(full);
    throw err;
  }

  // The SDK stream completed (or aborted) without a key-balance failure —
  // don't fall through to another attempt.
  break;
  } // attempts loop

  // Flush tool_use entries that never received a tool_result (model abandoned).
  if (observer && pendingTools.size > 0) {
    try { flushPendingTools(observer, turnId, pendingTools); }
    catch (err) { console.warn('[observer] flushPendingTools threw:', err); }
  }

  // Phase-05: mirror the legacy flush on the shadow tracer.
  if (tracer) {
    try { tracer.finalize(); }
    catch (err) { console.warn('[tracer] finalize threw:', err); }
  }
}
