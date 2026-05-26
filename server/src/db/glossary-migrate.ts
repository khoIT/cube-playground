/**
 * Idempotent seed for `glossary_terms` from server/data/glossary.seed.json.
 *
 * Runs at boot after SQL migrations. The seed JSON is the source of truth
 * for **untouched** seed rows: orphan purge and column overwrite are both
 * scoped to `source='seed' AND editor_name IS NULL`. Once a human edits a
 * seed row (sets `editor_name`), subsequent boots leave it alone so analyst
 * tweaks survive across deploys. To revert a user-edited seed row, delete it
 * — the next boot will re-upsert from the JSON.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

const SEED_CANDIDATES = [
  resolve(process.cwd(), 'server', 'data', 'glossary.seed.json'),
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
  label_vi?: string | null;
  description_vi?: string | null;
  aliases_vi?: string[];
  // Phase 02a concept-tier fields (all optional; non-concept terms omit them).
  entity_cube?: string | null;
  entity_pk?: string | null;
  default_measure_ref?: string | null;
  default_filter_json?: Record<string, unknown> | null;
  ranking_json?: Record<string, unknown> | null;
  trust_tier?: 'certified' | 'experimental' | null;
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
  throw new Error(`glossary seed not found; looked at: ${SEED_CANDIDATES.join(', ')}`);
}

export function migrateGlossarySeed(
  db: Database.Database,
): { upserted: number; purged: number; preserved: number } {
  const seed = loadSeedFile();
  const now = Date.now();

  // Insert when missing. We always set source='seed' and status='official'
  // so seed-provided terms are immediately usable by the chat agent.
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO glossary_terms
       (id, label, description, primary_catalog_id, secondary_catalog_ids, aliases, category,
        updated_at, label_vi, description_vi, aliases_vi, status, source, editor_name,
        entity_cube, entity_pk, default_measure_ref, default_filter_json, ranking_json, trust_tier)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  // Refresh only untouched seed rows (no human editor recorded). User-edited
  // rows keep their content. Status is left alone too — a user may have
  // demoted a row to draft on purpose.
  const refreshStmt = db.prepare(
    `UPDATE glossary_terms
       SET label = ?, description = ?, primary_catalog_id = ?, secondary_catalog_ids = ?,
           aliases = ?, category = ?, updated_at = ?, label_vi = ?, description_vi = ?,
           aliases_vi = ?,
           entity_cube = ?, entity_pk = ?, default_measure_ref = ?,
           default_filter_json = ?, ranking_json = ?, trust_tier = ?
     WHERE id = ? AND source = 'seed' AND editor_name IS NULL`,
  );

  let upserted = 0;
  let preserved = 0;
  let purged = 0;

  const seedIds = new Set(seed.terms.map((t) => t.id));

  const arr = (a?: string[]): string | null =>
    a && a.length ? JSON.stringify(a) : null;

  const obj = (o?: Record<string, unknown> | null): string | null =>
    o && Object.keys(o).length ? JSON.stringify(o) : null;

  const tx = db.transaction(() => {
    for (const t of seed.terms) {
      const insertResult = insertStmt.run(
        t.id,
        t.label,
        t.description,
        t.primary_catalog_id ?? null,
        arr(t.secondary_catalog_ids),
        arr(t.aliases),
        t.category ?? null,
        now,
        t.label_vi ?? null,
        t.description_vi ?? null,
        arr(t.aliases_vi),
        'official',
        'seed',
        null,
        t.entity_cube ?? null,
        t.entity_pk ?? null,
        t.default_measure_ref ?? null,
        obj(t.default_filter_json),
        obj(t.ranking_json),
        t.trust_tier ?? null,
      );

      if (insertResult.changes === 1) {
        upserted += 1;
        continue;
      }

      const refreshResult = refreshStmt.run(
        t.label,
        t.description,
        t.primary_catalog_id ?? null,
        arr(t.secondary_catalog_ids),
        arr(t.aliases),
        t.category ?? null,
        now,
        t.label_vi ?? null,
        t.description_vi ?? null,
        arr(t.aliases_vi),
        t.entity_cube ?? null,
        t.entity_pk ?? null,
        t.default_measure_ref ?? null,
        obj(t.default_filter_json),
        obj(t.ranking_json),
        t.trust_tier ?? null,
        t.id,
      );
      if (refreshResult.changes === 1) upserted += 1;
      else preserved += 1;
    }

    // Orphan purge: drop seed-managed rows no longer in the JSON, but never
    // touch user-authored rows or seed rows a human has edited.
    const existing = db
      .prepare(`SELECT id FROM glossary_terms WHERE source = 'seed' AND editor_name IS NULL`)
      .all() as Array<{ id: string }>;
    const deleteStmt = db.prepare(`DELETE FROM glossary_terms WHERE id = ?`);
    for (const row of existing) {
      if (!seedIds.has(row.id)) {
        deleteStmt.run(row.id);
        purged += 1;
      }
    }
  });
  tx();

  return { upserted, purged, preserved };
}
