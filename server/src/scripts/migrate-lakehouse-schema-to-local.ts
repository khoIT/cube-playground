/**
 * One-time migration: relocate the legacy single-schema snapshot tables
 * (stag_iceberg.khoitn.*) into the env-scoped local sub-schema
 * (stag_iceberg."khoitn/local".*).
 *
 * Why: the lakehouse is shared, so snapshot data is now env-scoped — prod writes
 * to khoitn/prod, local dev to khoitn/local. The historical dev rows that
 * accumulated under the bare `khoitn` schema belong to the LOCAL environment, so
 * they move under khoitn/local.
 *
 * The move is an Iceberg ALTER TABLE RENAME — metadata only, no row copy, fully
 * reversible (rename back). Idempotent: a table already at the destination, or
 * absent at the source, is skipped, so a re-run is a no-op.
 *
 * Run:  npm run migrate:lakehouse-local   (from server/, loads ../.env*)
 */

import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_CATALOG,
  LAKEHOUSE_STATEMENT_TIMEOUT_MS,
} from '../lakehouse/lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';

const SOURCE_SCHEMA = 'khoitn';
const DEST_SCHEMA = 'khoitn/local';
const TABLES = [
  'segment_membership_daily',
  'segment_membership_delta',
  'segment_definition_daily',
];

/** Tables present in a schema (lowercased). Empty list if the schema is absent. */
async function listTables(connector: Connector, schema: string): Promise<Set<string>> {
  try {
    const res = await runQuery(
      connector,
      schema,
      `SHOW TABLES FROM ${LAKEHOUSE_CATALOG}."${schema}"`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    return new Set(res.rows.map((r) => String(r[0]).toLowerCase()));
  } catch {
    return new Set();
  }
}

async function rowCount(connector: Connector, schema: string, table: string): Promise<number | null> {
  try {
    const res = await runQuery(
      connector,
      schema,
      `SELECT count(*) FROM ${LAKEHOUSE_CATALOG}."${schema}".${table}`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    return Number(res.rows[0]?.[0] ?? 0);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const connector = lakehouseConnectorFromEnv();

  // Destination schema must exist before a cross-schema rename can land in it.
  await runQuery(
    connector,
    DEST_SCHEMA,
    `CREATE SCHEMA IF NOT EXISTS ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"`,
    LAKEHOUSE_STATEMENT_TIMEOUT_MS,
  );
  console.log(`[migrate] ensured schema ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"`);

  const srcTables = await listTables(connector, SOURCE_SCHEMA);
  const dstTables = await listTables(connector, DEST_SCHEMA);

  for (const t of TABLES) {
    const inSrc = srcTables.has(t);
    const inDst = dstTables.has(t);
    if (inDst) {
      const n = await rowCount(connector, DEST_SCHEMA, t);
      console.log(`[migrate] ${t}: already at destination (rows=${n ?? 'n/a'}) — skip`);
      continue;
    }
    if (!inSrc) {
      console.log(`[migrate] ${t}: not at source ${SOURCE_SCHEMA} — nothing to move`);
      continue;
    }
    const before = await rowCount(connector, SOURCE_SCHEMA, t);
    await runQuery(
      connector,
      SOURCE_SCHEMA,
      `ALTER TABLE ${LAKEHOUSE_CATALOG}."${SOURCE_SCHEMA}".${t} ` +
        `RENAME TO ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}".${t}`,
      LAKEHOUSE_STATEMENT_TIMEOUT_MS,
    );
    const after = await rowCount(connector, DEST_SCHEMA, t);
    console.log(`[migrate] ${t}: renamed ${SOURCE_SCHEMA} → ${DEST_SCHEMA} (rows ${before ?? '?'} → ${after ?? '?'})`);
  }

  console.log('[migrate] done.');
}

main().catch((err) => {
  console.error('[migrate] failed:', (err as Error).message);
  process.exitCode = 1;
});
