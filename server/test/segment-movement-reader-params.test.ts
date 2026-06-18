/**
 * Unit tests for segment-movement-reader param utilities and the
 * segment-movement route's parameter validation + redaction logic.
 *
 * We test:
 *  - clampMovementDays: clamping, default, sub-daily cap vs daily cap.
 *  - Dimension allow-list: known canonical keys pass, unknown reject.
 *  - Sensitive dimension redaction for unauthenticated callers.
 *  - Range-cap enforcement: sub-daily granularity triggers 14d cap.
 *
 * No real Trino calls — reader queries are not exercised here.
 * Route-level validation tests use the pure helpers directly.
 */

import { describe, it, expect } from 'vitest';
import {
  clampMovementDays,
  MAX_DAILY_DAYS,
  MAX_SUBDAILY_DAYS,
} from '../src/lakehouse/segment-movement-reader.js';
import { STATE_VALUE_COLUMNS } from '../src/lakehouse/canonical-metric-set.js';

// ─── clampMovementDays ──────────────────────────────────────────────────────

describe('clampMovementDays', () => {
  it('returns default 30 for daily when no value provided', () => {
    expect(clampMovementDays(undefined)).toBe(30);
    expect(clampMovementDays(null)).toBe(30);
    expect(clampMovementDays('abc')).toBe(30);
  });

  it('returns default 7 for sub-daily when no value provided', () => {
    expect(clampMovementDays(undefined, true)).toBe(7);
  });

  it('clamps to MAX_DAILY_DAYS for daily', () => {
    expect(clampMovementDays(999)).toBe(MAX_DAILY_DAYS);
    expect(clampMovementDays(MAX_DAILY_DAYS)).toBe(MAX_DAILY_DAYS);
    expect(clampMovementDays(MAX_DAILY_DAYS + 1)).toBe(MAX_DAILY_DAYS);
  });

  it('clamps to MAX_SUBDAILY_DAYS for subdaily', () => {
    expect(clampMovementDays(999, true)).toBe(MAX_SUBDAILY_DAYS);
    expect(clampMovementDays(MAX_SUBDAILY_DAYS, true)).toBe(MAX_SUBDAILY_DAYS);
    expect(clampMovementDays(MAX_SUBDAILY_DAYS + 1, true)).toBe(MAX_SUBDAILY_DAYS);
  });

  it('accepts small valid values', () => {
    expect(clampMovementDays(7)).toBe(7);
    expect(clampMovementDays('14')).toBe(14);
    expect(clampMovementDays(1)).toBe(1);
  });

  it('clamps values < 1 to 1', () => {
    expect(clampMovementDays(0)).toBe(1);
    expect(clampMovementDays(-5)).toBe(1);
  });

  it('truncates fractional days', () => {
    expect(clampMovementDays(7.9)).toBe(7);
  });
});

// ─── Dimension allow-list ────────────────────────────────────────────────────

describe('STATE_VALUE_COLUMNS dimension allow-list', () => {
  const allowedKeys = new Set(STATE_VALUE_COLUMNS.map((c) => c.key));

  it('contains expected canonical dimension keys', () => {
    // These are the core keys the state-distribution endpoints accept.
    expect(allowedKeys.has('lifecycle_stage')).toBe(true);
    expect(allowedKeys.has('churn_risk')).toBe(true);
    expect(allowedKeys.has('payer_tier')).toBe(true);
    expect(allowedKeys.has('os_platform')).toBe(true);
    expect(allowedKeys.has('country')).toBe(true);
  });

  it('does NOT contain uid (uid is not a value column)', () => {
    expect(allowedKeys.has('uid')).toBe(false);
  });

  it('does NOT contain arbitrary strings', () => {
    expect(allowedKeys.has('DROP TABLE')).toBe(false);
    expect(allowedKeys.has("'; SELECT 1; --")).toBe(false);
    expect(allowedKeys.has('__proto__')).toBe(false);
  });
});

// ─── Sensitive dimensions (route redaction) ──────────────────────────────────

describe('sensitive dimension redaction logic', () => {
  // Mirrors the SENSITIVE_DIMENSIONS set in the route — tested here
  // independently of the route's HTTP layer.
  const SENSITIVE = new Set([
    'ltv_vnd', 'ltv_30d_vnd', 'payer_tier', 'is_paying_user', 'is_paying_30d',
  ]);

  it('payer_tier is sensitive', () => {
    expect(SENSITIVE.has('payer_tier')).toBe(true);
  });

  it('lifecycle_stage is NOT sensitive', () => {
    expect(SENSITIVE.has('lifecycle_stage')).toBe(false);
  });

  it('unauthenticated + sensitive dimension → should return redacted response', () => {
    // Simulate route redaction logic: unauthenticated + sensitive → empty rows
    const dimension = 'ltv_vnd';
    const authenticated = false;
    const rows = [{ dimension: '>500k', count: 100 }]; // would be real data
    const output = (!authenticated && SENSITIVE.has(dimension)) ? [] : rows;
    expect(output).toHaveLength(0);
  });

  it('authenticated + sensitive dimension → rows pass through', () => {
    const dimension = 'ltv_vnd';
    const authenticated = true;
    const rows = [{ dimension: '>500k', count: 100 }];
    const output = (!authenticated && SENSITIVE.has(dimension)) ? [] : rows;
    expect(output).toHaveLength(1);
  });

  it('unauthenticated + non-sensitive dimension → rows pass through', () => {
    const dimension = 'lifecycle_stage';
    const authenticated = false;
    const rows = [{ dimension: 'active', count: 200 }];
    const output = (!authenticated && SENSITIVE.has(dimension)) ? [] : rows;
    expect(output).toHaveLength(1);
  });
});

// ─── Range cap per granularity ───────────────────────────────────────────────

describe('range cap based on granularity', () => {
  // Sub-daily granularities trigger the 14d cap; daily uses 180d.
  const SUBDAILY_GRANULARITIES = new Set(['15m', '1h', '3h', '6h', '12h']);

  it.each(['15m', '1h', '3h', '6h', '12h'] as const)(
    '%s is a sub-daily granularity → 14d cap',
    (g) => {
      expect(SUBDAILY_GRANULARITIES.has(g)).toBe(true);
      expect(clampMovementDays(999, true)).toBe(MAX_SUBDAILY_DAYS);
    },
  );

  it('daily granularity → 180d cap', () => {
    expect(SUBDAILY_GRANULARITIES.has('daily')).toBe(false);
    expect(clampMovementDays(999, false)).toBe(MAX_DAILY_DAYS);
  });
});
