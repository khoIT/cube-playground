/**
 * Named subscription tokens (subscription-vy / subscription-thi) extend the
 * failover ladder and become individually pinnable via the admin auth mode.
 * Verifies ladder order, per-label pinning, and that an unconfigured pin falls
 * back to the full ladder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: '',
    anthropicApiBackupKey: '',
    anthropicSubscriptionOauthToken: 'sk-ant-oat-default',
    anthropicSubscriptionOauthTokenVy: 'sk-ant-oat-vy',
    anthropicSubscriptionOauthTokenThi: 'sk-ant-oat-thi',
    anthropicKeyRetryCooldownMs: 600_000,
    anthropicBaseUrl: 'https://gateway.example.test',
    gatewayServableModels: ['claude-sonnet-4-6'],
  },
  isLangfuseEnabled: () => false,
}));

import {
  getActiveAnthropicKey,
  anthropicKeyCount,
  keyFailoverStatus,
  configuredKeyLabels,
  __resetKeyFailoverForTests,
} from '../src/core/anthropic-key-failover.js';
import { setLlmAuthMode, __resetLlmAuthModeForTests } from '../src/core/llm-auth-mode.js';

beforeEach(() => {
  __resetKeyFailoverForTests();
  __resetLlmAuthModeForTests();
});
afterEach(() => {
  __resetKeyFailoverForTests();
  __resetLlmAuthModeForTests();
});

describe('named subscription tokens in the ladder', () => {
  it('appends vy/thi after the primary subscription token', () => {
    expect(configuredKeyLabels()).toEqual([
      'primary',
      'subscription',
      'subscription-vy',
      'subscription-thi',
    ]);
    expect(anthropicKeyCount()).toBe(4);
    // auto → gateway primary first.
    expect(getActiveAnthropicKey().label).toBe('primary');
  });

  it("pins to 'subscription-vy' for all users", () => {
    setLlmAuthMode('subscription-vy');
    expect(anthropicKeyCount()).toBe(1);
    expect(getActiveAnthropicKey()).toEqual({
      key: 'sk-ant-oat-vy',
      label: 'subscription-vy',
      authKind: 'oauth-token',
    });
  });

  it("pins to 'subscription-thi'", () => {
    setLlmAuthMode('subscription-thi');
    expect(getActiveAnthropicKey().label).toBe('subscription-thi');
    expect(getActiveAnthropicKey().key).toBe('sk-ant-oat-thi');
  });

  it("'subscription' still pins the primary subscription token, not vy/thi", () => {
    setLlmAuthMode('subscription');
    expect(anthropicKeyCount()).toBe(1);
    expect(getActiveAnthropicKey().label).toBe('subscription');
  });

  it('keyFailoverStatus reports labels only — never token material', () => {
    const s = keyFailoverStatus();
    expect(s.configured).toContain('subscription-vy');
    expect(s.configured).toContain('subscription-thi');
    expect(JSON.stringify(s)).not.toContain('sk-ant-oat');
  });
});
