/**
 * Migration verification — migrations 069, 071, 072 apply cleanly in order.
 *
 * Strategy: run ALL migrations (sorted) against a throwaway :memory: SQLite DB.
 * This exercises the full migration sequence including the new LiveOps tables,
 * then verifies the expected tables + indexes exist and CHECK constraints are
 * valid SQLite. The real segments.db is never opened.
 *
 * Coverage:
 *   069 — chart_annotations table + idx_chart_annotations_game_starts index
 *   071 — alert_rules table + idx_alert_rules_game_enabled index +
 *          comparator CHECK constraint
 *   072 — digest_subscriptions table + idx_digest_subscriptions_next_run index +
 *          cadence CHECK constraint
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

// ── Apply all migrations to an in-memory DB ───────────────────────────────────

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────

function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

function indexExists(name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(name) as { name: string } | undefined;
  return !!row;
}

// ── Migration 069 — chart_annotations ────────────────────────────────────────

describe('migration_069_chart_annotations', () => {
  it('creates the chart_annotations table', () => {
    expect(tableExists('chart_annotations')).toBe(true);
  });

  it('creates idx_chart_annotations_game_starts index', () => {
    expect(indexExists('idx_chart_annotations_game_starts')).toBe(true);
  });

  it('enforces type CHECK constraint — rejects invalid type', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO chart_annotations (game, type, title, starts_at, created_at)
         VALUES (NULL, 'invalid_type', 'Test', '2024-01-01', 1700000000000)`,
      ).run();
    }).toThrow();
  });

  it('accepts all valid type values', () => {
    const validTypes = ['patch', 'event', 'campaign', 'incident'];
    let id = 1000;
    for (const t of validTypes) {
      expect(() => {
        db.prepare(
          `INSERT INTO chart_annotations (id, game, type, title, starts_at, created_at)
           VALUES (?, NULL, ?, ?, '2024-01-01', 1700000000000)`,
        ).run(id++, t, `Test ${t}`);
      }).not.toThrow();
    }
  });

  it('allows NULL game (global annotation)', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO chart_annotations (game, type, title, starts_at, created_at)
         VALUES (NULL, 'patch', 'Global patch', '2024-06-01', 1700000000000)`,
      ).run();
    }).not.toThrow();
  });

  it('allows NULL ends_at (point event)', () => {
    const row = db
      .prepare(`SELECT ends_at FROM chart_annotations WHERE title='Global patch' LIMIT 1`)
      .get() as { ends_at: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.ends_at).toBeNull();
  });
});

// ── Migration 071 — alert_rules ───────────────────────────────────────────────

describe('migration_071_alert_rules', () => {
  it('creates the alert_rules table', () => {
    expect(tableExists('alert_rules')).toBe(true);
  });

  it('creates idx_alert_rules_game_enabled index', () => {
    expect(indexExists('idx_alert_rules_game_enabled')).toBe(true);
  });

  it('enforces comparator CHECK constraint — rejects unknown comparator', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO alert_rules (owner, game, metric, comparator, threshold, channel, enabled, created_at)
         VALUES ('user1', 'cfm_vn', 'dau', 'not_a_comp', 100, 'in_app', 1, 1700000000000)`,
      ).run();
    }).toThrow();
  });

  it('accepts all 6 valid comparator values', () => {
    const comparators = ['<', '>', '<=', '>=', 'pct_drop', 'pct_rise'];
    let id = 2000;
    for (const c of comparators) {
      expect(() => {
        db.prepare(
          `INSERT INTO alert_rules (id, owner, game, metric, comparator, threshold, channel, enabled, created_at)
           VALUES (?, 'khoitn', 'cfm_vn', 'dau', ?, 10, 'in_app', 1, 1700000000000)`,
        ).run(id++, c);
      }).not.toThrow();
    }
  });

  it('defaults enabled to 1', () => {
    db.prepare(
      `INSERT INTO alert_rules (owner, game, metric, comparator, threshold, channel, created_at)
       VALUES ('khoitn', 'jus_vn', 'revenue', '<', 1000, 'in_app', 1700000000001)`,
    ).run();
    const row = db
      .prepare(`SELECT enabled FROM alert_rules WHERE game='jus_vn' ORDER BY id DESC LIMIT 1`)
      .get() as { enabled: number } | undefined;
    expect(row?.enabled).toBe(1);
  });
});

// ── Migration 072 — digest_subscriptions ─────────────────────────────────────

describe('migration_072_digest_subscriptions', () => {
  it('creates the digest_subscriptions table', () => {
    expect(tableExists('digest_subscriptions')).toBe(true);
  });

  it('creates idx_digest_subscriptions_next_run index', () => {
    expect(indexExists('idx_digest_subscriptions_next_run')).toBe(true);
  });

  it('enforces cadence CHECK constraint — rejects unknown cadence', () => {
    expect(() => {
      db.prepare(
        `INSERT INTO digest_subscriptions (owner, game, metrics_json, cadence, channel, created_at)
         VALUES ('user1', 'cfm_vn', '[]', 'hourly', 'in_app', 1700000000000)`,
      ).run();
    }).toThrow();
  });

  it('accepts daily and weekly cadence values', () => {
    for (const cadence of ['daily', 'weekly']) {
      expect(() => {
        db.prepare(
          `INSERT INTO digest_subscriptions (owner, game, metrics_json, cadence, channel, created_at)
           VALUES ('khoitn', 'cfm_vn', '["dau"]', ?, 'in_app', 1700000000000)`,
        ).run(cadence);
      }).not.toThrow();
    }
  });

  it('allows NULL next_run_at (not yet scheduled)', () => {
    db.prepare(
      `INSERT INTO digest_subscriptions (owner, game, metrics_json, cadence, channel, next_run_at, created_at)
       VALUES ('khoitn', 'cfm_vn', '[]', 'daily', 'in_app', NULL, 1700000000000)`,
    ).run();
    const row = db
      .prepare(
        `SELECT next_run_at FROM digest_subscriptions
          WHERE next_run_at IS NULL ORDER BY id DESC LIMIT 1`,
      )
      .get() as { next_run_at: number | null } | undefined;
    expect(row?.next_run_at).toBeNull();
  });

  it('allows NULL last_run_date (never delivered)', () => {
    const row = db
      .prepare(
        `SELECT last_run_date FROM digest_subscriptions ORDER BY id DESC LIMIT 1`,
      )
      .get() as { last_run_date: string | null } | undefined;
    expect(row?.last_run_date).toBeNull();
  });
});

// ── Idempotence — CREATE TABLE IF NOT EXISTS ──────────────────────────────────
// NOTE: Only CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS.
// ALTER TABLE (used in several early migrations) is not idempotent in SQLite —
// re-running it throws "duplicate column name". That is expected SQLite behaviour,
// not a bug. The test below verifies only the LiveOps migration files (069, 071,
// 072) are idempotent, since they use CREATE TABLE IF NOT EXISTS / CREATE INDEX
// IF NOT EXISTS exclusively.

describe('liveops_migrations_idempotent_via_if_not_exists', () => {
  it('re-executing migrations 069, 071, 072 SQL does not throw', () => {
    const targetFiles = ['069-chart-annotations.sql', '071-alert-rules.sql', '072-digest-subscriptions.sql'];
    expect(() => {
      for (const file of targetFiles) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        db.exec(sql);
      }
    }).not.toThrow();
  });
});
