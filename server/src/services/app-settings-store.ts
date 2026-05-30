/**
 * Tiny key-value store for app settings.
 *
 * - Reads pass through an in-memory cache with a 30s TTL so cron tick paths
 *   don't repeatedly hit sqlite for the same value.
 * - Writes bump a monotonic version + invalidate the cache, so consumers can
 *   detect changes without polling.
 * - Each key has a clamp/validator so a misbehaving UI can't push a 1-second
 *   TTL into the database.
 */

import { getDb } from '../db/sqlite.js';

export type SettingsKey =
  | 'liveops.kpi_refresh_seconds'
  | 'liveops.cache_ttl_seconds'
  | 'liveops.anomaly_detector_enabled'
  | 'liveops.anomaly_thresholds'
  | 'dashboards.tile_ttl_seconds'
  | 'dashboards.refresh_horizon_days'
  | 'dashboards.refresh_concurrency'
  // Onboarding agent — Phase 07 intelligence layer, default OFF so the
  // heuristic v1 pipeline is unchanged when these are unset.
  | 'onboarding.llmEnrichment'
  | 'onboarding.goldenSeeding';

const CACHE_TTL_MS = 30_000;

interface CacheEntry { value: unknown; fetchedAt: number }
const cache = new Map<SettingsKey, CacheEntry>();
let version = 0;

export function getSettingsVersion(): number { return version; }

function readRaw(key: SettingsKey): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function getSetting<T = unknown>(key: SettingsKey, fallback: T): T {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value as T;
  }
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try {
    const value = JSON.parse(raw) as T;
    cache.set(key, { value, fetchedAt: Date.now() });
    return value;
  } catch {
    return fallback;
  }
}

export function listAllSettings(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* skip malformed */ }
  }
  return out;
}

interface ValidatorOk { ok: true; value: unknown }
interface ValidatorErr { ok: false; message: string }
type ValidatorResult = ValidatorOk | ValidatorErr;

function clampNumber(value: unknown, min: number, max: number): ValidatorResult {
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, message: 'value must be a number' };
  return { ok: true, value: Math.max(min, Math.min(max, Math.round(n))) };
}

function validateTtlMap(value: unknown): ValidatorResult {
  if (typeof value !== 'object' || value == null) {
    return { ok: false, message: 'value must be an object' };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!['kpi_strip', 'cohort_grid', 'funnel_result'].includes(k)) {
      return { ok: false, message: `unknown resource ${k}` };
    }
    const clamped = clampNumber(v, 30, 86_400);
    if (!clamped.ok) return clamped;
    out[k] = clamped.value as number;
  }
  return { ok: true, value: out };
}

function validateThresholds(value: unknown): ValidatorResult {
  if (typeof value !== 'object' || value == null) {
    return { ok: false, message: 'value must be an object' };
  }
  const m = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const sev of ['low', 'med', 'high']) {
    if (m[sev] == null) return { ok: false, message: `missing threshold "${sev}"` };
    const clamped = clampNumber(m[sev], 1, 10);
    if (!clamped.ok) return clamped;
    out[sev] = clamped.value as number;
  }
  return { ok: true, value: out };
}

const VALIDATORS: Record<SettingsKey, (v: unknown) => ValidatorResult> = {
  'liveops.kpi_refresh_seconds':      (v) => clampNumber(v, 15, 300),
  'liveops.cache_ttl_seconds':        validateTtlMap,
  'liveops.anomaly_detector_enabled': (v) => ({ ok: true, value: Boolean(v) }),
  'liveops.anomaly_thresholds':       validateThresholds,
  'dashboards.tile_ttl_seconds':      (v) => clampNumber(v, 30, 86_400),
  'dashboards.refresh_horizon_days':  (v) => clampNumber(v, 1, 90),
  'dashboards.refresh_concurrency':   (v) => clampNumber(v, 1, 100),
  'onboarding.llmEnrichment':         (v) => ({ ok: true, value: Boolean(v) }),
  'onboarding.goldenSeeding':         (v) => ({ ok: true, value: Boolean(v) }),
};

export interface PatchResult {
  ok: boolean;
  message?: string;
  value?: unknown;
}

export function patchSetting(key: SettingsKey | string, rawValue: unknown): PatchResult {
  const validator = VALIDATORS[key as SettingsKey];
  if (!validator) return { ok: false, message: `unknown setting key ${key}` };
  const result = validator(rawValue);
  if (!result.ok) return { ok: false, message: result.message };

  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(result.value), new Date().toISOString());
  cache.delete(key as SettingsKey);
  version += 1;
  return { ok: true, value: result.value };
}

/** Test-only reset. */
export function __resetAppSettingsCache(): void {
  cache.clear();
  version = 0;
}
