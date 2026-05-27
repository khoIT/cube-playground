/**
 * Named factory for Claude Agent SDK query() options.
 *
 * Every later phase needs to toggle one option on top of "standard" behaviour:
 *   - phase 01 adds `resume` (SDK session-resume id)
 *   - phase 04 adds `abortController.signal`
 *   - phase 06 adds research-mode flags + web-search tool
 *
 * Hardcoding the option literal at the call-site (the old `claude-runner.ts`
 * shape) makes those toggles risky — every phase touches the same line. The
 * factory localises the surface: phases override per-call via `overrides`,
 * presets carry policy-level changes.
 *
 * `'standard'` is the verbatim behaviour shipped before phase 00 — diff a
 * snapshot of the returned object against the previous inline options to
 * verify zero behaviour change.
 *
 * NOTE: this module returns a plain object compatible with the SDK's
 * `query({ prompt, options })` shape. It does NOT call the SDK; that stays in
 * `claude-runner.ts`.
 */

export type QueryOptionsPreset = 'standard' | 'research-safe';

/**
 * Built-in Claude Code tools we never want the SDK subprocess to invoke.
 * The chat-service exposes its own MCP server with curated tools; the builtins
 * (file system, shell, web) are out of scope and would let the model take
 * actions outside the playground sandbox.
 *
 * Frozen so callers can't mutate the shared list by accident.
 */
export const DISABLED_BUILTIN_TOOLS: readonly string[] = Object.freeze([
  'Read',
  'Write',
  'Bash',
  'WebFetch',
  'WebSearch',
  'Edit',
  'MultiEdit',
]);

/**
 * Inputs the runner must always supply. Presets cannot fill these in — they
 * depend on the active request (skill prompt, MCP server instance, allowed
 * tool list, env-var bag).
 */
export interface QueryOptionsInputs {
  model: string;
  systemPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpServers: Record<string, any>;
  allowedTools: string[];
  env: Record<string, string>;
}

/**
 * Per-call overrides. Phase 01 adds `resumeId`; phase 04 adds `abortSignal`;
 * phase 06 adds `webSearchEnabled`. Keep this union closed so the option
 * surface stays auditable.
 */
export interface QueryOptionsOverrides {
  /** Phase 01 — SDK session resume id (passed as `resume` to the SDK). */
  resumeId?: string;
  /** Phase 04 — abort controller signal. */
  abortSignal?: AbortSignal;
  /**
   * Phase 06 — when true, WebSearch is moved from disallowedTools to
   * allowedTools for this turn. Only effective when the env flag
   * CHAT_ENABLE_WEB_SEARCH=true AND the skill opts in (enable_web_search: true).
   */
  webSearchEnabled?: boolean;
}

/**
 * SDK query() options shape this factory returns. Kept as a structural type so
 * we don't import the SDK's option types directly — the SDK shape has evolved
 * across minor versions and this lets us pin our surface.
 */
export interface BuiltQueryOptions {
  model: string;
  systemPrompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mcpServers: Record<string, any>;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: 'bypassPermissions' | 'default';
  env: Record<string, string>;
  /** Phase 01 placeholder — only populated when overrides.resumeId is set. */
  resume?: string;
  /** Phase 04 placeholder — only populated when overrides.abortSignal is set. */
  abortSignal?: AbortSignal;
}

/**
 * Build an SDK options object from a preset + required inputs + optional
 * overrides. The preset chooses policy (permission mode, disallowed-tool list);
 * inputs are per-call data; overrides are escape hatches for later phases.
 */
export function buildQueryOptions(
  preset: QueryOptionsPreset,
  inputs: QueryOptionsInputs,
  overrides: QueryOptionsOverrides = {},
): BuiltQueryOptions {
  const base: BuiltQueryOptions = {
    model: inputs.model,
    systemPrompt: inputs.systemPrompt,
    mcpServers: inputs.mcpServers,
    allowedTools: inputs.allowedTools,
    disallowedTools: [...DISABLED_BUILTIN_TOOLS],
    permissionMode: 'bypassPermissions',
    env: inputs.env,
  };

  switch (preset) {
    case 'standard':
      // Verbatim with the pre-phase-00 inline options.
      break;
    case 'research-safe':
      // Placeholder for phase 06 — keeps the enum closed today.
      // Future: enable web search tool, tighten permission mode, etc.
      break;
    default: {
      const exhaustive: never = preset;
      throw new Error(`Unknown query-options preset: ${String(exhaustive)}`);
    }
  }

  if (overrides.resumeId !== undefined) {
    base.resume = overrides.resumeId;
  }
  if (overrides.abortSignal !== undefined) {
    base.abortSignal = overrides.abortSignal;
  }

  // Phase 06 — web search gating. When the caller signals webSearchEnabled,
  // move 'WebSearch' out of disallowedTools and into allowedTools so the SDK
  // subprocess can invoke it. All other builtin restrictions stay intact.
  if (overrides.webSearchEnabled === true) {
    base.disallowedTools = base.disallowedTools.filter((t) => t !== 'WebSearch');
    if (!base.allowedTools.includes('WebSearch')) {
      base.allowedTools = [...base.allowedTools, 'WebSearch'];
    }
  }

  return base;
}
