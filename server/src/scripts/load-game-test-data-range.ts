/**
 * Load a test-data range into the personal lakehouse namespace.
 *
 * Copies every table from each given game's `game_integration` schema into a
 * per-game Iceberg sub-namespace (stag_iceberg."khoitn/<game>".<table>),
 * sliced to the last N days on each table's natural date column. Tables with no
 * daily date dimension — mf_ / map_ current-state snapshots and _monthly marts
 * — are copied in full (a "last 30 days" filter doesn't apply to a snapshot).
 *
 * Idempotent: each destination table is dropped and rebuilt via CTAS, so a
 * re-run replaces the slice rather than appending. Tables are processed
 * independently — one failure (e.g. a too-large etl_ copy hitting the statement
 * timeout) is logged and the run continues; a summary lists every outcome.
 *
 * Reuses the lakehouse write connector (CUBEJS_DB_*) — the same Trino
 * coordinator the segment snapshots write through — so it already has write
 * access to the stag_iceberg catalog.
 *
 * Run:  npm run load:game-test-data                       (jus_vn,cfm_vn · 30d)
 *       GAMES=jus_vn DAYS=7 npm run load:game-test-data
 *       STATEMENT_TIMEOUT_MS=3600000 npm run load:game-test-data
 */

import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_CATALOG,
} from '../lakehouse/lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';
import type { Connector } from '../services/trino-profiler-config.js';

/** Source catalog holding the raw per-game schemas. */
const SOURCE_CATALOG = 'game_integration';

/** Games (= source schema names) and window, overridable via env. */
const GAMES = (process.env.GAMES ?? 'jus_vn,cfm_vn')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
const DAYS = Number(process.env.DAYS ?? '30');

/**
 * Destination Iceberg schema. Trino's namespace is flat (catalog.schema.table),
 * so the per-game grouping is a table-name prefix, not a nested schema: every
 * table lands as `<game>__<table>` directly in this schema. Defaulting to bare
 * `khoitn` makes the whole test set visible to a data source pointed at
 * catalog=stag_iceberg, schema=khoitn.
 */
const DEST_SCHEMA = process.env.DEST_SCHEMA ?? 'khoitn';

/** Prefix that namespaces a source table under its game within DEST_SCHEMA. */
function destTableName(game: string, table: string): string {
  return `${game}__${table}`;
}

/** Full 30-day etl_ copies are large; give each statement generous headroom. */
const STATEMENT_TIMEOUT_MS = Number(process.env.STATEMENT_TIMEOUT_MS ?? '1800000');

/**
 * Date column to slice on, in priority order. The first one a table actually
 * has (always a `date`-typed column in these schemas) wins; a table with none
 * is copied in full. log_date is the canonical event/partition date on every
 * etl_/std_ table; the cons_ daily marts use report/active/recharge_date; the
 * std_ monthly marts use first_day_of_month.
 */
const DATE_COLUMN_PRIORITY = [
  'log_date',
  'report_date',
  'active_date',
  'recharge_date',
  'first_day_of_month',
];

/** Per-game map of table -> its ordered column-name list (lowercased). */
type SchemaColumns = Map<string, Map<string, string[]>>;

async function loadColumns(connector: Connector): Promise<SchemaColumns> {
  const inList = GAMES.map((g) => `'${g}'`).join(',');
  const res = await runQuery(
    connector,
    GAMES[0],
    `SELECT table_schema, table_name, column_name FROM ${SOURCE_CATALOG}.information_schema.columns ` +
      `WHERE table_schema IN (${inList}) ORDER BY table_schema, table_name, ordinal_position`,
    STATEMENT_TIMEOUT_MS,
  );
  const out: SchemaColumns = new Map();
  for (const row of res.rows) {
    const [schema, table, col] = row.map((c) => String(c).toLowerCase());
    let tables = out.get(schema);
    if (!tables) out.set(schema, (tables = new Map()));
    const cols = tables.get(table) ?? [];
    cols.push(col);
    tables.set(table, cols);
  }
  return out;
}

