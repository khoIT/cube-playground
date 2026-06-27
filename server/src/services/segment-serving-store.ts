/**
 * DB glue between the segments table / api_keys / snapshot log and the pure
 * serving-contract compute. Isolated here so segments.ts stays thin and the
 * contract math stays pure/testable in segment-serving-contract.ts.
 */

import type Database from 'better-sqlite3';
import { listKeys } from '../auth/api-key-store.js';
import { canKeyAccessSegment } from '../auth/api-key-scope.js';
import {
  computeContract,
  type EntitledKey,
  type ServingContract,
} from './segment-serving-contract.js';

function snapshotEnabled(): boolean {
  return (process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() === 'true';
}

/** Latest successfully-written snapshot run time for a segment (UTC), or null. */
export function latestSnapshotAt(db: Database.Database, segmentId: string): string | null {
  const row = db
    .prepare(
      `SELECT ts FROM segment_snapshot_log
        WHERE segment_id = ? AND status = 'written'
        ORDER BY ts DESC LIMIT 1`,
    )
    .get(segmentId) as { ts: string } | undefined;
  return row?.ts ?? null;
}

type Row = Record<string, unknown>;

/** Active keys ENTITLED to read this segment by scope. `appliesVia` records
 *  whether the grant is an explicit segment allowlist or a wildcard (null
 *  segmentIds) — a rotated key is a new id, so display groups by label. */
export function entitledKeysForSegment(row: Row): EntitledKey[] {
  const scopeRow = {
    id: row.id as string,
    workspace: (row.workspace as string | null) ?? undefined,
    game_id: (row.game_id as string | null) ?? undefined,
  };
  return listKeys()
    .filter((k) => k.status === 'active')
    .filter((k) =>
      canKeyAccessSegment(
        { id: k.id, workspace: k.workspace, segmentIds: k.segmentIds, gameIds: k.gameIds, role: k.role },
        scopeRow,
      ),
    )
    .map((k) => ({
      id: k.id,
      label: k.label,
      appliesVia: k.segmentIds === null ? ('all-segments' as const) : ('segment' as const),
      lastUsedAt: k.lastUsedAt,
    }));
}

/** Build the full serving contract for one segment row. */
export function buildServing(db: Database.Database, row: Row, nowMs: number): ServingContract {
  return computeContract({
    lifecycle: (row.lifecycle as string) ?? 'draft',
    servedAt: (row.served_at as string | null) ?? null,
    servedBy: (row.served_by as string | null) ?? null,
    trackCadence: row.track_cadence,
    lastSnapshotAt: latestSnapshotAt(db, row.id as string),
    snapshotEnabled: snapshotEnabled(),
    entitledKeys: entitledKeysForSegment(row),
    nowMs,
  });
}

/** Serving contracts for a list of rows, keyed by id. Draft rows map to null —
 *  exploration segments have no contract, which also bounds the cost to the small
 *  served/deprecated set (no per-row snapshot/key scan on the big draft lane). */
export function buildServingBatch(
  db: Database.Database,
  rows: Row[],
  nowMs: number,
): Map<string, ServingContract | null> {
  const out = new Map<string, ServingContract | null>();
  for (const row of rows) {
    const lifecycle = (row.lifecycle as string) ?? 'draft';
    out.set(row.id as string, lifecycle === 'draft' ? null : buildServing(db, row, nowMs));
  }
  return out;
}
