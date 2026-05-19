/**
 * Refresh a single live segment: re-run its cached Cube query, extract uids
 * from the identity-dim column, dedupe, and persist. Status transitions:
 *   fresh → refreshing → fresh   (happy path)
 *   fresh → refreshing → broken  (on Cube error or timeout)
 */

import { getDb } from '../db/sqlite.js';
import { load } from '../services/cube-client.js';
import { setSegmentStatus, setSegmentUids } from '../services/segment-status.js';
import { resolveDrift } from '../services/drift-resolver.js';

const PER_SEGMENT_TIMEOUT_MS = 60_000;

interface SegmentRow {
  id: string;
  cube: string | null;
  cube_query_json: string | null;
  predicate_tree_json: string | null;
  predicate_meta_version: string | null;
  type: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function getIdentityField(cube: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
    .get(cube) as { identity_field: string } | undefined;
  return row?.identity_field ?? null;
}

export async function refreshSegment(segmentId: string): Promise<void> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId) as SegmentRow | undefined;
  if (!row) return;
  if (row.type !== 'predicate' || !row.cube || !row.cube_query_json) return;

  setSegmentStatus(segmentId, 'refreshing', null);

  try {
    const identity = await getIdentityField(row.cube);
    if (!identity) {
      setSegmentStatus(segmentId, 'broken', `no identity-field mapping for ${row.cube}`);
      return;
    }

    // Drift check — re-translate predicate against current /meta if schema moved.
    let cubeQueryJson = row.cube_query_json;
    try {
      const drift = await resolveDrift({
        predicate_tree_json: row.predicate_tree_json,
        predicate_meta_version: row.predicate_meta_version,
      });
      if (drift.drifted) {
        if (drift.rehydrated) {
          cubeQueryJson = JSON.stringify(drift.newCubeQuery);
          db.prepare(`
            UPDATE segments
               SET cube_query_json = ?, predicate_meta_version = ?, updated_at = ?
             WHERE id = ?
          `).run(cubeQueryJson, drift.newMetaVersion, new Date().toISOString(), segmentId);
        } else {
          setSegmentStatus(
            segmentId,
            'broken',
            `Schema drift — missing members: ${drift.missingMembers.join(', ')}`,
          );
          return;
        }
      }
    } catch {
      // Drift resolution errors don't block the refresh; fall through to /load.
    }

    const baseQuery = JSON.parse(cubeQueryJson);
    const fullQuery = {
      ...baseQuery,
      dimensions: Array.from(
        new Set([...(baseQuery.dimensions ?? []), identity] as string[]),
      ),
      limit: 5000,
    };

    const result = await withTimeout(
      load(fullQuery),
      PER_SEGMENT_TIMEOUT_MS,
      `refresh segment ${segmentId}`,
    );

    const rows = ((result as { results?: Array<{ data?: Array<Record<string, unknown>> }> }).results?.[0]?.data ?? []);
    const seen = new Set<string>();
    const uids: string[] = [];
    for (const r of rows) {
      const v = r[identity];
      if (v == null) continue;
      const key = String(v);
      if (seen.has(key)) continue;
      seen.add(key);
      uids.push(key);
    }

    setSegmentUids(segmentId, uids, 'fresh');
  } catch (err) {
    setSegmentStatus(segmentId, 'broken', (err as Error).message);
  }
}
