/**
 * Shared context + result helpers for the advisor agent's in-process SDK tools.
 *
 * Each tool is a THIN adapter: validate args (zod) → call the BUILT deterministic
 * engine with the per-request WorkspaceCtx → (redact member rows) → register the
 * result in the session provenance ledger → return an envelope whose
 * structuredContent carries the provenanceId. We never fork the engines.
 */

import type { WorkspaceCtx } from '../../../services/cube-client.js';
import type { CubeReaderFn } from '../../cube-read.js';
import type { ScopeRef } from '../../diagnosis-types.js';
import type { AdvisorGoal } from '../agent-types.js';
import type { ProvenanceLedger } from '../agent-provenance-gate.js';

/** Everything a tool adapter needs, fixed for the life of one session. */
export interface ToolContext {
  scope: ScopeRef;
  goal: AdvisorGoal;
  ctx: WorkspaceCtx;
  /** Anchor for every time-based computation — fixed at session start. */
  asOf: Date;
  ledger: ProvenanceLedger;
  /** Injected Cube reader (tests stub it); engines fall back to live loadWithCtx. */
  reader?: CubeReaderFn;
}

/**
 * The envelope shape the SDK `tool()` handler must return. The index signature
 * matches the SDK's CallToolResult (which permits extra `_meta`-style keys).
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Build a successful tool result: a human-readable summary for the transcript +
 * the structured payload (with provenanceId) for the UI/gate.
 */
export function ok(summary: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent: structured };
}

/** Build an error tool result the agent can read and recover from. */
export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Tool error: ${message}` }], isError: true };
}

/** Register an output in the ledger and return its provenanceId. */
export function provenance(tctx: ToolContext, tool: string, output: unknown): string {
  return tctx.ledger.register(tool, output);
}
