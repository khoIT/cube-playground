/**
 * Tests for app-settings-store: defaults are seeded, PATCH validates + clamps.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'app-settings-store-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import {
  getSetting,
  listAllSettings,
  patchSetting,
  __resetAppSettingsCache,
} from '../src/services/app-settings-store.js';

let db: ReturnType<typeof getDb>;
beforeAll(() => { db = getDb(); });
afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  // Reset DB rows to migration defaults so test order doesn't carry state
  // between cases (the seeded INSERTs are idempotent so re-running them after
  // a DELETE restores the original values).
  db.exec('DELETE FROM app_settings');
  db.exec(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('liveops.kpi_refresh_seconds',      '45'),
      ('liveops.cache_ttl_seconds',        '{"kpi_strip":300,"cohort_grid":300,"funnel_result":300}'),
      ('liveops.anomaly_detector_enabled', 'true'),
      ('liveops.anomaly_thresholds',       '{"low":2,"med":3,"high":4}'),
      ('dashboards.tile_ttl_seconds',      '300'),
      ('dashboards.refresh_horizon_days',  '7'),
      ('dashboards.refresh_concurrency',   '30');
  `);
  __resetAppSettingsCache();
});

describe('seeded defaults', () => {
  it('exposes liveops.kpi_refresh_seconds with seed value', () => {
    expect(getSetting<number>('liveops.kpi_refresh_seconds', 0)).toBe(45);
  });

  it('exposes liveops.cache_ttl_seconds as the seeded map', () => {
    const v = getSetting<Record<string, number>>('liveops.cache_ttl_seconds', {});
    expect(v.kpi_strip).toBe(300);
    expect(v.cohort_grid).toBe(300);
    expect(v.funnel_result).toBe(300);
  });

  it('lists all settings as parsed JSON', () => {
    const all = listAllSettings();
    expect(all['dashboards.refresh_horizon_days']).toBe(7);
    expect(all['liveops.anomaly_detector_enabled']).toBe(true);
  });
});

describe('patchSetting validation', () => {
  it('clamps refresh interval into [15, 300]', () => {
    const small = patchSetting('liveops.kpi_refresh_seconds', 5);
    expect(small.ok).toBe(true);
    expect(small.value).toBe(15);
    const large = patchSetting('liveops.kpi_refresh_seconds', 99_999);
    expect(large.ok).toBe(true);
    expect(large.value).toBe(300);
  });

  it('rejects unknown settings keys', () => {
    const res = patchSetting('not.a.thing', 1);
    expect(res.ok).toBe(false);
  });

  it('rejects unknown resource in cache_ttl_seconds map', () => {
    const res = patchSetting('liveops.cache_ttl_seconds', { bogus: 60 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/unknown resource/);
  });

  it('clamps tile TTL into [30, 86400]', () => {
    const res = patchSetting('dashboards.tile_ttl_seconds', 1);
    expect(res.ok).toBe(true);
    expect(res.value).toBe(30);
  });

  it('writes propagate to getSetting and listAllSettings', () => {
    patchSetting('dashboards.refresh_horizon_days', 14);
    expect(getSetting<number>('dashboards.refresh_horizon_days', 0)).toBe(14);
    const all = listAllSettings();
    expect(all['dashboards.refresh_horizon_days']).toBe(14);
  });
});
