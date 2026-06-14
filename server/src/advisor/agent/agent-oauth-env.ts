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

export const OAUTH_TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';

/** Thrown when no OAuth token is present — the agent cannot run without it. */
export class OAuthTokenMissingError extends Error {
  readonly code = 'oauth_missing';
  constructor() {
    super(
      `${OAUTH_TOKEN_VAR} is not set — the advisor agent runs only on the Claude ` +
        `subscription OAuth lane (gateway/API keys are intentionally disabled).`,
    );
    this.name = 'OAuthTokenMissingError';
  }
}

/**
 * Produce the clean spawn env. Copies string-valued parent vars, drops the
 * API-key/gateway set, and asserts the OAuth token is present.
 *
 * @param source defaults to process.env (overridable for tests).
 */
export function buildAgentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = source[OAUTH_TOKEN_VAR];
  if (!token || token.trim() === '') {
    throw new OAuthTokenMissingError();
  }
  const stripped = new Set<string>(STRIPPED_AUTH_VARS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (stripped.has(key)) continue;
    env[key] = value;
  }
  // Guarantee the token survived (it is not in the stripped set).
  env[OAUTH_TOKEN_VAR] = token;
  return env;
}
