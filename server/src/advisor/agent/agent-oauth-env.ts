/**
 * Builds the environment handed to the SDK's spawned subprocess so the
 * subscription OAuth lane ALWAYS wins.
 *
 * The SDK reads credentials from env only, and an API key out-ranks the OAuth
 * token. So we hand the subprocess a CLEAN copy of the parent env with every
 * API-key / gateway / cloud-lane variable removed, keeping only the OAuth
 * token. This is done via the SDK's per-query `env` option — we never mutate
 * the long-lived server's global process.env.
 */

/** Vars that would route the agent away from the OAuth lane — always stripped. */
export const STRIPPED_AUTH_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

/** The canonical name the SDK subprocess reads the subscription token from. */
export const OAUTH_TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';

/**
 * Accepted source names for the subscription token, in precedence order. The
 * SDK only recognizes CLAUDE_CODE_OAUTH_TOKEN, but Vault provisions the secret
 * under the more descriptive ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN — so we accept
 * either at the source and always inject it under the canonical name below.
 */
export const OAUTH_TOKEN_SOURCE_VARS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN',
] as const;

/** Thrown when no OAuth token is present — the agent cannot run without it. */
export class OAuthTokenMissingError extends Error {
  readonly code = 'oauth_missing';
  constructor() {
    super(
      `No subscription OAuth token found (looked for ${OAUTH_TOKEN_SOURCE_VARS.join(' / ')}) — ` +
        `the advisor agent runs only on the Claude subscription OAuth lane ` +
        `(gateway/API keys are intentionally disabled).`,
    );
    this.name = 'OAuthTokenMissingError';
  }
}

/** Resolve the token from any accepted source var (first non-empty wins). */
export function resolveOAuthToken(source: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of OAUTH_TOKEN_SOURCE_VARS) {
    const v = source[name];
    if (v && v.trim() !== '') return v;
  }
  return undefined;
}

/**
 * The credential lane the agent actually ran on, recorded on each run for the
 * audit console. The advisor pins the Claude subscription OAuth lane (gateway /
 * API keys are stripped in buildAgentEnv), so `lane` is always 'subscription'
 * today — but `source` tells WHICH env var carried the token, and recording the
 * lane explicitly is what lets a $0.00 cost read as "subscription flat-rate"
 * rather than "free". `source` is null only when no token resolved (the agent
 * would have failed to start, but the resolver itself never throws).
 */
export interface AuthLane {
  lane: 'subscription';
  source: (typeof OAUTH_TOKEN_SOURCE_VARS)[number] | null;
}

export function resolveAuthLane(source: NodeJS.ProcessEnv = process.env): AuthLane {
  for (const name of OAUTH_TOKEN_SOURCE_VARS) {
    const v = source[name];
    if (v && v.trim() !== '') return { lane: 'subscription', source: name };
  }
  return { lane: 'subscription', source: null };
}

/**
 * Produce the clean spawn env. Copies string-valued parent vars, drops the
 * API-key/gateway set, and asserts the OAuth token is present.
 *
 * @param source defaults to process.env (overridable for tests).
 */
export function buildAgentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = resolveOAuthToken(source);
  if (!token) {
    throw new OAuthTokenMissingError();
  }
  const stripped = new Set<string>(STRIPPED_AUTH_VARS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (stripped.has(key)) continue;
    env[key] = value;
  }
  // Always expose the token under the canonical name the SDK reads, regardless
  // of which source var (Vault's ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN or the
  // canonical CLAUDE_CODE_OAUTH_TOKEN) actually carried it.
  env[OAUTH_TOKEN_VAR] = token;
  return env;
}
