/**
 * Pure mapping from an advisor run/turn failure to an actionable next-step hint.
 *
 * This is the "know how to handle cases like this" half of the audit console:
 * when a run stops abnormally, the admin sees not just WHAT failed but WHAT TO
 * DO. The most common case is the cold-Trino timeout — the first cube_query of
 * a session times out while Trino warms up, and a retry usually succeeds.
 *
 * Pure + unit-tested: no React, no fetch. Returns null when the run ended
 * cleanly (end_turn) and there is nothing to advise.
 */

export interface FailureHintInput {
  /** Final stop reason of the run/turn. */
  stopReason: string | null;
  /** abort_cause recorded on the turn (e.g. 'timeout', 'client_disconnect'). */
  abortCause?: string | null;
  /** Tool names whose state was 'failed' this run (for cold-Trino detection). */
  failedTools?: string[];
  /** Tool names whose state was 'denied' (guardrail). */
  deniedTools?: string[];
}

export interface FailureHint {
  /** 'error' = needs attention, 'info' = expected/benign. Drives badge color. */
  severity: 'error' | 'info';
  title: string;
  hint: string;
}

const CUBE_QUERY_TOOLS = ['cube_query', 'cube_query_view'];

export function failureHint(input: FailureHintInput): FailureHint | null {
  const stop = input.stopReason ?? '';
  const failed = input.failedTools ?? [];
  const denied = input.deniedTools ?? [];
  const hitColdTrino = failed.some((t) => CUBE_QUERY_TOOLS.includes(t));

  switch (stop) {
    case 'timeout':
      if (hitColdTrino) {
        return {
          severity: 'error',
          title: 'Cold Trino — query timed out',
          hint:
            'A cube_query timed out, most likely because Trino was cold. Warm it up with a small/narrow query (or narrow the time window) and re-run — retries usually succeed once Trino is warm.',
        };
      }
      return {
        severity: 'error',
        title: 'Turn timed out',
        hint:
          'The turn exceeded the time budget before producing a result. Narrow the question, or raise the timeout cap if the investigation legitimately needs longer.',
      };
    case 'budget':
      return {
        severity: 'error',
        title: 'Hit the cost ceiling',
        hint: 'The run reached maxBudgetUsd. Narrow the question or raise the budget cap for this investigation.',
      };
    case 'max_turns':
      return {
        severity: 'error',
        title: 'Ran out of turns',
        hint:
          'The investigation needed more steps than allowed. Ask a narrower question, or raise the maxTurns cap.',
      };
    case 'aborted':
      return {
        severity: 'info',
        title: 'Aborted mid-turn',
        hint:
          input.abortCause === 'client_disconnect' || input.abortCause === 'aborted'
            ? 'The client disconnected mid-turn. The session stays resumable — reconnect to continue the same investigation.'
            : 'The session was aborted (eviction or explicit stop). No action needed.',
      };
    case 'error':
      return {
        severity: 'error',
        title: 'Unexpected SDK error',
        hint: 'The agent hit an unexpected error. Check the event replay for the failing frame to see the cause.',
      };
    default:
      // end_turn or unknown clean stop — flag denied tools (a benign guardrail)
      // but otherwise advise nothing.
      if (denied.length > 0) {
        return {
          severity: 'info',
          title: 'Tool denied by guardrail',
          hint: `The agent tried a tool outside the advisor allowlist (${denied.join(', ')}). This is the expected deny-by-default guardrail — no action needed.`,
        };
      }
      return null;
  }
}

/** Collect the failed/denied tool names from a run's turns for failureHint(). */
export function collectToolOutcomes(
  turns: Array<{ toolCalls: Array<{ tool: string; state: string }> }>,
): { failedTools: string[]; deniedTools: string[] } {
  const failed = new Set<string>();
  const denied = new Set<string>();
  for (const t of turns) {
    for (const c of t.toolCalls) {
      if (c.state === 'failed') failed.add(c.tool);
      else if (c.state === 'denied') denied.add(c.tool);
    }
  }
  return { failedTools: [...failed], deniedTools: [...denied] };
}
