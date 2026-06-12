/**
 * Read-only recon: verify segment membership snapshot partitions are landing in
 * the shared lakehouse (stag_iceberg.khoitn). Works from a dev machine — the
 * lakehouse connector falls back to cube-dev/.env for Trino creds.
 *
 * Usage: npx tsx src/scripts/verify-lakehouse-snapshot-partitions.ts
 */

import {
  lakehouseConnectorFromEnv,
  LAKEHOUSE_SCHEMA,
  SEGMENT_MEMBERSHIP_DAILY,
  SEGMENT_MEMBERSHIP_DELTA,
} from '../lakehouse/lakehouse-trino-connector.js';
import { runQuery } from '../services/trino-rest-client.js';

const TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const connector = lakehouseConnectorFromEnv();

  const dailySql = `SELECT snapshot_date, game_id, count(distinct segment_id) AS segments, count(*) AS rows
    FROM ${SEGMENT_MEMBERSHIP_DAILY}
    GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 30`;
  const deltaSql = `SELECT snapshot_date, game_id, change, count(*) AS rows
    FROM ${SEGMENT_MEMBERSHIP_DELTA}
    GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3 LIMIT 30`;

  console.log('--- segment_membership_daily (latest partitions) ---');
  const daily = await runQuery(connector, LAKEHOUSE_SCHEMA, dailySql, TIMEOUT_MS);
  for (const row of daily.rows) console.log(row.join('\t'));

  console.log('--- segment_membership_delta (latest partitions) ---');
  const delta = await runQuery(connector, LAKEHOUSE_SCHEMA, deltaSql, TIMEOUT_MS);
  for (const row of delta.rows) console.log(row.join('\t'));
}

main().catch((err) => {
  console.error('verification failed:', (err as Error).message);
  process.exit(1);
});
