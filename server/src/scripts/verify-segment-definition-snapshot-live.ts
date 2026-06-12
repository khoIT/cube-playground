/**
 * One-off live verification for the definition snapshot:
 * ensure table → write today's definitions for all eligible segments →
 * read back rows + show per-segment hash so change detection can be
 * eyeballed against a future edit.
 *
 * Usage (from server/): npx tsx --env-file=../.env --env-file=../.env.local \
 *   src/scripts/verify-segment-definition-snapshot-live.ts
 */

import {
  lakehouseConnectorFromEnv,
  ensureLakehouseTables,
  LAKEHOUSE_SCHEMA,
} from '../lakehouse/lakehouse-trino-connector.js';
import {
  writeSegmentDefinitions,
  SEGMENT_DEFINITION_DAILY,
} from '../lakehouse/segment-definition-writer.js';
import {
  listSnapshotEligibleSegments,
  gmt7DateString,
} from '../jobs/snapshot-segment-membership.js';
import { runQuery } from '../services/trino-rest-client.js';
import { closeDb } from '../db/sqlite.js';

async function main(): Promise<void> {
  const connector = lakehouseConnectorFromEnv();
  console.log('ensuring lakehouse tables…');
  await ensureLakehouseTables(connector);

  const segments = listSnapshotEligibleSegments();
  const date = gmt7DateString();
  console.log(`writing ${segments.length} definitions for ${date}…`);
  const res = await writeSegmentDefinitions(segments, date, { connector });
  console.log('result:', JSON.stringify(res));

  const readBack = await runQuery(
    connector,
    LAKEHOUSE_SCHEMA,
    `SELECT snapshot_date, game_id, segment_id, definition_hash, name, identity_field
       FROM ${SEGMENT_DEFINITION_DAILY} ORDER BY snapshot_date DESC, game_id, segment_id LIMIT 40`,
    60_000,
  );
  console.log('--- segment_definition_daily ---');
  for (const row of readBack.rows) console.log(row.join('\t'));
  closeDb();
}

main().catch((err) => {
  console.error('verification failed:', (err as Error).message);
  process.exit(1);
});
