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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_HOME = resolve(__dirname, '../../runtime/claude-home');
const SETTINGS_PATH = resolve(CLAUDE_HOME, '.claude/settings.json');

// Seed an isolated Claude home on first use — disable all hooks, no builtin tools.
let homeInitialised = false;
async function ensureClaudeHome(): Promise<void> {
  if (homeInitialised) return;
  await mkdir(resolve(CLAUDE_HOME, '.claude'), { recursive: true });
  if (!existsSync(SETTINGS_PATH)) {
    await writeFile(SETTINGS_PATH, JSON.stringify({ hooks: {} }, null, 2));
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
  systemPrompt: string;
  message: string;
  tools: ToolDefinition[];
  toolContext: ToolContext;
}

/**
 * Run a single Claude agent turn. Yields SseEvent objects as the SDK streams
 * messages, including tool_call, tool_result, token, thinking, and result events.
 */
export async function* run(params: RunParams): AsyncIterable<SseEvent> {
  await ensureClaudeHome();

  const { sessionId, systemPrompt, message, tools, toolContext } = params;

  // Bind tool context into handlers via closure
  const sdkTools = tools.map((t) =>
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

  const allowedToolNames = tools.map((t) => t.name);

  const iter = query({
    prompt: message,
    options: {
      model: config.chatModel,
      systemPrompt,
      resume: sessionId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServers: { 'cube-playground-tools': mcpServer as any },
      allowedTools: allowedToolNames,
      // Prevent the SDK subprocess from calling any builtin Claude Code tools
      disallowedTools: ['Read', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Edit', 'MultiEdit'],
      permissionMode: 'dontAsk',
      env: {
        HOME: CLAUDE_HOME,
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
      },
    },
  });

  for await (const msg of iter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = mapSdkMessage(msg as any);
    for (const event of events) {
      yield event;
    }
  }
}
