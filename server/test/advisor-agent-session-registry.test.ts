/**
 * Registry lifecycle: create / resume / drop / TTL-evict / status. We set a
 * dummy OAuth token so session creation succeeds, and never run a turn (which
 * would spawn the SDK subprocess and need real auth).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentSessionRegistry } from '../src/advisor/agent/agent-session-registry.js';
import type { SessionOpts } from '../src/advisor/agent/agent-types.js';

const OPTS: SessionOpts = {
  scope: { kind: 'segment', segmentId: 'seg-x', gameId: 'cfm_vn' },
  goal: 'revenue',
  ctx: { cubeApiUrl: 'http://stub', token: null },
};

beforeEach(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
});
afterEach(() => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

describe('AgentSessionRegistry', () => {
  it('create then get returns the same session', () => {
    const reg = new AgentSessionRegistry();
    const s = reg.create(OPTS);
    expect(reg.get(s.id)).toBe(s);
    expect(reg.size()).toBe(1);
  });

  it('drop aborts and removes', () => {
    const reg = new AgentSessionRegistry();
    const s = reg.create(OPTS);
    reg.drop(s.id);
    expect(s.isClosed()).toBe(true);
    expect(reg.get(s.id)).toBeUndefined();
    expect(reg.size()).toBe(0);
  });

  it('evicts expired sessions (ttl elapsed)', () => {
    const reg = new AgentSessionRegistry(-1); // everything is immediately stale
    const s = reg.create(OPTS);
    expect(reg.get(s.id)).toBeUndefined(); // get sees it expired → drops it
  });

  it('exposes a PII-free status snapshot', () => {
    const reg = new AgentSessionRegistry();
    const s = reg.create(OPTS);
    const status = reg.status(s.id);
    expect(status).toMatchObject({
      sessionId: s.id,
      goal: 'revenue',
      turns: 0,
      totalCostUsd: 0,
      busy: false,
    });
  });

  it('propagates OAuthTokenMissingError when no token', () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const reg = new AgentSessionRegistry();
    expect(() => reg.create(OPTS)).toThrow();
  });
});
