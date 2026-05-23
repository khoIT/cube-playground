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
};
