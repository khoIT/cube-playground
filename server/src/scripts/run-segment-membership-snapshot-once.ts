/**
 * Manual one-shot of the nightly membership snapshot for today (GMT+7).
 * Same code path as the cron tick, minus the env gate + daily guard — for
 * bridging days until SEGMENT_SNAPSHOT_ENABLED lands on the prod instance,
 * and for verification after writer changes. Idempotent per date.
 *
 * Usage (from server/): npx tsx --env-file=../.env --env-file=../.env.local \
 *   src/scripts/run-segment-membership-snapshot-once.ts
 */

import { runSegmentMembershipSnapshot } from '../jobs/snapshot-segment-membership.js';
import { closeDb } from '../db/sqlite.js';

runSegmentMembershipSnapshot()
  .then((summary) => {
    console.log('summary:', JSON.stringify(summary));
    closeDb();
  })
  .catch((err) => {
    console.error('snapshot run failed:', (err as Error).message);
    process.exit(1);
  });
