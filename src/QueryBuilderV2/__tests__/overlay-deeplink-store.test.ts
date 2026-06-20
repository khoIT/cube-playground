/**
 * Tests for the durable overlay store keyed by PRIMARY query identity:
 * primaryQueryKey is stable across game-filter additions / measure ordering,
 * a saved overlay round-trips and survives re-reads (refresh + URL-rewrite
 * case), unknown keys return null, and the FIFO index caps retention.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveOverlayForPrimary,
  loadOverlayForPrimary,
  removeOverlayForPrimary,
  primaryQueryKey,
} from '../overlay-deeplink-store';

beforeEach(() => localStorage.clear());

const PRIMARY = {
  measures: ['active_daily.paying_dau'],
  timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day', dateRange: ['2026-06-11', '2026-06-20'] }],
};
const OVERLAY = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: ['2026-06-11', '2026-06-20'] }],
};

describe('primaryQueryKey', () => {
  it('is stable when a game filter is appended (filters are ignored)', () => {
    const withFilter = { ...PRIMARY, filters: [{ member: 'active_daily.game_id', operator: 'equals', values: ['cfm_vn'] }] };
    expect(primaryQueryKey(withFilter)).toBe(primaryQueryKey(PRIMARY));
  });

  it('is stable regardless of measure ordering', () => {
    const a = { measures: ['x.a', 'x.b'], timeDimensions: [] };
    const b = { measures: ['x.b', 'x.a'], timeDimensions: [] };
    expect(primaryQueryKey(a)).toBe(primaryQueryKey(b));
  });

  it('differs when the date window differs', () => {
    const other = { ...PRIMARY, timeDimensions: [{ ...PRIMARY.timeDimensions[0], dateRange: ['2026-05-01', '2026-05-10'] }] };
    expect(primaryQueryKey(other)).not.toBe(primaryQueryKey(PRIMARY));
  });
});

describe('overlay-deeplink-store (keyed by primary identity)', () => {
  it('round-trips and re-reads (refresh / URL-rewrite keeps it)', () => {
    saveOverlayForPrimary(primaryQueryKey(PRIMARY), OVERLAY);
    expect(loadOverlayForPrimary(primaryQueryKey(PRIMARY))).toEqual(OVERLAY);
    // A second read (after the URL became ?query=) still resolves — not one-shot.
    expect(loadOverlayForPrimary(primaryQueryKey(PRIMARY))).toEqual(OVERLAY);
  });

  it('returns null for an unknown primary', () => {
    expect(loadOverlayForPrimary(primaryQueryKey({ measures: ['nope.m'], timeDimensions: [] }))).toBeNull();
  });

  it('remove clears the overlay (dismiss keeps it gone on re-read) and is idempotent', () => {
    const key = primaryQueryKey(PRIMARY);
    saveOverlayForPrimary(key, OVERLAY);
    expect(loadOverlayForPrimary(key)).toEqual(OVERLAY);
    removeOverlayForPrimary(key);
    expect(loadOverlayForPrimary(key)).toBeNull();
    // Idempotent: removing an absent key is a safe no-op.
    expect(() => removeOverlayForPrimary(key)).not.toThrow();
    // Re-opening the artifact (save again under the same key) restores it.
    saveOverlayForPrimary(key, OVERLAY);
    expect(loadOverlayForPrimary(key)).toEqual(OVERLAY);
  });

  it('remove frees a retention slot (removed key no longer counts toward the cap)', () => {
    saveOverlayForPrimary('keep', { measures: ['mk'] });
    removeOverlayForPrimary('keep-not-present'); // no-op on absent key
    removeOverlayForPrimary('keep');
    // 20 fresh saves fill the cap exactly; 'keep' was removed so it isn't the
    // evicted oldest — proving remove pulled it from the index, not just storage.
    for (let i = 0; i < 20; i++) saveOverlayForPrimary(`x${i}`, { measures: [`mx${i}`] });
    expect(loadOverlayForPrimary('x0')).toEqual({ measures: ['mx0'] });
    expect(loadOverlayForPrimary('x19')).toEqual({ measures: ['mx19'] });
  });

  it('caps retention to 20 — the oldest is evicted', () => {
    for (let i = 0; i < 22; i++) saveOverlayForPrimary(`k${i}`, { measures: [`m${i}`] });
    expect(loadOverlayForPrimary('k0')).toBeNull();
    expect(loadOverlayForPrimary('k1')).toBeNull();
    expect(loadOverlayForPrimary('k21')).toEqual({ measures: ['m21'] });
    expect(loadOverlayForPrimary('k2')).toEqual({ measures: ['m2'] });
  });
});
