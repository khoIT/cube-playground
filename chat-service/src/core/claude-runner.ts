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
        ANTHROPIC_API_KEY: config.anthropicApiKey,
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

  // Observer per-turn state — counters always declared; helpers no-op when
  // observer is undefined (guard at each call site).
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
    if (observer) {
      try { emitSdkEvent(observer, turnId, seq++, msg); }
      catch (err) { console.warn('[observer] onSdkEvent threw:', err); }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = mapSdkMessage(msg as any);
    for (const event of events) {
      yield event;
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
    if (detail) {
      const base = err instanceof Error ? err.message : String(err);
      throw new Error(`${base} — claude stderr: ${detail.slice(0, 1500)}`);
    }
    throw err;
  }

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
