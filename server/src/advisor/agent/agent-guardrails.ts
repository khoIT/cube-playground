/**
 * Hard guardrails for the advisor agent, enforced at the harness — NEVER
 * trusted to the prompt. Caps come from env with conservative defaults; the
 * tool gate is deny-by-default (an empty allowlist blocks every tool).
 */

import type { GuardrailCaps } from './agent-types.js';

/** Conservative v1 defaults; override per-env. */
export const DEFAULT_CAPS: GuardrailCaps = {
  maxTurns: 12,
  maxBudgetUsd: 1.0,
  // A full Guided-Drive investigation (diagnose → levers → recommend → power)
  // is ~7 agentic steps, and each LLM step on the subscription OAuth lane runs
  // 15–30s — so a healthy investigation needs ~110s warm and more on a cold
  // warehouse. 120s left no margin (turns died mid-recommendation); 240s fits a
  // converged run with headroom while the $1 budget + 12-turn caps still bound
  // it. Override per-deploy with ADVISOR_AGENT_TIMEOUT_MS.
  timeoutMs: 240_000,
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Merge env-configured caps with an optional per-session override. */
export function resolveCaps(override?: Partial<GuardrailCaps>): GuardrailCaps {
  const base: GuardrailCaps = {
    maxTurns: envNumber('ADVISOR_AGENT_MAX_TURNS', DEFAULT_CAPS.maxTurns),
    maxBudgetUsd: envNumber('ADVISOR_AGENT_MAX_BUDGET_USD', DEFAULT_CAPS.maxBudgetUsd),
    timeoutMs: envNumber('ADVISOR_AGENT_TIMEOUT_MS', DEFAULT_CAPS.timeoutMs),
  };
  return {
    maxTurns: override?.maxTurns ?? base.maxTurns,
    maxBudgetUsd: override?.maxBudgetUsd ?? base.maxBudgetUsd,
    timeoutMs: override?.timeoutMs ?? base.timeoutMs,
  };
}

/** Result shape the SDK's canUseTool callback expects. */
export type ToolDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/**
 * Deny-by-default tool gate — the REAL enforcement that no built-in
 * filesystem/Bash tool (or anything outside the advisor surface) is reachable.
 * Only tools whose exact name is in `allowlist` are permitted; everything else
 * is refused. The allowlist is the wrapped advisor engine tools (mcp__advisor__*).
 */
export function makeCanUseTool(allowlist: readonly string[]) {
  const allowed = new Set(allowlist);
  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolDecision> => {
    if (allowed.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: `tool "${toolName}" is not on the advisor allowlist` };
  };
}
