/**
 * Maps Claude Agent SDK messages → typed SseEvent objects.
 *
 * The SDK emits SDKMessage objects when iterating query(). The shapes we care
 * about are:
 *   - type === 'assistant': message.content is an array of content blocks
 *       { type: 'text',      text: string }           → token event
 *       { type: 'thinking',  thinking: string }        → thinking event
 *       { type: 'tool_use',  id, name, input }         → tool_call event
 *   - type === 'user': may contain tool_result blocks  → tool_result event
 *   - type === 'result': final turn summary            → result event
 *
 * Returns null for SDK messages that don't map to a client-visible event
 * (system init messages, partial messages we don't expose, etc.).
 */

import type { SseEvent } from '../types.js';
import type { Writable } from 'node:stream';

// ---------------------------------------------------------------------------
// SDK message shape (minimal structural typing — we don't import SDK types
// directly to keep the mapper testable without the full SDK).
// ---------------------------------------------------------------------------

interface SdkContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
}

interface SdkToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content?: any;
}

interface SdkAssistantMessage {
  type: 'assistant';
  message: {
    content: SdkContentBlock[];
  };
}

interface SdkUserMessage {
  type: 'user';
  message: {
    content: SdkToolResultBlock[] | string;
  };
  // present when message carries a tool result
  tool_use_result?: unknown;
}

interface SdkResultMessage {
  type: 'result';
  result: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  // The SDK calls this subtype
  subtype?: string;
}

export type SdkMessage = SdkAssistantMessage | SdkUserMessage | SdkResultMessage | { type: string };

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a single SDK message to zero or more SseEvent objects.
 * Returns an empty array for messages that produce no client events.
 */
export function mapSdkMessage(msg: SdkMessage): SseEvent[] {
  if (msg.type === 'assistant') {
    const am = msg as SdkAssistantMessage;
    const events: SseEvent[] = [];

    for (const block of am.message?.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ type: 'token', data: { delta: block.text } });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        events.push({ type: 'thinking', data: { delta: block.thinking } });
      } else if (block.type === 'tool_use' && block.id && block.name) {
        events.push({
          type: 'tool_call',
          data: { id: block.id, name: block.name, args: block.input ?? {} },
        });
      }
    }
    return events;
  }

  if (msg.type === 'user') {
    const um = msg as SdkUserMessage;
    const events: SseEvent[] = [];
    const content = um.message?.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result') {
          const summary = summariseToolResult(block.content);
          events.push({
            type: 'tool_result',
            data: {
              id: block.tool_use_id,
              ok: true,
              ms: 0, // ms is set by the tool handler; SDK messages don't carry timing
              summary,
            },
          });
        }
      }
    }
    return events;
  }

  if (msg.type === 'result') {
    const rm = msg as SdkResultMessage;
    return [
      {
        type: 'result',
        data: {
          text: rm.result ?? '',
          cost_usd: rm.total_cost_usd,
          input_tokens: rm.usage?.input_tokens,
          output_tokens: rm.usage?.output_tokens,
        },
      },
    ];
  }

  // Unrecognised / system / partial messages → no client event
  return [];
}

// ---------------------------------------------------------------------------
// Wire format helpers
// ---------------------------------------------------------------------------

/**
 * Write a single SseEvent to a Node Writable stream in the SSE wire format:
 *   event: <type>\ndata: <json>\n\n
 */
export function writeSseEvent(stream: Writable, event: SseEvent): void {
  const line = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  stream.write(line);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summariseToolResult(content: any): string {
  if (!content) return 'ok';
  if (typeof content === 'string') return content.slice(0, 200);
  if (Array.isArray(content)) {
    const textBlock = content.find((b: SdkContentBlock) => b.type === 'text');
    if (textBlock?.text) return String(textBlock.text).slice(0, 200);
    return `${content.length} block(s)`;
  }
  if (typeof content === 'object') {
    return JSON.stringify(content).slice(0, 200);
  }
  return String(content).slice(0, 200);
}
