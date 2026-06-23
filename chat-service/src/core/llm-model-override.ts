/**
 * Admin-selectable global chat model override — forces every /agent/turn to a
 * single model for ALL users, regardless of the per-request X-Model header.
 *
 *   - null (default) → no override; turn.ts resolveModel() honours the caller's
 *     X-Model header, else falls back to config.chatModel.
 *   - a model id     → that model is used for every turn (validated against
 *     config.allowedModels at read time, so a stale stored id silently
 *     no-ops rather than breaking turns).
 *
 * Mirrors llm-auth-mode.ts: process-wide, persisted in chat.db's kv_cache
 * (kind='runtime_setting') so an admin toggle survives a restart. The lane that
 * actually serves the model is still chosen by anthropic-key-failover.ts — a
 * gateway-unservable model (e.g. opus) auto-routes to the OAuth lane.
 *
 * Persistence is injected at boot via initLlmModelOverride(db); the module stays
 * import-safe for tests/scripts that never open the DB (override stays null).
 */

import type Database from 'better-sqlite3';

const KV_KIND = 'runtime_setting';
const KV_KEY = 'llm_model_override';

let override: string | null = null;
let db: Database.Database | null = null;

/**
 * Load the persisted override (if any) and install the persister. Called once at
 * boot after migrations. A blank/non-string stored value falls back to null.
 */
export function initLlmModelOverride(database: Database.Database): void {
  db = database;
  try {
    const row = db
      .prepare('SELECT value_json FROM kv_cache WHERE kind = ? AND key = ?')
      .get(KV_KIND, KV_KEY) as { value_json: string } | undefined;
    if (row) {
      const stored = JSON.parse(row.value_json) as unknown;
      override = typeof stored === 'string' && stored.length > 0 ? stored : null;
    }
  } catch (err) {
    console.warn('[llm-model-override] failed to load persisted override — defaulting to none:', err);
  }
}

export function getLlmModelOverride(): string | null {
  return override;
}

/** Set + persist the override. Pass null/'' to clear it. */
export function setLlmModelOverride(next: string | null): void {
  override = next && next.length > 0 ? next : null;
  if (db) {
    try {
      db.prepare(
        `INSERT INTO kv_cache (kind, key, value_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET value_json = excluded.value_json`,
      ).run(KV_KIND, KV_KEY, JSON.stringify(override), Date.now());
    } catch (err) {
      // In-memory value still applies this process; persistence is best-effort.
      console.warn('[llm-model-override] failed to persist override:', err);
    }
  }
  console.warn(`[llm-model-override] global chat model override set to '${override ?? '(none)'}'`);
}

/** Reset module state — exposed for tests. */
export function __resetLlmModelOverrideForTests(): void {
  override = null;
  db = null;
}
