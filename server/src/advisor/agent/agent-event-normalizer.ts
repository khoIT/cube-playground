/**
 * The ONLY module that knows SDK message shapes. It maps a raw SDKMessage to
 * zero or more normalized RuntimeEvents so the rest of the system depends on
 * our stable contract, not the SDK's (which shifts across versions).
 *
 * Defensive by design: unknown message types and missing fields yield no
 * events rather than throwing.
 */

import type { RuntimeEvent, AgentStopReason, AgentErrorCode } from './agent-types.js';

/** Loose view of an SDK message — we narrow by `type` and guard every field. */
type RawSdkMessage = {
  type?: string;
  subtype?: string;
  total_cost_usd?: number;
  message?: { content?: unknown };
  [k: string]: unknown;
};

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  is_error?: boolean;
};

/** Map an SDK result subtype to our stop reason. */
export function mapResultSubtype(subtype: string | undefined): AgentStopReason {
  if (subtype === 'success') return 'end_turn';
  if (subtype === 'error_max_turns') return 'max_turns';
  if (subtype && subtype.includes('timeout')) return 'timeout';
  return 'error';
}

/** A non-success stop reason → the matching error code (null for end_turn). */
export function stopReasonToErrorCode(reason: AgentStopReason): AgentErrorCode | null {
  switch (reason) {
    case 'max_turns':
      return 'max_turns';
    case 'timeout':
      return 'timeout';
    case 'aborted':
      return 'aborted';
    case 'error':
      return 'sdk_error';
    default:
      return null;
  }
}

function blocks(message: { content?: unknown } | undefined): ContentBlock[] {
  const content = message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

export function normalizeSdkMessage(raw: RawSdkMessage): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  switch (raw.type) {
    case 'assistant': {
      for (const b of blocks(raw.message)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
          events.push({ type: 'assistant_delta', text: b.text });
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          events.push({ type: 'tool_call', tool: b.name, callId: b.id });
        }
      }
      break;
    }
    case 'user': {
      // Tool results return as a user message carrying tool_result blocks.
      for (const b of blocks(raw.message)) {
        if (b.type === 'tool_result') {
          events.push({
            type: 'tool_result',
            tool: typeof b.name === 'string' ? b.name : 'tool',
            callId: b.tool_use_id,
            ok: b.is_error !== true,
          });
        }
      }
      break;
    }
    case 'result': {
      if (typeof raw.total_cost_usd === 'number') {
        events.push({ type: 'cost', usd: raw.total_cost_usd });
      }
      const reason = mapResultSubtype(raw.subtype);
      const code = stopReasonToErrorCode(reason);
      if (code) {
        events.push({ type: 'error', code, message: `agent stopped: ${raw.subtype ?? reason}` });
      }
      events.push({
        type: 'done',
        usd: typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : null,
        stopReason: reason,
      });
      break;
    }
    default:
      break;
  }

  return events;
}
