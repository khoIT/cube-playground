/**
 * Consumption rollup math: audit-derived consumer count (not scope), v2-only
 * rate/status math, logical-pull grouping (paged rows of one snapshot collapse),
 * and entitled-vs-actually-pulled tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, getDb, closeDb } from '../src/db/sqlite.js';
import { createKey, __resetApiKeyCaches } from '../src/auth/api-key-store.js';
import { getConsumption, tokensForSegment } from '../src/services/segment-consumption-store.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

const SEG = 'seg-1';

function keyId(label: string): string {
  return (getDb().prepare('SELECT id FROM api_keys WHERE label = ?').get(label) as { id: string }).id;
}

interface AuditOver {
  pageIndex?: number | null;
  snapshotTs?: string | null;
  httpStatus?: number;
  errorCode?: string | null;
  auditSchema?: string | null;
  rows?: number;
}
function insertAudit(keyIdVal: string, over: AuditOver = {}) {
  getDb()
    .prepare(
      `INSERT INTO public_pull_audit
        (key_id, segment_id, started_at, finished_at, rows_streamed, format, status, page_index, snapshot_ts, http_status, error_code, audit_schema, latency_ms)
       VALUES (?, ?, ?, ?, ?, 'json', 'complete', ?, ?, ?, ?, ?, 120)`,
    )
    .run(
      keyIdVal,
      SEG,
      new Date().toISOString(),
      new Date().toISOString(),
      over.rows ?? 1000,
      over.pageIndex === undefined ? 0 : over.pageIndex,
      over.snapshotTs === undefined ? '2026-06-28 08:00:00' : over.snapshotTs,
      over.httpStatus ?? 200,
      over.errorCode ?? null,
      over.auditSchema === undefined ? 'v2' : over.auditSchema,
    );
}

describe('segment consumption store', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    __resetApiKeyCaches();
    createKey({ label: 'k1', workspace: 'prod', segmentIds: [SEG], createdBy: 'a@vng.com.vn' });
    createKey({ label: 'k2', workspace: 'prod', segmentIds: [SEG], createdBy: 'a@vng.com.vn' });
    createKey({ label: 'wildcard', workspace: 'prod', createdBy: 'a@vng.com.vn' }); // segmentIds null = all
    __resetApiKeyCaches();
    getDb()
      .prepare("INSERT INTO segments (id, name, type, owner, status, workspace) VALUES (?, 'S', 'manual', 'a', 'fresh', 'prod')")
      .run(SEG);
  });
  afterEach(() => {
    closeDb();
    __resetApiKeyCaches();
  });

  it('counts consumers from the audit (a wildcard key that never pulled is not a consumer)', () => {
    const k1 = keyId('k1');
    const k2 = keyId('k2');
    // k1 walks one snapshot in 3 pages (one logical pull) + a second snapshot (one more).
    insertAudit(k1, { pageIndex: 0, snapshotTs: '2026-06-28 08:00:00' });
    insertAudit(k1, { pageIndex: 1, snapshotTs: '2026-06-28 08:00:00' });
    insertAudit(k1, { pageIndex: 2, snapshotTs: '2026-06-28 08:00:00' });
    insertAudit(k1, { pageIndex: 0, snapshotTs: '2026-06-29 08:00:00' });
    // k2 one stream pull.
    insertAudit(k2, { pageIndex: null });

    const view = getConsumption(SEG, '30d', Date.now());
    // wildcard key never pulled → not counted; only k1 + k2.
    expect(view.summary.consumingKeys).toBe(2);
    // k1 = 2 logical pulls (collapsed pages), k2 = 1 stream pull.
    const k1Row = view.byKey.find((r) => r.keyId === k1);
    expect(k1Row?.pulls).toBe(2);
    expect(view.summary.pulls).toBe(3);
  });

  it('excludes pre-enrichment (non-v2) rows and counts failures in the breakdown', () => {
    const k1 = keyId('k1');
    insertAudit(k1, { httpStatus: 200 });
    insertAudit(k1, { httpStatus: 429, errorCode: 'rate_limited', pageIndex: null });
    insertAudit(k1, { auditSchema: null, httpStatus: 200 }); // pre-enrichment → ignored by math

    const view = getConsumption(SEG, '30d', Date.now());
    expect(view.statusBreakdown.ok).toBe(1); // the non-v2 200 is excluded
    expect(view.statusBreakdown.rate_limited).toBe(1);
  });

  it('separates entitled tokens from those that actually pulled', () => {
    const k1 = keyId('k1');
    insertAudit(k1, { httpStatus: 200 });

    const tokens = tokensForSegment({ id: SEG, workspace: 'prod', game_id: null });
    const byLabel = new Map(tokens.map((tk) => [tk.label, tk]));
    expect(byLabel.get('k1')?.everPulled).toBe(true);
    expect(byLabel.get('k2')?.everPulled).toBe(false); // entitled but idle
    expect(byLabel.get('wildcard')?.appliesVia).toBe('all-segments');
    expect(byLabel.get('wildcard')?.everPulled).toBe(false);
  });
});
