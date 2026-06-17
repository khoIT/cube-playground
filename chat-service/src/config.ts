/**
 * Configuration module — reads process.env, validates required vars, exposes typed Config.
 * Import 'dotenv/config' side-effect to load .env before accessing process.env.
 */

import 'dotenv/config';
import type { QueryOptionsPreset } from './core/query-options-presets.js';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
  return parsed;
}

function optionalFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) throw new Error(`Env var ${name} must be a number, got: ${raw}`);
  return parsed;
}

export interface Config {
  port: number;
  logLevel: string;
  anthropicApiKey: string;
  /**
   * Optional fallback gateway keys, tried in order (primary → stg → backup)
   * when the active key's balance/budget is exhausted. Empty = not configured.
   * See core/anthropic-key-failover.ts for the rotation rules.
   */
  anthropicApiStgKey: string;
  anthropicApiBackupKey: string;
  /**
   * Last-resort fallback: a long-lived Claude subscription OAuth token
   * (generated once via `claude setup-token` on a Pro/Max account). When every
   * gateway key is balance-exhausted, the runner spawns the SDK subprocess with
   * CLAUDE_CODE_OAUTH_TOKEN instead of ANTHROPIC_API_KEY — auth goes direct to
   * api.anthropic.com on the subscription quota, bypassing the LLM gateway.
   * Empty = not configured. Emergency continuity only: subscription quota is a
   * shared 5-hour window, not a metered backend budget.
   */
  anthropicSubscriptionOauthToken: string;
  /**
   * Cooldown (ms) before a balance-exhausted key is retried. Lets the service
   * fall back to the primary key automatically after a top-up. Default 10 min.
   */
  anthropicKeyRetryCooldownMs: number;
  anthropicBaseUrl: string;
  chatModel: string;
  chatMaxOutputTokens: number;
  serverBaseUrl: string;
  cubeApiUrl: string;
  chatDbPath: string;
  chatMaxTurnsPerSession: number;
  chatMaxTokensPerTurn: number;
  /** TTL in ms for the skill-loader LRU cache. Default: 5000 (dev) / 60000 (prod). */
  skillLoaderTtlMs: number;
  /** Token budget for a session before auto-compact triggers (80% threshold). */
  contextBudgetTokens: number;
  /** Cheap model used for generating session title summaries. */
  titleModel: string;
  /**
   * Model for the one-shot AI segment brief (`POST /internal/segment-brief`).
   * Default sonnet — the LLM gateway key 403s non-sonnet models, so do not
   * point this at haiku/opus without a per-feature key that allows them.
   */
  briefModel: string;
  /**
   * Model for the starter-question LLM refine pass. Defaults to Opus: the
   * call is rare (once per workspace+game per schema change), cached in
   * sqlite, and fire-and-forget — so question quality wins over cost.
   */
  starterRefinerModel: string;
  /** Max requests per owner per minute on POST /agent/turn. */
  rateLimitPerOwnerPerMin: number;
  /** LLM cost per 1k input tokens in USD (for stats endpoint). */
  costPer1kInputUsd: number;
  /** LLM cost per 1k output tokens in USD (for stats endpoint). */
  costPer1kOutputUsd: number;
  /** Enable MCP exposure of chat-service tools (off by default). */
  mcpEnabled: boolean;
  /**
   * Confidence threshold above which the NL→Cube engine auto-resolves the
   * query in aggressive mode; otherwise it asks a clarification. Drives the
   * threshold gate in chat-service/src/nl-to-query/mode-gate.ts.
   */
  disambigAutoThreshold: number;
  /** Stream-registry per-turn ring buffer size (events kept for replay). */
  streamRegistryRingSize: number;
  /** Stream-registry global concurrent-turn cap. */
  streamRegistryMaxTurns: number;
  /** TTL (ms) entries linger after finish so a refreshed client can attach. */
  streamRegistryTtlMs: number;
  /** Background sweeper interval (ms) for evicting expired entries. */
  streamRegistrySweepIntervalMs: number;
  /**
   * Minimum sessions before starter-question grid switches from cold-start
   * (uniform) ranking to topic-histogram ranking. Single source of truth —
   * no env var, no DB row.
   */
  starterRankMinSessions: number;
  /**
   * Shared service token used by chat-service when calling main-server
   * internal endpoints (e.g. POST /api/segments/:id/refresh).
   * Main server validates the bearer token against the same env var.
   */
  mainServerServiceToken: string;
  /**
   * Inbound shared secret for the admin telemetry bridge (`/internal/stats`).
   * The main server presents it in `x-internal-secret` when aggregating chat
   * usage across users. Unconditional gate — NOT bypassed under AUTH_DISABLED
   * (unlike the main server's `/internal/access`), because this exposes other
   * users' activity. Unset → the route 503s (fails loud, never open).
   */
  internalSecret: string;
  /**
   * Langfuse Cloud mirror — env-gated, all optional.
   * When publicKey or secretKey is absent, the LangfuseTracer runs as a no-op.
   * IMPORTANT: enabling mirrors turn inputs/outputs (PII) to Langfuse Cloud.
   */
  langfusePublicKey: string;
  langfuseSecretKey: string;
  langfuseBaseUrl: string;
  /**
   * Enable exact-match response cache (per-game shared cache).
   * Off by default — PII pre-ship audit required before enabling in prod.
   * Set RESPONSE_CACHE_ENABLED=true to activate.
   */
  responseCacheEnabled: boolean;
  /**
   * Enable the unified kv_cache service (cube /load row cache, turn-detail
   * audit cache, etc.). On by default — these surfaces are PII-clean since
   * they cache aggregate data or already-approved DB reads, not LLM output
   * derived from user messages. Independent from `responseCacheEnabled`,
   * which gates the higher-PII response cache.
   */
  cacheServiceEnabled: boolean;
  /**
   * Enable Anthropic's automatic prompt prefix cache. On by default — the SDK
   * caches stable prefixes server-side at no storage cost on our infra (no PII
   * surface). Setting ANTHROPIC_PROMPT_CACHE_ENABLED=false appends a per-turn
   * nonce that forces every system prompt to differ, busting the cache.
   * Kill-switch for production rollback if caching produces unexpected behavior.
   */
  anthropicPromptCacheEnabled: boolean;
  /**
   * Allowlist of model IDs accepted via X-Model header in POST /agent/turn.
   * Unknown values silently fall back to chatModel — never echoed to the SDK.
   */
  allowedModels: string[];
  /**
   * Models the LLM gateway key is provisioned to serve. The gateway (LiteLLM)
   * key is locked to a server-side model allow-list; requesting anything else
   * returns a 403 `key_model_access_denied` — which is NOT a balance error, so
   * it never triggers key failover. Any model outside this set is routed to the
   * subscription OAuth lane instead (it talks direct to api.anthropic.com).
   * Keep in sync with the gateway key's actual grant.
   */
  gatewayServableModels: string[];
  /**
   * Active SDK query-options preset. `'standard'` matches behaviour shipped
   * before phase 00; `'research-safe'` is a placeholder for phase 06. Closed
   * enum — unknown values throw at boot via buildQueryOptions().
   */
  chatQueryPreset: QueryOptionsPreset;
  /**
   * Phase-01: Enable Anthropic SDK session resume — capture the SDK's
   * conversation id on the first turn and pass it back on subsequent turns so
   * the model sees its full prior thread. Default false until the staging
   * 4-cell A/B confirms cost/coherence tradeoff.
   */
  chatContextSdkResumeEnabled: boolean;
  /**
   * Daily USD budget cap for eval suites (phase 09 thread-continuity + concept
   * resolution evals). Default 50 — pending finance review for prod.
   */
  evalDailyBudgetUsd: number;
  /**
   * Judge model for LLM-as-judge scoring on eval suites. Defaults to chatModel
   * so a fresh deploy works without extra env wiring.
   */
  evalJudgeModel: string;
  /**
   * Kill-switch: when true, roll the metric ref back to the catalog path so
   * the /meta gate rejects it → clarify (the pre-consolidation behavior).
   * Default false (unified resolver is the live path). Ships for one release
   * as a rollback lever, then is removed.
   */
  chatGlossaryLegacy: boolean;
  /**
   * Confidence threshold above which a rankable concept is auto-routed into a
   * leaderboard query (`action='auto'` with assumption disclosure) instead of
   * surfacing a clarify list. Default 0.8.
   */
  chatGlossaryAutorouteThreshold: number;
  /**
   * Phase 02: enable session-focus store (context layer B). When on, the
   * compose() step injects a `## Conversation focus` block summarising
   * last metric/dimension/timeRange/artifact, surviving SDK compaction.
   * Default false until the anaphora eval gates a ramp.
   */
  chatContextFocusStoreEnabled: boolean;
  /**
   * Phase 07: register the decomposed nl-to-query helper tools (currently
   * just `parse_date_range`; `get_glossary` + `resolve_synonym` are subsumed
   * by phase 02a). Default false; flip on per-skill via the skill body
   * allowed_tools and the boot-guard validator.
   */
  chatNlqDecomposedToolsEnabled: boolean;
  /**
   * Phase 04: hard per-turn timeout in milliseconds. When > 0, the registry
   * aborts the turn with reason='timeout' after this many ms. Default 240000
   * (4 min): the mandated analytical flow (disambiguate → resolve → inspect
   * meta → preview → emit) is 5-6 inference rounds at an observed 25-37s of
   * model latency each, so 120s killed legitimate multi-step turns on
   * member-rich games. Set to 0 to disable the timeout.
   */
  chatTurnTimeoutMs: number;
  /**
   * Budget (ms) for the one-shot salvage LLM call that writes a best-effort
   * answer from the reasoning transcript when a turn hits chatTurnTimeoutMs
   * with no answer text. Falls back to a deterministic notice when the salvage
   * call itself exceeds this budget or fails. 0 disables salvage entirely
   * (timed-out turns persist a deterministic notice instead of empty text).
   */
  chatTimeoutSalvageMs: number;
  /** Emit a per-turn stage-timing log line from the /agent/turn pipeline. */
  chatTurnProfilingEnabled: boolean;
  /**
   * Phase 05: parallel-emit soak gate. When true, every turn also drives a
   * shadow TurnTracer alongside the legacy inline observer dispatch and writes
   * a per-turn diff record to runtime/parallel-emit/diffs.jsonl. The shadow
   * path only records — it never writes to the DB or Langfuse. Used to prove
   * the new tracer matches the legacy path byte-for-byte before the cutover
   * deletes the inline dispatch. Default false (zero overhead when off).
   */
  obsParallelEmitEnabled: boolean;
  /**
   * Phase 06: opt-in web search via the SDK's WebSearch built-in tool.
   * When true AND the active skill's SKILL.md sets `enable_web_search: true`,
   * WebSearch is moved from disallowedTools → allowedTools for that turn.
   * Default false — zero behaviour change when off.
   */
  chatEnableWebSearch: boolean;
  /**
   * Phase 06: opt-in research mode. When true AND the active skill's SKILL.md
   * sets `enable_research_mode: true`, the per-turn timeout is doubled to give
   * the model extra time for multi-step investigations.
   * SDK research option: inspected v0.3.150 types — no dedicated `research`
   * flag found. Timeout-doubling is the only runtime change for now.
   * Default false — zero behaviour change when off.
   */
  chatEnableResearchMode: boolean;
  /**
   * Inject a compact per-game model-graph digest (user hub + join clusters +
   * isolated cubes) into the cacheable system-prompt prefix so the agent
   * triages "which cube holds this metric / what joins to the user" without an
   * on-demand /meta round-trip. Stable per game → lands in the prompt cache.
   * Default false until the eval gates a ramp.
   */
  agentModelDigestEnabled: boolean;
  /**
   * Inject a "Resolved so far" block (entity / metric / time the session has
   * already pinned) so the agent stops re-asking what is settled, and only
   * changes it on a genuine rephrase. Reads the same disambiguation memory the
   * deterministic engine writes. Default false.
   */
  agentResolvedContextEnabled: boolean;
  /**
   * Apply the smart-default / ask-frugal asking posture (default + state
   * assumption + offer one-click correction; block-ask only for high-impact
   * ambiguity). Default false. (Wired in a later phase.)
   */
  agentSmartDefaultsEnabled: boolean;
  /**
   * Let the user-facing disambiguation toggle (targeted/aggressive) govern the
   * agent's asking posture, not just the deterministic engine gate. Default
   * false. (Wired in a later phase.)
   */
  agentModeGovernsPosture: boolean;
  /**
   * Route the agent's final resolution through the deterministic NL→query
   * engine grain gate (block wrong-grain ranking choices in code, not just
   * guidance). Default false. (Wired in a later phase.)
   */
  agentEngineRouting: boolean;
}

