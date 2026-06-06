/**
 * Admin-selectable LLM auth mode — which credential lane(s) the failover
 * ladder may hand out:
 *
 *   - 'auto'         (default) full ladder: gateway keys first, subscription
 *                    OAuth token as the last-resort rung.
 *   - 'gateway'      gateway keys only — never burn the subscription quota.
 *   - 'subscription' subscription OAuth token only — preserve gateway budget
 *                    (or keep working while every gateway key is drained).
 *
 * The mode is process-wide and persisted in chat.db's kv_cache table
 * (kind='runtime_setting') so an admin toggle survives a service restart.
 * anthropic-key-failover.ts consults getLlmAuthMode() when selecting slots;
 * the /internal/llm-auth-mode API (admin hub bridge) reads/writes it.
 *
 * Persistence is injected at boot via initLlmAuthMode(db) — the module stays
 * import-safe for tests and scripts that never open the DB (mode just stays
 * in-memory 'auto').
 */

import type Database from 'better-sqlite3';

export type LlmAuthMode = 'auto' | 'gateway' | 'subscription';

export const LLM_AUTH_MODES: readonly LlmAuthMode[] = ['auto', 'gateway', 'subscription'];

const KV_KIND = 'runtime_setting';
const KV_KEY = 'llm_auth_mode';

let mode: LlmAuthMode = 'auto';
let db: Database.Database | null = null;

export function isLlmAuthMode(v: unknown): v is LlmAuthMode {
  return typeof v === 'string' && (LLM_AUTH_MODES as readonly string[]).includes(v);
}

/**
 * Load the persisted mode (if any) and install the persister. Called once at
 * boot after migrations. A corrupt/unknown stored value falls back to 'auto'.
 */
export function initLlmAuthMode(database: Database.Database): void {
  db = database;
  try {
    const row = db
      .prepare('SELECT value_json FROM kv_cache WHERE kind = ? AND key = ?')
      .get(KV_KIND, KV_KEY) as { value_json: string } | undefined;
    if (row) {
      const stored = JSON.parse(row.value_json) as unknown;
      if (isLlmAuthMode(stored)) mode = stored;
    }
  } catch (err) {
    console.warn('[llm-auth-mode] failed to load persisted mode — defaulting to auto:', err);
  }
}

export function getLlmAuthMode(): LlmAuthMode {
  return mode;
}

/** Set + persist the mode. Throws on an invalid value (callers validate first). */
export function setLlmAuthMode(next: LlmAuthMode): void {
  if (!isLlmAuthMode(next)) throw new Error(`Invalid LLM auth mode: ${String(next)}`);
  mode = next;
  if (db) {
    try {
      db.prepare(
        `INSERT INTO kv_cache (kind, key, value_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET value_json = excluded.value_json`,
      ).run(KV_KIND, KV_KEY, JSON.stringify(next), Date.now());
    } catch (err) {
      // In-memory mode still applies this process; persistence is best-effort.
      console.warn('[llm-auth-mode] failed to persist mode:', err);
    }
  }
  console.warn(`[llm-auth-mode] LLM auth mode set to '${next}'`);
}

/** Reset module state — exposed for tests. */
export function __resetLlmAuthModeForTests(): void {
  mode = 'auto';
  db = null;
}
