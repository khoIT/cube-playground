/**
 * The OAuth env builder is the correctness core of the subscription-lane
 * guarantee: the spawned subprocess must see the OAuth token and NOT any
 * API-key/gateway var, so the OAuth lane always wins SDK auth precedence.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAgentEnv,
  OAuthTokenMissingError,
  STRIPPED_AUTH_VARS,
  OAUTH_TOKEN_VAR,
} from '../src/advisor/agent/agent-oauth-env.js';

describe('buildAgentEnv', () => {
  it('throws when the OAuth token is absent', () => {
    expect(() => buildAgentEnv({ PATH: '/usr/bin' })).toThrow(OAuthTokenMissingError);
  });

  it('throws when the OAuth token is blank', () => {
    expect(() => buildAgentEnv({ [OAUTH_TOKEN_VAR]: '   ' })).toThrow(OAuthTokenMissingError);
  });

  it('strips every API-key / gateway var even when also set', () => {
    const source: NodeJS.ProcessEnv = {
      [OAUTH_TOKEN_VAR]: 'oauth-abc',
      PATH: '/usr/bin',
      HOME: '/home/x',
    };
    for (const v of STRIPPED_AUTH_VARS) source[v] = 'should-be-removed';

    const env = buildAgentEnv(source);

    for (const v of STRIPPED_AUTH_VARS) expect(env[v]).toBeUndefined();
    expect(env[OAUTH_TOKEN_VAR]).toBe('oauth-abc');
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/x');
  });

  it('keeps the OAuth token even though ANTHROPIC_API_KEY is present (precedence override)', () => {
    const env = buildAgentEnv({ [OAUTH_TOKEN_VAR]: 'tok', ANTHROPIC_API_KEY: 'sk-ant-xyz' });
    expect(env[OAUTH_TOKEN_VAR]).toBe('tok');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
