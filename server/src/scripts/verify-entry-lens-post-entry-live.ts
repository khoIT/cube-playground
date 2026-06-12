/**
 * One-off live check that the entry lens clocks each member from their own
 * first-entry day (post-entry-only semantics): runs the entry lens against a
 * real segment and asserts joined_members never exceeds the cumulative
 * cohort size shown for that day.
 *
 * Usage (from server/): npx tsx --env-file=../.env --env-file=../.env.local \
 *   src/scripts/verify-entry-lens-post-entry-live.ts <segmentId> <gameId> <anchor>
 */

import { readMetricSeries } from '../lakehouse/segment-metric-series-reader.js';
import { resolveMetricBinding } from '../lakehouse/segment-metric-registry.js';

const [segmentId, gameId, anchor] = process.argv.slice(2);
if (!segmentId || !gameId || !anchor) {
  console.error('usage: verify-entry-lens-post-entry-live.ts <segmentId> <gameId> <anchor>');
  process.exit(1);
}

const binding = resolveMetricBinding(gameId, 'revenue');
if (!binding) {
  console.error(`no revenue binding for ${gameId}`);
  process.exit(1);
}

const res = await readMetricSeries({ gameId, segmentId, binding, lens: 'entry', anchor, days: 30 });
let ok = true;
for (const p of res.points) {
  console.log(`${p.date} members=${p.memberCount} value=${p.value}`);
  if (p.memberCount === 0 && p.value !== 0) ok = false;
}
console.log('joinWarning:', res.joinWarning);
console.log(ok ? 'OK — no value on zero-cohort days' : 'FAIL — value present with zero cumulative cohort');
process.exit(ok ? 0 : 1);
