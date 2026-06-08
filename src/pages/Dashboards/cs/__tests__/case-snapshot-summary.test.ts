/**
 * Snapshot → readable "why it fired" summary. Guards the regression where a
 * stored ThresholdRule object rendered as "[object Object]".
 */

import { describe, it, expect } from 'vitest';
import { summarizeSnapshot, summarizeRule } from '../case-snapshot-summary';

describe('summarizeRule', () => {
  it('abs rule → member, operator symbol, currency value', () => {
    expect(summarizeRule({ kind: 'abs', member: 'user_profile.ltv_total_vnd', op: 'gte', value: 10_000_000 }))
      .toBe('ltv_total_vnd ≥ ₫10M');
  });
  it('abs rule → grouped number for non-currency member', () => {
    expect(summarizeRule({ kind: 'abs', member: 'mf_users.days_since_last_active', op: 'gte', value: 3 }))
      .toBe('days_since_last_active ≥ 3');
  });
  it('tierStep → top band label', () => {
    expect(summarizeRule({ kind: 'tierStep', member: 'user_profile.max_vip_level', bands: [{ label: 'Gold', min: 1 }, { label: 'Diamond', min: 5 }] }))
      .toBe('max_vip_level tier reached · Diamond');
  });
  it('event → window phrase', () => {
    expect(summarizeRule({ kind: 'event', member: 'user_profile.first_recharge_date', window: 'last 24 hours' }))
      .toBe('first_recharge_date in last 24 hours');
  });
  it('percentile → P-notation', () => {
    expect(summarizeRule({ kind: 'percentile', of: 'user_profile.ltv_vnd', p: 90 })).toBe('ltv_vnd ≥ P90');
  });
  it('ratio → member vs baseline', () => {
    expect(summarizeRule({ kind: 'ratio', member: 'user_recharge_daily.revenue_7d', vs: 'user_recharge_daily.revenue_30d_avg', op: 'lt', value: 0.5 }))
      .toBe('revenue_7d vs revenue_30d_avg < 0.5');
  });
});

describe('summarizeSnapshot', () => {
  it('renders the threshold rule, never "[object Object]"', () => {
    const raw = JSON.stringify({ matched_at: '2026-06-08T18:14:36.196Z', threshold: { kind: 'abs', member: 'user_profile.ltv_vnd', op: 'gte', value: 50_000_000 } });
    const out = summarizeSnapshot(raw);
    expect(out).toBe('ltv_vnd ≥ ₫50M');
    expect(out).not.toContain('[object Object]');
  });
  it('falls back to scalar stats, skipping matched_at', () => {
    const raw = JSON.stringify({ matched_at: '2026-06-08T00:00:00Z', ltv_vnd: 944000000, days_idle: 12 });
    expect(summarizeSnapshot(raw)).toBe('ltv_vnd: 944000000 · days_idle: 12');
  });
  it('null / invalid JSON → null', () => {
    expect(summarizeSnapshot(null)).toBeNull();
    expect(summarizeSnapshot('{not json')).toBeNull();
  });
  it('empty object → "matched"', () => {
    expect(summarizeSnapshot('{}')).toBe('matched');
  });
});
