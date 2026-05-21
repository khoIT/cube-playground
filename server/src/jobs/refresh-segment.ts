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
import { runPresetCards } from '../services/card-runner.js';
import { upsertCardCache } from '../services/card-cache-store.js';
import { pickPresetForCube } from '../presets/mf-users-hub.js';
import { suggestIdentities } from '../services/identity-suggester.js';

const PER_SEGMENT_TIMEOUT_MS = 60_000;

interface SegmentRow {
  id: string;
  cube: string | null;
  cube_query_json: string | null;
  predicate_tree_json: string | null;
  predicate_meta_version: string | null;
  type: string;
  uid_list_json: string;
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

const AUTO_SUGGEST_MIN_CONFIDENCE = 0.9;

async function getIdentityField(cube: string): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
    .get(cube) as { identity_field: string } | undefined;
  if (row?.identity_field) return row.identity_field;

  // No manual override — fall back to the auto-suggester so a "revert to
  // auto-suggest" click in Settings doesn't break every segment on this cube.
  // Only accept high-confidence matches (`*.user_id`, `*.player_id`, etc.).
  try {
    const suggestions = await suggestIdentities();
    const hit = suggestions.find(
      (s) => s.cube === cube && s.identity_field && s.confidence >= AUTO_SUGGEST_MIN_CONFIDENCE,
    );
    return hit?.identity_field ?? null;
  } catch {
    return null;
  }
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

    // Cube /load returns { data: [...] } at top level (single-query form).
    // The batch /load endpoint uses { results: [{ data: [...] }] } but the
    // cube-client wraps a single query, so we read the top-level data array.
    const typed = result as {
      data?: Array<Record<string, unknown>>;
      results?: Array<{ data?: Array<Record<string, unknown>> }>;
    };
    const rows = typed.data ?? typed.results?.[0]?.data ?? [];
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

    // Observability: when the segment had pre-existing uids (warm cache from
    // a push-to-segment Live save, or a prior refresh), log the delta so we
    // can spot predicate↔warm-cache divergence after creation.
    try {
      const prevUids = JSON.parse(row.uid_list_json ?? '[]') as string[];
      if (prevUids.length > 0) {
        const prevSet = new Set(prevUids);
        const nextSet = new Set(uids);
        const added = uids.filter((u) => !prevSet.has(u)).length;
        const removed = prevUids.filter((u) => !nextSet.has(u)).length;
        const overlap = uids.length - added;
        const overlapRatio = prevUids.length ? overlap / prevUids.length : 1;
        console.log(
          `[refresh-segment] ${segmentId} delta: prev=${prevUids.length} next=${uids.length} added=${added} removed=${removed} overlap=${overlap} (${(overlapRatio * 100).toFixed(1)}%)`,
        );
      }
    } catch {
      // Best-effort logging only — never block the refresh.
    }

    setSegmentUids(segmentId, uids, 'fresh');

    // Persist refresh-log row so Library sparkline + Detail Monitor history
    // can render from a single source of truth. Retention capped at 90 days.
    try {
      db.prepare(
        'INSERT INTO segment_refresh_log (segment_id, uid_count, status) VALUES (?, ?, ?)',
      ).run(segmentId, uids.length, 'fresh');
      db.prepare(
        "DELETE FROM segment_refresh_log WHERE ts < datetime('now', '-90 days')",
      ).run();
    } catch (err) {
      console.warn(
        `[refresh-segment] failed to write refresh-log for ${segmentId}:`,
        (err as Error).message,
      );
    }

    // Pre-render preset cards so the FE can hydrate synchronously.
    // Failures here don't roll back the segment refresh — cards just fall
    // back to live fetch when their entry is missing from the cache.
    const preset = pickPresetForCube(row.cube);
    if (preset) {
      try {
        const entries = await runPresetCards(preset, uids);
        upsertCardCache(segmentId, entries);
      } catch (err) {
        console.warn(`[refresh-segment] card-runner failed for ${segmentId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    setSegmentStatus(segmentId, 'broken', (err as Error).message);
    try {
      const cur = db.prepare('SELECT uid_count FROM segments WHERE id = ?').get(segmentId) as
        | { uid_count: number }
        | undefined;
      db.prepare(
        'INSERT INTO segment_refresh_log (segment_id, uid_count, status) VALUES (?, ?, ?)',
      ).run(segmentId, cur?.uid_count ?? 0, 'broken');
    } catch {
      // refresh-log write is best-effort; never mask the primary error.
    }
  }
}
