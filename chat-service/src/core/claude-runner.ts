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
import type { SseEvent, ToolContext } from '../types.js';
import type { ObserverHooks } from '../observability/observer-types.js';
import {
  emitSdkEvent,
  emitLlmCall,
  emitToolInvocations,
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
}

/**
 * Run a single Claude agent turn. Yields SseEvent objects as the SDK streams
 * messages, including tool_call, tool_result, token, thinking, and result events.
 */
export async function* run(params: RunParams): AsyncIterable<SseEvent> {
  await ensureClaudeHome();

  const { sessionId, turnId, systemPrompt, allowedToolNames, message, tools, toolContext, observer } = params;

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
  // separately. Until we persist the SDK's id and pass it back on subsequent
  // turns, every turn opens a fresh SDK conversation.
  void sessionId;

  const iter = query({
    prompt: message,
    options: {
      model: config.chatModel,
      systemPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServers: { 'cube-playground-tools': mcpServer as any },
      allowedTools: sdkAllowedTools,
      // Prevent the SDK subprocess from calling any builtin Claude Code tools
      disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
      permissionMode: 'bypassPermissions',
      env: {
        HOME: CLAUDE_HOME,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
      },
    },
  });

  // Observer per-turn state — counters always declared; helpers no-op when
  // observer is undefined (guard at each call site).
  let stepIndex = 0;
  let seq = 0;
  let lastBoundary = Date.now();
  const pendingTools = new Map<string, PendingTool>();

  for await (const msg of iter) {
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
  }

  // Flush tool_use entries that never received a tool_result (model abandoned).
  if (observer && pendingTools.size > 0) {
    try { flushPendingTools(observer, turnId, pendingTools); }
    catch (err) { console.warn('[observer] flushPendingTools threw:', err); }
  }
}
