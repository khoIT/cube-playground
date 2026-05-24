#!/usr/bin/env node
/**
 * Verify that the local SQLite databases are caught up with the committed
 * seed snapshots. Run on each machine; an "OK" on both means they're in sync.
 *
 *   - segments: local DB row count vs server/data/seed/segments-snapshot.json
 *   - chat:     local DB row count vs chat-service/runtime/seed/chat-snapshot.json
 *
 * "Synced" means every row in the snapshot also exists locally — i.e. the
 * local DB is a superset of the seed. Local-only rows (created since the
 * last snapshot pull) are flagged separately as "ahead by N".
 *
 * Exit 0 when both targets are synced; non-zero otherwise so the script can
 * be chained into other tooling later if useful.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// better-sqlite3 is installed in server/node_modules (not at the repo root).
// Resolve through there so this script works without an extra root dep.
const requireFromServer = createRequire(resolve(ROOT, 'server/package.json'));
const Database = requireFromServer('better-sqlite3');

const TARGETS = [
  {
    label: 'segments',
    dbPath: resolve(ROOT, 'server/data/segments.db'),
    snapshotPath: resolve(ROOT, 'server/data/seed/segments-snapshot.json'),
    snapshotKey: 'segments',
    table: 'segments',
  },
  {
    label: 'chat sessions',
    dbPath: resolve(ROOT, 'chat-service/runtime/chat.db'),
    snapshotPath: resolve(ROOT, 'chat-service/runtime/seed/chat-snapshot.json'),
    snapshotKey: 'chat_sessions',
    table: 'chat_sessions',
  },
  {
    label: 'chat turns',
    dbPath: resolve(ROOT, 'chat-service/runtime/chat.db'),
    snapshotPath: resolve(ROOT, 'chat-service/runtime/seed/chat-snapshot.json'),
    snapshotKey: 'chat_turns',
    table: 'chat_turns',
  },
];

function check(target) {
  if (!existsSync(target.snapshotPath)) {
    return { label: target.label, status: 'no-snapshot' };
  }
  if (!existsSync(target.dbPath)) {
    return { label: target.label, status: 'no-local-db' };
  }

  const snapshot = JSON.parse(readFileSync(target.snapshotPath, 'utf8'));
  const snapshotIds = new Set((snapshot[target.snapshotKey] ?? []).map((r) => r.id));
  const snapshotCount = snapshotIds.size;

  const db = new Database(target.dbPath, { readonly: true });
  const localRows = db.prepare(`SELECT id FROM ${target.table}`).all();
  db.close();
  const localIds = new Set(localRows.map((r) => r.id));
  const localCount = localIds.size;

  const missingFromLocal = [...snapshotIds].filter((id) => !localIds.has(id));
  const aheadOfSnapshot = [...localIds].filter((id) => !snapshotIds.has(id));

  return {
    label: target.label,
    status: missingFromLocal.length === 0 ? 'synced' : 'behind',
    localCount,
    snapshotCount,
    missing: missingFromLocal.length,
    ahead: aheadOfSnapshot.length,
  };
}

const results = TARGETS.map(check);
const pad = (s, n) => String(s).padEnd(n);
let allGood = true;

console.log('');
console.log(pad('target', 16), pad('status', 12), pad('local', 8), pad('snapshot', 10), 'notes');
console.log('-'.repeat(72));
for (const r of results) {
  if (r.status === 'no-snapshot') {
    console.log(pad(r.label, 16), pad('no-seed', 12), '-', '-', 'no committed seed file');
    continue;
  }
  if (r.status === 'no-local-db') {
    console.log(pad(r.label, 16), pad('no-db', 12), '-', '-', 'service has never run locally');
    continue;
  }
  const note =
    r.status === 'synced'
      ? r.ahead > 0
        ? `local ahead by ${r.ahead} (push to share)`
        : 'fully in sync'
      : `${r.missing} snapshot row(s) missing locally — restart server to hydrate`;
  if (r.status !== 'synced') allGood = false;
  console.log(
    pad(r.label, 16),
    pad(r.status === 'synced' ? 'OK' : 'BEHIND', 12),
    pad(r.localCount, 8),
    pad(r.snapshotCount, 10),
    note,
  );
}
console.log('');
process.exit(allGood ? 0 : 1);
