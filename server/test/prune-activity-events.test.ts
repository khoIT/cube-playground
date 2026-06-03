/**
 * Retention prune — deletes activity_events older than 90d, keeps newer rows,
 * returns the count removed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { insertActivity, queryActivity } from '../src/services/activity-store.js';
import { pruneActivityEventsTick, ACTIVITY_RETENTION_DAYS } from '../src/jobs/prune-activity-events.js';
import type { Principal } from '../src/auth/principal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const actor: Principal = {
  sub: 'a-sub', email: 'a@corp.com', role: 'editor', workspaces: [], allowedGames: [], features: {},
};

describe('prune-activity-events', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => { closeDb(); vi.restoreAllMocks(); });

  it('deletes rows older than the retention horizon and keeps newer ones', () => {
    const now = 1_000 * DAY_MS; // arbitrary fixed clock
    const db = getDb();
    insertActivity(db, actor, { eventType: 'query_run', ts: now - (ACTIVITY_RETENTION_DAYS + 5) * DAY_MS }); // stale
    insertActivity(db, actor, { eventType: 'query_run', ts: now - (ACTIVITY_RETENTION_DAYS + 1) * DAY_MS }); // stale
    insertActivity(db, actor, { eventType: 'query_run', ts: now - (ACTIVITY_RETENTION_DAYS - 1) * DAY_MS }); // keep
    insertActivity(db, actor, { eventType: 'query_run', ts: now }); // keep

    const removed = pruneActivityEventsTick(now);
    expect(removed).toBe(2);

    const remaining = queryActivity(db, { actorSub: 'a-sub' });
    expect(remaining).toHaveLength(2);
  });

  it('is a no-op (0 removed) when nothing is past the horizon', () => {
    const now = 1_000 * DAY_MS;
    insertActivity(getDb(), actor, { eventType: 'feature_open', ts: now });
    expect(pruneActivityEventsTick(now)).toBe(0);
  });

  it('logs the pruned count when rows are removed', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const now = 1_000 * DAY_MS;
    insertActivity(getDb(), actor, { eventType: 'query_run', ts: now - 200 * DAY_MS });
    pruneActivityEventsTick(now);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('removed 1 event'));
  });
});
