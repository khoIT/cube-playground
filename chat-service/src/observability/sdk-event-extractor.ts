/**
 * Pure helpers that extract observer signals from raw SDK messages.
 *
 * Split from claude-runner.ts to keep that file under 200 LOC.
 * These functions have no side-effects and are fully testable in isolation.
 */

import type { ObserverHooks } from './observer-types.js';

// ---------------------------------------------------------------------------
// Internal state shape for the tool-use tracking map
// ---------------------------------------------------------------------------

export interface PendingTool {
  startedAt: number;
  name: string;
  args: unknown;
}

// ---------------------------------------------------------------------------
// Dispatch helpers — each wrapped in try/catch at call site in runner
// ---------------------------------------------------------------------------

/** Emit the raw SDK event firehose signal. */
export function emitSdkEvent(
  observer: ObserverHooks,
  turnId: string,
  seq: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
): void {
  observer.onSdkEvent({ turnId, seq, type: msg.type as string, payload: msg, at: Date.now() });
}

/**
 * On an assistant SDK message: emit onLlmCall and record any tool_use blocks
 * into the pendingTools map for later pairing with tool_results.
 *
 * Per-call token usage is unavailable in this SDK version — usage lives only
 * on the final `result` message (SdkResultMessage.usage). Emitting 0 here;
 * aggregate totals flow through the result SseEvent and are persisted at the
 * turn level (chat_turns.input_tokens / output_tokens) by turn.ts.
 */
export function emitLlmCall(
  observer: ObserverHooks,
  turnId: string,
  stepIndex: number,
  model: string,
  startedAt: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  pendingTools: Map<string, PendingTool>,
): number {
  const content: unknown[] = msg.message?.content ?? [];
  const endedAt = Date.now();

  observer.onLlmCall({
    turnId,
    stepIndex,
    model,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: endedAt - startedAt,
    startedAt,
    endedAt,
    content,
    stopReason: undefined,
  });

  // Register tool_use blocks for subsequent tool_result pairing.
  for (const block of content) {
    const b = block as { type?: string; id?: string; name?: string; input?: unknown };
    if (b.type === 'tool_use' && b.id && b.name) {
      pendingTools.set(b.id, { startedAt: Date.now(), name: b.name, args: b.input ?? {} });
    }
  }

  return endedAt; // caller uses this as the new lastBoundary
}

/**
 * On a user SDK message: pop pending tool_use entries that match tool_result
 * blocks and emit onToolInvocation for each matched pair.
 */
export function emitToolInvocations(
  observer: ObserverHooks,
  turnId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  pendingTools: Map<string, PendingTool>,
): void {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type !== 'tool_result' || !block.tool_use_id) continue;
    const pending = pendingTools.get(block.tool_use_id);
    if (!pending) continue;

    pendingTools.delete(block.tool_use_id);
    const endedAt = Date.now();
    observer.onToolInvocation({
      turnId,
      toolUseId: block.tool_use_id as string,
      name: pending.name,
      args: pending.args,
      resultSummary: summariseContent(block.content),
      ok: true,
      latencyMs: endedAt - pending.startedAt,
      startedAt: pending.startedAt,
      endedAt,
    });
  }
}

/**
 * After the for-await loop: flush any tool_use blocks that never received a
 * tool_result (model abandoned the invocation).
 */
export function flushPendingTools(
  observer: ObserverHooks,
  turnId: string,
  pendingTools: Map<string, PendingTool>,
): void {
  const endedAt = Date.now();
  for (const [toolUseId, pending] of pendingTools) {
    observer.onToolInvocation({
      turnId,
      toolUseId,
      name: pending.name,
      args: pending.args,
      resultSummary: 'no_result',
      ok: false,
      latencyMs: endedAt - pending.startedAt,
      startedAt: pending.startedAt,
      endedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summariseContent(content: any): string {
  if (!content) return 'ok';
  if (typeof content === 'string') return content.slice(0, 200);
  if (Array.isArray(content)) {
    const textBlock = content.find((b: { type?: string; text?: string }) => b.type === 'text');
    if (textBlock?.text) return String(textBlock.text).slice(0, 200);
    return `${content.length} block(s)`;
  }
  if (typeof content === 'object') return JSON.stringify(content).slice(0, 200);
  return String(content).slice(0, 200);
}
