/**
 * Key-failover rotation rules: primary → stg → backup → subscription on
 * balance exhaustion, cooldown re-arm, all-exhausted fallback, the
 * balance-error matcher (verified against the live LiteLLM gateway error
 * text), and per-auth-kind env construction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: 'key-stg',
    anthropicApiBackupKey: 'key-backup',
    anthropicSubscriptionOauthToken: 'sk-ant-oat-subscription',
    anthropicKeyRetryCooldownMs: 600_000,
    anthropicBaseUrl: 'https://gateway.example.test',
    gatewayServableModels: ['claude-sonnet-4-6'],
  },
  isLangfuseEnabled: () => false,
}));

import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  isBalanceExhaustedError,
  anthropicKeyCount,
  anthropicAuthEnvFor,
  keyFailoverStatus,
  __resetKeyFailoverForTests,
} from '../src/core/anthropic-key-failover.js';

describe('isBalanceExhaustedError', () => {
  it('matches the live gateway low-balance error (Anthropic upstream via LiteLLM)', () => {
    const live =
      '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}. Received Model Group=claude-sonnet-4-6';
    expect(isBalanceExhaustedError(live)).toBe(true);
  });

  it('matches LiteLLM per-key budget errors', () => {
    expect(isBalanceExhaustedError('ExceededBudget: Crossed spend within team')).toBe(true);
    expect(isBalanceExhaustedError('Budget has been exceeded! Current cost: 12, Max budget: 10')).toBe(true);
  });

  it('matches the Claude subscription 5-hour usage-window error', () => {
    expect(isBalanceExhaustedError('Claude AI usage limit reached|1764000000')).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(isBalanceExhaustedError('API Error: 403 Forbidden')).toBe(false);
    expect(isBalanceExhaustedError('rate limit exceeded')).toBe(false);
    expect(isBalanceExhaustedError('model not found')).toBe(false);
    expect(isBalanceExhaustedError(null)).toBe(false);
    expect(isBalanceExhaustedError(undefined)).toBe(false);
  });
});

describe('key rotation', () => {
  beforeEach(() => {
    __resetKeyFailoverForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetKeyFailoverForTests();
  });

  it('hands out the primary key first; counts all configured slots', () => {
    expect(anthropicKeyCount()).toBe(4);
    expect(getActiveAnthropicKey()).toEqual({
      key: 'key-primary',
      label: 'primary',
      authKind: 'gateway-key',
    });
  });

  it('rotates primary → stg → backup → subscription as slots are reported exhausted', () => {
    let r = reportKeyBalanceExhausted('key-primary');
    expect(r).toEqual({ rotated: true, nextLabel: 'stg' });
    expect(getActiveAnthropicKey().label).toBe('stg');

    r = reportKeyBalanceExhausted('key-stg');
    expect(r).toEqual({ rotated: true, nextLabel: 'backup' });
    expect(getActiveAnthropicKey().label).toBe('backup');

    r = reportKeyBalanceExhausted('key-backup');
    expect(r).toEqual({ rotated: true, nextLabel: 'subscription' });
    expect(getActiveAnthropicKey()).toEqual({
      key: 'sk-ant-oat-subscription',
      label: 'subscription',
      authKind: 'oauth-token',
    });
  });

  it('reports rotated:false when the last slot drains — but still returns a key', () => {
    reportKeyBalanceExhausted('key-primary');
    reportKeyBalanceExhausted('key-stg');
    reportKeyBalanceExhausted('key-backup');
    const r = reportKeyBalanceExhausted('sk-ant-oat-subscription');
    expect(r.rotated).toBe(false);
    // All exhausted → least-recently-failed (primary) is handed out.
    expect(getActiveAnthropicKey().label).toBe('primary');
  });

  it('re-arms an exhausted key after the cooldown (auto-recover after top-up)', () => {
    reportKeyBalanceExhausted('key-primary');
    expect(getActiveAnthropicKey().label).toBe('stg');

    vi.advanceTimersByTime(600_001);
    expect(getActiveAnthropicKey().label).toBe('primary');
  });

  it('a stale report for an already-rotated key does not knock out the promoted key', () => {
    reportKeyBalanceExhausted('key-primary');
    // A racing caller re-reports the already-rotated-away primary: the
    // promoted key stays active and the caller is pointed at it.
    const r = reportKeyBalanceExhausted('key-primary');
    expect(getActiveAnthropicKey().label).toBe('stg');
    expect(r).toEqual({ rotated: true, nextLabel: 'stg' });
  });

  it('reporting an unknown key is a no-op', () => {
    expect(reportKeyBalanceExhausted('not-a-configured-key')).toEqual({ rotated: false });
    expect(getActiveAnthropicKey().label).toBe('primary');
  });

  it('keyFailoverStatus exposes labels only', () => {
    reportKeyBalanceExhausted('key-primary');
    const s = keyFailoverStatus();
    expect(s).toEqual({
      mode: 'auto',
      active: 'stg',
      configured: ['primary', 'stg', 'backup', 'subscription'],
      exhausted: ['primary'],
    });
    expect(JSON.stringify(s)).not.toContain('key-');
    expect(JSON.stringify(s)).not.toContain('sk-ant-oat');
  });
});

describe('model-aware lane routing', () => {
  beforeEach(() => {
    __resetKeyFailoverForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetKeyFailoverForTests();
  });

  it('a gateway-servable model (sonnet) uses the gateway-first ladder', () => {
    expect(anthropicKeyCount('claude-sonnet-4-6')).toBe(4);
    expect(getActiveAnthropicKey('claude-sonnet-4-6').label).toBe('primary');
  });

  it('a gateway-unservable model (opus) routes straight to the OAuth lane', () => {
    // Gateway key is sonnet-only, so opus must skip all gateway slots and run
    // on the subscription OAuth token — no wasted 403s, no failover needed.
    expect(anthropicKeyCount('claude-opus-4-8')).toBe(1);
    expect(getActiveAnthropicKey('claude-opus-4-8')).toEqual({
      key: 'sk-ant-oat-subscription',
      label: 'subscription',
      authKind: 'oauth-token',
    });
  });

  it('no model arg preserves the legacy gateway-first behaviour', () => {
    expect(getActiveAnthropicKey().label).toBe('primary');
  });

  it('exhausting the OAuth lane for an opus turn reports no rotation (no gateway fallback)', () => {
    // The subscription slot draining must NOT point an opus turn back at a
    // gateway key that can only 403 it.
    const r = reportKeyBalanceExhausted('sk-ant-oat-subscription', 'claude-opus-4-8');
    expect(r.rotated).toBe(false);
  });
});

describe('anthropicAuthEnvFor', () => {
  it('gateway slots get ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL', () => {
    expect(
      anthropicAuthEnvFor({ key: 'key-primary', label: 'primary', authKind: 'gateway-key' }),
    ).toEqual({
      ANTHROPIC_API_KEY: 'key-primary',
      ANTHROPIC_BASE_URL: 'https://gateway.example.test',
    });
  });

  it('the subscription slot gets CLAUDE_CODE_OAUTH_TOKEN only — no base-url override', () => {
    const env = anthropicAuthEnvFor({
      key: 'sk-ant-oat-subscription',
      label: 'subscription',
      authKind: 'oauth-token',
    });
    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-subscription' });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL');
  });
});
