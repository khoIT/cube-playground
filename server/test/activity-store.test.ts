/**
 * Activity telemetry store — append, query, enum-validation, fire-and-forget
 * error swallowing, and the PII projector (filter values + UIDs never persist).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  insertActivity,
  queryActivity,
  recordActivity,
  projectQueryShape,
} from '../src/services/activity-store.js';
import type { Principal } from '../src/auth/principal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const alice: Principal = {
  sub: 'alice-sub',
  email: 'alice@corp.com',
  role: 'editor',
  workspaces: ['local'],
  allowedGames: ['*'],
  features: {},
};

describe('activity-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemDb();
    setDb(db);
  });

  afterEach(() => {
    closeDb();
  });

  it('inserts and queries by actor sub', () => {
    insertActivity(db, alice, { eventType: 'query_run', ts: 1000 });
    insertActivity(db, alice, { eventType: 'segment_op', targetType: 'segment', targetId: 's1', ts: 2000 });

    const rows = queryActivity(db, { actorSub: 'alice-sub' });
    expect(rows).toHaveLength(2);
    // Newest-first.
    expect(rows[0].eventType).toBe('segment_op');
    expect(rows[0].actorEmail).toBe('alice@corp.com');
    expect(rows[1].eventType).toBe('query_run');
  });

  it('keys aggregation on sub, not email (email is a display snapshot)', () => {
    const noEmail: Principal = { ...alice, sub: 'ghost-sub', email: null };
    insertActivity(db, noEmail, { eventType: 'feature_open', ts: 1 });
    const rows = queryActivity(db, { actorSub: 'ghost-sub' });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorSub).toBe('ghost-sub');
    expect(rows[0].actorEmail).toBeNull();
  });

  it('filters by event type and time window', () => {
    insertActivity(db, alice, { eventType: 'query_run', ts: 100 });
    insertActivity(db, alice, { eventType: 'query_run', ts: 500 });
    insertActivity(db, alice, { eventType: 'segment_op', ts: 600 });

    const onlyQueries = queryActivity(db, { eventType: 'query_run' });
    expect(onlyQueries).toHaveLength(2);

    const windowed = queryActivity(db, { since: 400, until: 550 });
    expect(windowed).toHaveLength(1);
    expect(windowed[0].ts).toBe(500);
  });

  it('rejects an unknown event type', () => {
    // @ts-expect-error — intentionally invalid to prove runtime validation.
    expect(() => insertActivity(db, alice, { eventType: 'bogus_event' })).toThrow(/unknown event_type/);
  });

  it('requires a principal sub', () => {
    const noSub = { ...alice, sub: '' } as Principal;
    expect(() => insertActivity(db, noSub, { eventType: 'query_run' })).toThrow(/sub is required/);
  });

  it('recordActivity swallows errors and never throws (request unaffected)', () => {
    // Point the singleton at a closed DB so the insert throws internally.
    const broken = makeMemDb();
    setDb(broken);
    broken.close();
    expect(() => recordActivity(alice, { eventType: 'query_run' })).not.toThrow();
  });

  describe('projectQueryShape — PII gate', () => {
    it('keeps member names, derives cubes, and NEVER captures filter values or UIDs', () => {
      const query = {
        measures: ['Orders.count', 'Orders.revenue'],
        dimensions: ['Users.country'],
        timeDimensions: [{ dimension: 'Orders.createdAt', granularity: 'day', dateRange: ['2026-01-01', '2026-02-01'] }],
        filters: [
          { member: 'Users.id', operator: 'equals', values: ['SECRET_PLAYER_42', 'SECRET_PLAYER_99'] },
          { member: 'Users.email', operator: 'contains', values: ['victim@private.com'] },
        ],
        segments: ['Users.vip'],
        uid_list: ['UID_AAA', 'UID_BBB'],
        limit: 100,
      };

      const shape = projectQueryShape(query);
      const serialised = JSON.stringify(shape);

      // Member names + cubes preserved.
      expect(shape.measures).toEqual(['Orders.count', 'Orders.revenue']);
      expect(shape.dimensions).toContain('Users.country');
      expect(shape.dimensions).toContain('Orders.createdAt');
      expect(shape.cubes.sort()).toEqual(['Orders', 'Users']);

      // Values, literals, date ranges, and UIDs must NOT appear anywhere.
      expect(serialised).not.toContain('SECRET_PLAYER_42');
      expect(serialised).not.toContain('SECRET_PLAYER_99');
      expect(serialised).not.toContain('victim@private.com');
      expect(serialised).not.toContain('UID_AAA');
      expect(serialised).not.toContain('2026-01-01');
      // No keys beyond the three structural lists.
      expect(Object.keys(shape).sort()).toEqual(['cubes', 'dimensions', 'measures']);
    });

    it('tolerates malformed/empty input without throwing', () => {
      expect(projectQueryShape(undefined)).toEqual({ cubes: [], measures: [], dimensions: [] });
      expect(projectQueryShape('not-an-object')).toEqual({ cubes: [], measures: [], dimensions: [] });
      expect(projectQueryShape({ measures: 'nope' })).toEqual({ cubes: [], measures: [], dimensions: [] });
    });

    it('a persisted query_run row contains only the projected shape', () => {
      const shape = projectQueryShape({
        measures: ['Orders.count'],
        filters: [{ member: 'Users.id', operator: 'equals', values: ['LEAK_ME'] }],
      });
      insertActivity(db, alice, { eventType: 'query_run', detail: shape });
      const [row] = queryActivity(db, { actorSub: 'alice-sub' });
      expect(row.detailJson).not.toBeNull();
      expect(row.detailJson!).not.toContain('LEAK_ME');
      expect(JSON.parse(row.detailJson!)).toEqual({ cubes: ['Orders'], measures: ['Orders.count'], dimensions: [] });
    });
  });
});
