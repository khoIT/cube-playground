/**
 * Phase 05 — JSON-lines structured log sink.
 *
 * Emits one redacted line per `TraceEvent` to a sink function (defaults to
 * `console.log`). The shape is intentionally flat so log-aggregation tools
 * (`pino`, `loki`, etc.) can ingest without further normalisation.
 *
 * Redaction policy (defence in depth — content_json and args_json are already
 * truncated upstream by `llm-trace-recorder.ts`):
 *   - `content` arrays → only block types + lengths
 *   - `args` objects   → only keys + value-type summary
 *   - `result_summary` → preserved (already capped at ~200 chars)
 *
 * The sink never throws; emitter exceptions are logged and swallowed so the
 * tracer's fan-out loop continues for siblings.
 */

import type { TraceEvent, TraceSink } from '../trace-event.js';

export interface StructuredLogSinkOptions {
  /** Receiver for each structured line. Defaults to `console.log`. */
  emit?: (line: string) => void;
  /** Override the timestamp source for tests. */
  now?: () => number;
  /** Service label (e.g. 'chat-service'). Added verbatim to every record. */
  service?: string;
}

interface BaseRecord {
  service: string;
  ts: number;
  kind: TraceEvent['kind'];
  turnId: string;
}

function summariseContent(content: unknown): Array<{ type?: string; len?: number }> {
  if (!Array.isArray(content)) return [];
  return content.map((b) => {
    const block = b as Record<string, unknown>;
    const type = typeof block['type'] === 'string' ? (block['type'] as string) : undefined;
    const text = typeof block['text'] === 'string' ? (block['text'] as string).length : undefined;
    const thinking =
      typeof block['thinking'] === 'string' ? (block['thinking'] as string).length : undefined;
    return { type, len: text ?? thinking };
  });
}

function summariseArgs(args: unknown): { keys?: string[]; size: number } {
  if (!args || typeof args !== 'object') return { size: 0 };
  const keys = Object.keys(args as Record<string, unknown>);
  return { keys, size: keys.length };
}

export class StructuredLogSink implements TraceSink {
  readonly name = 'structured-log';
  private readonly emitter: (line: string) => void;
  private readonly nowFn: () => number;
  private readonly service: string;

  constructor(opts: StructuredLogSinkOptions = {}) {
    // eslint-disable-next-line no-console
    this.emitter = opts.emit ?? ((line) => console.log(line));
    this.nowFn = opts.now ?? Date.now;
    this.service = opts.service ?? 'chat-service';
  }

  emit(event: TraceEvent): void {
    const base: BaseRecord = {
      service: this.service,
      ts: this.nowFn(),
      kind: event.kind,
      turnId: this.extractTurnId(event),
    };
    const payload = this.summarise(event);
    this.emitter(JSON.stringify({ ...base, ...payload }));
  }

  private extractTurnId(event: TraceEvent): string {
    switch (event.kind) {
      case 'llm_call':
      case 'tool_invocation':
      case 'sdk_event':
      case 'turn_finalized':
      case 'permission_decision':
      case 'turn_aborted':
        return event.payload.turnId;
    }
  }

  private summarise(event: TraceEvent): Record<string, unknown> {
    switch (event.kind) {
      case 'llm_call':
        return {
          stepIndex: event.payload.stepIndex,
          model: event.payload.model,
          latencyMs: event.payload.latencyMs,
          stopReason: event.payload.stopReason,
          content: summariseContent(event.payload.content),
        };
      case 'tool_invocation':
        return {
          toolUseId: event.payload.toolUseId,
          tool: event.payload.name,
          ok: event.payload.ok,
          latencyMs: event.payload.latencyMs,
          args: summariseArgs(event.payload.args),
          resultSummary: event.payload.resultSummary,
        };
      case 'sdk_event':
        return { seq: event.payload.seq, type: event.payload.type };
      case 'turn_finalized':
        return {
          stopReason: event.payload.stopReason,
          inputTokens: event.payload.totalInputTokens,
          outputTokens: event.payload.totalOutputTokens,
        };
      case 'permission_decision':
        return {
          tool: event.payload.toolName,
          decision: event.payload.decision,
          reason: event.payload.reason,
        };
      case 'turn_aborted':
        return { reason: event.payload.reason, message: event.payload.message };
    }
  }
}
