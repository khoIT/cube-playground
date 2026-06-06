/**
 * Key-failover rotation rules: primary → stg → backup on balance exhaustion,
 * cooldown re-arm, all-exhausted fallback, and the balance-error matcher
 * (verified against the live LiteLLM gateway error text).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    anthropicApiKey: 'key-primary',
    anthropicApiStgKey: 'key-stg',
    anthropicApiBackupKey: 'key-backup',
    anthropicKeyRetryCooldownMs: 600_000,
  },
  isLangfuseEnabled: () => false,
}));

import {
  getActiveAnthropicKey,
  reportKeyBalanceExhausted,
  isBalanceExhaustedError,
  anthropicKeyCount,
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

  it('hands out the primary key first; counts all configured keys', () => {
    expect(anthropicKeyCount()).toBe(3);
    expect(getActiveAnthropicKey()).toEqual({ key: 'key-primary', label: 'primary' });
  });

  it('rotates primary → stg → backup as keys are reported exhausted', () => {
    let r = reportKeyBalanceExhausted('key-primary');
    expect(r).toEqual({ rotated: true, nextLabel: 'stg' });
    expect(getActiveAnthropicKey().label).toBe('stg');

    r = reportKeyBalanceExhausted('key-stg');
    expect(r).toEqual({ rotated: true, nextLabel: 'backup' });
    expect(getActiveAnthropicKey().label).toBe('backup');
  });

  it('reports rotated:false when the last key drains — but still returns a key', () => {
    reportKeyBalanceExhausted('key-primary');
    reportKeyBalanceExhausted('key-stg');
    const r = reportKeyBalanceExhausted('key-backup');
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
      active: 'stg',
      configured: ['primary', 'stg', 'backup'],
      exhausted: ['primary'],
    });
    expect(JSON.stringify(s)).not.toContain('key-');
  });
});
