/**
 * Refresh-log retention pruner tests. The job lives in cron — these tests
 * exercise the pure function so retention semantics are verifiable without
 * a 60s scheduler tick.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { pruneRefreshLog, DEFAULT_RETENTION_DAYS } from '../src/jobs/refresh-log-retention.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function insertLog(segmentId: string, daysAgo: number, uidCount = 100) {
  const db = getDb();
  db.prepare(
    `INSERT INTO segment_refresh_log (segment_id, uid_count, status, ts)
     VALUES (?, ?, 'fresh', datetime('now', ?))`,
  ).run(segmentId, uidCount, `-${daysAgo} days`);
}

function seedSegment(id: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO segments (id, name, type, owner, status, cube, uid_count, created_at, updated_at)
     VALUES (?, ?, 'manual', 'tester', 'fresh', 'mf_users', 0, datetime('now'), datetime('now'))`,
  ).run(id, `seg-${id}`);
}

describe('refresh-log retention', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedSegment('s1');
  });
  afterEach(() => {
    closeDb();
    delete process.env.REFRESH_LOG_RETENTION_DAYS;
  });

  it('deletes rows older than the default cutoff (90 days)', () => {
    insertLog('s1', 5);
    insertLog('s1', 95);
    insertLog('s1', 200);
    const out = pruneRefreshLog();
    expect(out.cutoffDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(out.removed).toBe(2);
    const remaining = getDb()
      .prepare('SELECT COUNT(*) AS n FROM segment_refresh_log')
      .get() as { n: number };
    expect(remaining.n).toBe(1);
  });

  it('returns 0 when nothing exceeds the cutoff', () => {
    insertLog('s1', 1);
    insertLog('s1', 30);
    const out = pruneRefreshLog();
    expect(out.removed).toBe(0);
  });

  it('respects REFRESH_LOG_RETENTION_DAYS override', () => {
    process.env.REFRESH_LOG_RETENTION_DAYS = '7';
    insertLog('s1', 3);
    insertLog('s1', 10);
    const out = pruneRefreshLog();
    expect(out.cutoffDays).toBe(7);
    expect(out.removed).toBe(1);
  });

  it('falls back to default when env value is invalid', () => {
    process.env.REFRESH_LOG_RETENTION_DAYS = 'abc';
    insertLog('s1', 100);
    const out = pruneRefreshLog();
    expect(out.cutoffDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(out.removed).toBe(1);
  });
});
