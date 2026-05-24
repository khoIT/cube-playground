/**
 * Idempotent seed for `glossary_terms` from server/data/glossary.seed.json.
 * Runs at boot after SQL migrations. Upserts by id so future seed edits
 * propagate without a manual sync.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

const SEED_CANDIDATES = [
  // From repo root (server/index.ts running with cwd = repo root).
  resolve(process.cwd(), 'server', 'data', 'glossary.seed.json'),
  // From server/ cwd (vitest in server/).
  resolve(process.cwd(), 'data', 'glossary.seed.json'),
];

interface SeedTerm {
  id: string;
  label: string;
  description: string;
  primary_catalog_id?: string | null;
  secondary_catalog_ids?: string[];
  aliases?: string[];
  category?: string;
}

interface SeedFile {
  version: number;
  terms: SeedTerm[];
}

function loadSeedFile(): SeedFile {
  for (const path of SEED_CANDIDATES) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as SeedFile;
    } catch {
      continue;
    }
  }
  throw new Error(
    `glossary seed not found; looked at: ${SEED_CANDIDATES.join(', ')}`,
  );
}

export function migrateGlossarySeed(
  db: Database.Database,
): { upserted: number; purged: number } {
  const seed = loadSeedFile();
  const stmt = db.prepare(
    `INSERT INTO glossary_terms
       (id, label, description, primary_catalog_id, secondary_catalog_ids, aliases, category, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       description = excluded.description,
       primary_catalog_id = excluded.primary_catalog_id,
       secondary_catalog_ids = excluded.secondary_catalog_ids,
       aliases = excluded.aliases,
       category = excluded.category,
       updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  let upserted = 0;
  let purged = 0;
  // Orphan purge: the seed JSON is the source of truth. Without this, a
  // renamed or deleted seed entry would leave a stale row in the DB and
  // chat lookups would still resolve to the old (broken) primary_catalog_id.
  const seedIds = new Set(seed.terms.map((t) => t.id));
  const tx = db.transaction((terms: SeedTerm[]) => {
    for (const t of terms) {
      stmt.run(
        t.id,
        t.label,
        t.description,
        t.primary_catalog_id ?? null,
        t.secondary_catalog_ids ? JSON.stringify(t.secondary_catalog_ids) : null,
        t.aliases ? JSON.stringify(t.aliases) : null,
        t.category ?? null,
        now,
      );
      upserted += 1;
    }
    const existing = db.prepare('SELECT id FROM glossary_terms').all() as Array<{ id: string }>;
    const deleteStmt = db.prepare('DELETE FROM glossary_terms WHERE id = ?');
    for (const row of existing) {
      if (!seedIds.has(row.id)) {
        deleteStmt.run(row.id);
        purged += 1;
      }
    }
  });
  tx(seed.terms);
  return { upserted, purged };
}
