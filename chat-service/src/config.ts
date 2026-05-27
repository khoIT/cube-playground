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
   * aborts the turn with reason='timeout' after this many ms. Default 120000
   * (2 min). Set to 0 to disable the timeout.
   */
  chatTurnTimeoutMs: number;
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
  rateLimitPerOwnerPerMin: optionalInt('CHAT_RATE_LIMIT_PER_OWNER_PER_MIN', 30),
  costPer1kInputUsd: optionalFloat('CHAT_COST_PER_1K_INPUT_USD', 0.003),
  costPer1kOutputUsd: optionalFloat('CHAT_COST_PER_1K_OUTPUT_USD', 0.015),
  mcpEnabled: optional('CHAT_MCP_ENABLED', 'false') === 'true',
  starterRankMinSessions: 3,
  disambigAutoThreshold: optionalFloat('CHAT_DISAMBIG_AUTO_THRESHOLD', 0.75),
  mainServerServiceToken: optional('MAIN_SERVER_SERVICE_TOKEN', ''),
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
    'claude-sonnet-4-6,claude-haiku-4-5,claude-opus-4-6,claude-opus-4-7',
  )
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
  chatTurnTimeoutMs: optionalInt('CHAT_TURN_TIMEOUT_MS', 120_000),
  chatEnableWebSearch: optional('CHAT_ENABLE_WEB_SEARCH', 'false') === 'true',
  chatEnableResearchMode: optional('CHAT_ENABLE_RESEARCH_MODE', 'false') === 'true',
};

/** True only when both Langfuse credentials are present in the environment. */
export function isLangfuseEnabled(): boolean {
  return !!(config.langfusePublicKey && config.langfuseSecretKey);
}