function parsePreset(raw: string): QueryOptionsPreset {
  if (raw === 'standard' || raw === 'research-safe') return raw;
  throw new Error(
    `CHAT_QUERY_PRESET must be 'standard' or 'research-safe', got: ${raw}`,
  );
}

const DEFAULT_SKILL_LOADER_TTL = process.env['NODE_ENV'] === 'production' ? 60_000 : 5_000;

export const config: Config = {
  port: optionalInt('PORT', 3005),
  logLevel: optional('LOG_LEVEL', 'info'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  anthropicApiStgKey: optional('ANTHROPIC_API_STG_KEY', ''),
  anthropicApiBackupKey: optional('ANTHROPIC_API_BACKUP_KEY', ''),
  anthropicSubscriptionOauthToken: optional('ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN', ''),
  anthropicKeyRetryCooldownMs: optionalInt('ANTHROPIC_KEY_RETRY_COOLDOWN_MS', 600_000),
  anthropicBaseUrl: required('ANTHROPIC_BASE_URL'),
  chatModel: optional('CHAT_MODEL', 'claude-sonnet-4-6'),
  chatMaxOutputTokens: optionalInt('CHAT_MAX_OUTPUT_TOKENS', 4096),
  serverBaseUrl: optional('SERVER_BASE_URL', 'http://localhost:3004'),
  cubeApiUrl: optional('CUBE_API_URL', 'http://localhost:4000'),
  chatDbPath: optional('CHAT_DB_PATH', './runtime/chat.db'),
  chatMaxTurnsPerSession: optionalInt('CHAT_MAX_TURNS_PER_SESSION', 40),
  chatMaxTokensPerTurn: optionalInt('CHAT_MAX_TOKENS_PER_TURN', 8000),
  skillLoaderTtlMs: optionalInt('SKILL_LOADER_TTL_MS', DEFAULT_SKILL_LOADER_TTL),
  contextBudgetTokens: optionalInt('CHAT_CONTEXT_BUDGET_TOKENS', 180_000),
  titleModel: optional('CHAT_TITLE_MODEL', 'claude-haiku-4-5-20251001'),
  briefModel: optional('CHAT_BRIEF_MODEL', 'claude-sonnet-4-6'),
  starterRefinerModel: optional('CHAT_STARTER_REFINER_MODEL', 'claude-opus-4-8'),
  rateLimitPerOwnerPerMin: optionalInt('CHAT_RATE_LIMIT_PER_OWNER_PER_MIN', 30),
  costPer1kInputUsd: optionalFloat('CHAT_COST_PER_1K_INPUT_USD', 0.003),
  costPer1kOutputUsd: optionalFloat('CHAT_COST_PER_1K_OUTPUT_USD', 0.015),
  mcpEnabled: optional('CHAT_MCP_ENABLED', 'false') === 'true',
  starterRankMinSessions: 3,
  disambigAutoThreshold: optionalFloat('CHAT_DISAMBIG_AUTO_THRESHOLD', 0.75),
  mainServerServiceToken: optional('MAIN_SERVER_SERVICE_TOKEN', ''),
  internalSecret: optional('INTERNAL_SECRET', ''),
  streamRegistryRingSize: optionalInt('STREAM_REGISTRY_RING_SIZE', 2000),
  streamRegistryMaxTurns: optionalInt('STREAM_REGISTRY_MAX_TURNS', 100),
  streamRegistryTtlMs: optionalInt('STREAM_REGISTRY_TTL_MS', 300_000),
  streamRegistrySweepIntervalMs: optionalInt('STREAM_REGISTRY_SWEEP_INTERVAL_MS', 60_000),
  langfusePublicKey: optional('LANGFUSE_PUBLIC_KEY', ''),
  langfuseSecretKey: optional('LANGFUSE_SECRET_KEY', ''),
  langfuseBaseUrl: optional('LANGFUSE_HOST', 'https://cloud.langfuse.com'),
  responseCacheEnabled: optional('RESPONSE_CACHE_ENABLED', 'false') === 'true',
  cacheServiceEnabled: optional('CACHE_SERVICE_ENABLED', 'true') === 'true',
  anthropicPromptCacheEnabled: optional('ANTHROPIC_PROMPT_CACHE_ENABLED', 'true') === 'true',
  allowedModels: optional(
    'ALLOWED_MODELS',
    'claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-6,claude-opus-4-7,claude-opus-4-8',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  gatewayServableModels: optional('GATEWAY_SERVABLE_MODELS', 'claude-sonnet-4-6')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  chatQueryPreset: parsePreset(optional('CHAT_QUERY_PRESET', 'standard')),
  chatContextSdkResumeEnabled: optional('CHAT_CONTEXT_SDK_RESUME', 'false') === 'true',
  evalDailyBudgetUsd: optionalFloat('EVAL_DAILY_BUDGET_USD', 50),
  evalJudgeModel: optional('EVAL_JUDGE_MODEL', optional('CHAT_MODEL', 'claude-sonnet-4-6')),
  chatGlossaryLegacy: optional('CHAT_GLOSSARY_LEGACY', 'false') === 'true',
  chatGlossaryAutorouteThreshold: optionalFloat('CHAT_GLOSSARY_AUTOROUTE_THRESHOLD', 0.8),
  chatContextFocusStoreEnabled: optional('CHAT_CONTEXT_FOCUS_STORE', 'false') === 'true',
  chatNlqDecomposedToolsEnabled: optional('CHAT_NLQ_DECOMPOSED_TOOLS', 'false') === 'true',
  obsParallelEmitEnabled: optional('OBS_PARALLEL_EMIT', 'false') === 'true',
  chatTurnTimeoutMs: optionalInt('CHAT_TURN_TIMEOUT_MS', 240_000),
  chatTimeoutSalvageMs: optionalInt('CHAT_TIMEOUT_SALVAGE_MS', 30_000),
  chatTurnProfilingEnabled: optional('CHAT_TURN_PROFILING', 'false') === 'true',
  chatEnableWebSearch: optional('CHAT_ENABLE_WEB_SEARCH', 'false') === 'true',
  chatEnableResearchMode: optional('CHAT_ENABLE_RESEARCH_MODE', 'false') === 'true',
  agentModelDigestEnabled: optional('AGENT_MODEL_DIGEST_ENABLED', 'false') === 'true',
  agentResolvedContextEnabled: optional('AGENT_RESOLVED_CONTEXT_ENABLED', 'false') === 'true',
  agentSmartDefaultsEnabled: optional('AGENT_SMART_DEFAULTS_ENABLED', 'false') === 'true',
  agentModeGovernsPosture: optional('AGENT_MODE_GOVERNS_POSTURE', 'false') === 'true',
  agentEngineRouting: optional('AGENT_ENGINE_ROUTING', 'false') === 'true',
};

/** True only when both Langfuse credentials are present in the environment. */
export function isLangfuseEnabled(): boolean {
  return !!(config.langfusePublicKey && config.langfuseSecretKey);
}