/** Pick the slice column for a table, or null to copy it in full. */
function pickDateColumn(columns: string[]): string | null {
  for (const candidate of DATE_COLUMN_PRIORITY) {
    if (columns.includes(candidate)) return candidate;
  }
  return null;
}

type Outcome = {
  table: string;
  dateColumn: string | null;
  rows: number | null;
  ms: number;
  status: 'ok' | 'failed';
  error?: string;
};

async function copyTable(
  connector: Connector,
  game: string,
  table: string,
  dateColumn: string | null,
): Promise<Outcome> {
  const src = `${SOURCE_CATALOG}."${game}"."${table}"`;
  const dest = `${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"."${destTableName(game, table)}"`;
  const where = dateColumn
    ? ` WHERE "${dateColumn}" >= date_add('day', -${DAYS}, current_date)`
    : '';
  const started = Date.now();
  try {
    await runQuery(connector, game, `DROP TABLE IF EXISTS ${dest}`, STATEMENT_TIMEOUT_MS);
    await runQuery(
      connector,
      game,
      `CREATE TABLE ${dest} AS SELECT * FROM ${src}${where}`,
      STATEMENT_TIMEOUT_MS,
    );
    const countRes = await runQuery(
      connector,
      game,
      `SELECT count(*) FROM ${dest}`,
      STATEMENT_TIMEOUT_MS,
    );
    const rows = Number(countRes.rows[0]?.[0] ?? 0);
    return { table, dateColumn, rows, ms: Date.now() - started, status: 'ok' };
  } catch (err) {
    return {
      table,
      dateColumn,
      rows: null,
      ms: Date.now() - started,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const connector = lakehouseConnectorFromEnv();
  console.log(
    `Loading last ${DAYS}d test data for [${GAMES.join(', ')}] → ` +
      `${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}".<game>__* (timeout ${STATEMENT_TIMEOUT_MS / 1000}s/stmt)\n`,
  );

  const schemaColumns = await loadColumns(connector);
  await runQuery(
    connector,
    GAMES[0],
    `CREATE SCHEMA IF NOT EXISTS ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}"`,
    STATEMENT_TIMEOUT_MS,
  );
  const summary: Array<{ game: string; outcomes: Outcome[] }> = [];

  for (const game of GAMES) {
    const tables = schemaColumns.get(game);
    if (!tables || tables.size === 0) {
      console.log(`! ${game}: no tables found in ${SOURCE_CATALOG} — skipped\n`);
      continue;
    }
    console.log(`# ${game} → ${LAKEHOUSE_CATALOG}."${DEST_SCHEMA}".${game}__* (${tables.size} tables)`);

    const outcomes: Outcome[] = [];
    for (const [table, columns] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
      const dateColumn = pickDateColumn(columns);
      const outcome = await copyTable(connector, game, table, dateColumn);
      outcomes.push(outcome);
      const filt = dateColumn ? `${dateColumn} ≥ -${DAYS}d` : 'FULL';
      const detail =
        outcome.status === 'ok'
          ? `${outcome.rows?.toLocaleString()} rows`
          : `FAILED — ${outcome.error}`;
      console.log(
        `  ${outcome.status === 'ok' ? '✓' : '✗'} ${table.padEnd(46)} [${filt}] ${detail} (${(outcome.ms / 1000).toFixed(1)}s)`,
      );
    }
    summary.push({ game, outcomes });
    console.log('');
  }

  console.log('=== Summary ===');
  let failures = 0;
  for (const { game, outcomes } of summary) {
    const ok = outcomes.filter((o) => o.status === 'ok');
    const failed = outcomes.filter((o) => o.status === 'failed');
    failures += failed.length;
    const totalRows = ok.reduce((s, o) => s + (o.rows ?? 0), 0);
    console.log(
      `${game}: ${ok.length} ok / ${failed.length} failed · ${totalRows.toLocaleString()} rows`,
    );
    for (const f of failed) console.log(`   ✗ ${f.table}: ${f.error}`);
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
