/**
 * Per-turn audit record for the advisor agent. Structured, PII-free, and never
 * carries the OAuth token. Writes through whatever pino-like logger the caller
 * passes (the Fastify request logger in the route), defaulting to console.
 */

import type { ScopeRef } from '../diagnosis-types.js';
import type { AgentMode, AgentStopReason } from './agent-types.js';

export interface TurnAuditRecord {
  sessionId: string;
  turnIndex: number;
  scope: ScopeRef;
  goal: string;
  mode: AgentMode;
  /** Actor who spawned the turn (username/email) — a paid, write-gated action. */
  owner?: string;
  /** Tool names invoked this turn (names only — never arguments/results). */
  toolCalls: string[];
  stopReason: AgentStopReason;
  /** Total session cost in USD after this turn (cumulative). */
  totalCostUsd: number;
  startedAt: number;
  endedAt: number;
  /** Set when the turn ended abnormally (timeout/abort/guardrail). */
  abortCause?: string;
}

export interface AuditLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
}

const consoleLogger: AuditLogger = {
  info: (obj, msg) => {
    // Single structured line; mirrors the server's pino JSON shape closely
    // enough for grep without pulling in the logger as a hard dependency.
    console.log(JSON.stringify({ level: 'info', ...obj, msg: msg ?? 'advisor-agent turn' }));
  },
};

export function writeTurnAudit(record: TurnAuditRecord, logger: AuditLogger = consoleLogger): void {
  logger.info(
    {
      event: 'advisor_agent_turn',
      sessionId: record.sessionId,
      turnIndex: record.turnIndex,
      scope: record.scope,
      goal: record.goal,
      mode: record.mode,
      ...(record.owner ? { owner: record.owner } : {}),
      toolCalls: record.toolCalls,
      stopReason: record.stopReason,
      totalCostUsd: record.totalCostUsd,
      durationMs: record.endedAt - record.startedAt,
      ...(record.abortCause ? { abortCause: record.abortCause } : {}),
    },
    'advisor-agent turn complete',
  );
}
