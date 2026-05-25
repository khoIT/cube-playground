/**
 * Replay a cached turn through the SSE stream.
 *
 * Emits the same event sequence a live assistant turn would produce:
 *   token (one chunk per ~80 chars of cached text)
 *   result (with input_tokens=0, output_tokens=0, cost_usd=0 — zero because
 *           no LLM was called; consumers must not bill these turns)
 *
 * The FE must not be able to distinguish a replayed turn from a live one
 * by wire shape alone. The golden SSE test in cache/__tests__/replay.test.ts
 * enforces this contract.
 *
 * Tool calls are intentionally absent: the write-gate in response-cache-write.ts
 * guarantees we only cache turns with no tool calls / artifacts.
 */

import { writeSseEvent } from '../core/sse-stream.js';
import type { SseEvent } from '../types.js';
import { chunkText } from './response-cache-key.js';
import type { CachedResponse, CachedValue } from '../db/response-cache-store.js';
import type { Writable } from 'node:stream';

/**
 * Replay a cached turn onto the given stream.
 *
 * @param cached    Row from response_cache table.
 * @param stream    Node Writable (the SSE reply.raw stream).
 * @param emitFn    Optional override for emitting events (used in tests).
 */
export async function replayCachedTurn(
  cached: CachedResponse,
  stream: Writable,
  emitFn?: (event: SseEvent) => void,
): Promise<void> {
  const emit = emitFn ?? ((event: SseEvent) => writeSseEvent(stream, event));

  let value: CachedValue;
  try {
    value = JSON.parse(cached.value_json) as CachedValue;
  } catch {
    throw new Error(`response_cache: corrupt value_json for key ${cached.key}`);
  }

  const text = value.text ?? '';

  // Emit loading first so the wire shape is byte-identical to a live turn.
  // Live turns emit loading before any tokens (turn.ts:349). Without this
  // future consumers keying off the `loading` event would drift on cache-hit paths.
  emit({ type: 'loading', data: {} });

  // Emit token chunks — same visual streaming experience as a live turn.
  for (const chunk of chunkText(text, 80)) {
    emit({ type: 'token', data: { delta: chunk } });
  }

  // Emit result event — tokens are 0 (no LLM call was made).
  emit({
    type: 'result',
    data: {
      text,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    },
  });
}
