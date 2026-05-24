/**
 * Configuration module — reads process.env, validates required vars, exposes typed Config.
 * Import 'dotenv/config' side-effect to load .env before accessing process.env.
 */

import 'dotenv/config';

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
  mainServerServiceToken: optional('MAIN_SERVER_SERVICE_TOKEN', ''),
};
