/**
 * Shared gate for the lakehouse transition-matrix reads (lifecycle flow + payer
 * tier migration).
 *
 * The from→to matrices self-join the daily member-state snapshot, so they only
 * have data where that snapshot job runs. Default the read to the snapshot job's
 * own flag (SEGMENT_SNAPSHOT_ENABLED) so the feature auto-lights when an operator
 * enables snapshots, with an explicit LIFECYCLE_TRANSITIONS_ENABLED override for
 * a read-only replica that serves but does not write. Read at call-time so
 * `.env.local` toggles it without a rebuild.
 */
export function transitionsReadEnabled(): boolean {
  const explicit = (process.env.LIFECYCLE_TRANSITIONS_ENABLED ?? '').toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return (process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() === 'true';
}

/** Disclosure shown when the read is gated off in this environment. */
export const TRANSITIONS_DISABLED_REASON =
  'Transition flows light up where the daily snapshot job runs ' +
  '(SEGMENT_SNAPSHOT_ENABLED). Not enabled in this environment, so only the ' +
  'full-population current state is shown.';
