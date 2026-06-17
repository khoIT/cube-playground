/**
 * One-time relocate: flatten the per-game slash sub-namespaces produced by an
 * earlier loader run — stag_iceberg."khoitn/<game>".<table> — into the bare
 * `khoitn` schema as game-prefixed tables: stag_iceberg.khoitn.<game>__<table>.
 *
 * Why: Trino's namespace is flat (catalog.schema.table), so a data source
 * pointed at catalog=stag_iceberg, schema=khoitn only sees tables literally in
 * the `khoitn` schema — not the slash sub-schemas. Prefixing keeps the per-game
 * grouping while making the whole set visible at schema=khoitn.
 *
 * The move is an Iceberg ALTER TABLE RENAME — metadata only, no row copy, so the
 * ~300M already-copied rows are not re-read. Idempotent: a table already at the
 * destination is skipped; the emptied source schema is dropped at the end.
 *
 * Run:  npm run relocate:test-data            (cfm_vn,jus_vn from khoitn/<game>)
 */

import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_CATALOG,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from '../lakehouse/lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';

const GAMES = (process.env.GAMES ?? 'cfm_vn,jus_vn')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const DEST_SCHEMA = process.env.DEST_SCHEMA ?? 'khoitn';

async function listTables(connector: Connector, schema: string): Promise<string[]> {
  try {
    const res = await runQuery(
      connector,
      DEST_SCHEMA,
      `SHOW TABLES FROM ${LAKEHOUSE_CATALOG}."${schema}"`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    return res.rows.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const connector = lakehouseConnectorFromEnv();
  await runQuery(
    connector,
    DEST_SCHEMA,
    `CREATE SCHEMA IF NOT EXISTS ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"`,
    LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  );

  let moved = 0;
  let failed = 0;
  for (const game of GAMES) {
    const srcSchema = `khoitn/${game}`;
    const tables = await listTables(connector, srcSchema);
    if (tables.length === 0) {
      console.log(`! ${srcSchema}: no tables — skipped`);
      continue;
    }
    console.log(`# ${srcSchema} → ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}".${game}__* (${tables.length})`);
    for (const table of tables) {
      const from = `${LAKEHOUSE_CATALOG}."${srcSchema}"."${table}"`;
      const to = `${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"."${game}__${table}"`;
      try {
        await runQuery(connector, DEST_SCHEMA, `ALTER TABLE ${from} RENAME TO ${to}`, LAKEHOUSE_STATEMENT_TIMEOUT_MS);
        moved++;
        console.log(`  ✓ ${table} → ${game}__${table}`);
      } catch (err) {
        failed++;
        console.log(`  ✗ ${table}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Source schema is now empty — drop it so the slash sub-namespace disappears.
    try {
      await runQuery(
        connector,
        DEST_SCHEMA,
        `DROP SCHEMA IF EXISTS ${LAKEHOUSE_CATALOG}."${srcSchema}"`,
        LAKEHOUSE_STATEMENT_TIMEOUT_MS,
      );
    } catch (err) {
      console.log(`  ! could not drop ${srcSchema}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n=== Relocate done: ${moved} moved, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
