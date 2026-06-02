/**
 * Refresh a single live segment: re-run its cached Cube query, extract uids
 * from the identity-dim column, dedupe, and persist. Status transitions:
 *   fresh → refreshing → fresh   (happy path)
 *   fresh → refreshing → broken  (on Cube error or timeout)
 */

import { getDb } from '../db/sqlite.js';
import { setSegmentStatus, setSegmentSizeAndUids } from '../services/segment-status.js';
import { resolveDrift } from '../services/drift-resolver.js';
import { runPresetCards } from '../services/card-runner.js';
import { upsertCardCache } from '../services/card-cache-store.js';
import { pickPresetForCube } from '../presets/mf-users-hub.js';
import { resolveGamePrefix } from '../services/resolve-game-prefix.js';
import { logicalCube } from '../services/cube-member-resolver.js';
import { resolveIdentityField } from '../services/resolve-identity-field.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { loadWithContinueWait } from '../services/load-with-continue-wait.js';

const PER_SEGMENT_TIMEOUT_MS = 60_000;

/** Cube core caps single-page responses (default 10,000). We page through to
 *  materialize the full uid list, but never store more than MAX_UID_LIST
 *  uids — anything beyond that is a sample. `uid_count` always reflects the
 *  true total from the `total: true` size query. */
const UID_PAGE_SIZE = 10_000;
const MAX_UID_LIST = 100_000;

interface SegmentRow {
  id: string;
  cube: string | null;
  cube_query_json: string | null;
  predicate_tree_json: string | null;
  predicate_meta_version: string | null;
  type: string;
  status: string;
  broken_reason: string | null;
  uid_list_json: string;
  game_id: string | null;
}

// Transient infra errors (Cube/Trino unreachable, DNS, timeouts) shouldn't
// mutate segment state — bumping status/broken_reason every minute while the
// cluster is down generates pointless DB churn that noisily drifts the
// segments seed snapshot. When detected, we restore the segment to its prior
// status instead of marking it broken.
const TRANSIENT_ERROR_RE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|fetch failed|timed out after/i;

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_RE.test(msg);
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

export async function refreshSegment(segmentId: string): Promise<void> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId) as SegmentRow | undefined;
  if (!row) return;
  if (row.type !== 'predicate' || !row.cube || !row.cube_query_json) return;

  // Captured so a transient-network catch below can restore them instead of
  // marking the segment broken with a fresh per-attempt error message.
  const priorStatus = row.status as 'fresh' | 'refreshing' | 'broken' | 'stale';
  const priorReason = row.broken_reason;

  setSegmentStatus(segmentId, 'refreshing', null);

  // Per-segment Cube token — the segment stores game_id, mint or look up the
  // JWT for that tenant so /load and /meta hit the right yaml. Falls back to
  // the global CUBE_TOKEN env when no game-scoped token resolves.
  const token = row.game_id ? resolveCubeTokenForGame(row.game_id) ?? undefined : undefined;

  try {
    const identity = await resolveIdentityField(row.cube, row.game_id);
    if (!identity) {
      setSegmentStatus(segmentId, 'broken', `no identity-field mapping for ${row.cube}`);
      return;
    }

    // Drift check — re-translate predicate against current /meta if schema moved.
    let cubeQueryJson = row.cube_query_json;
    try {
      const drift = await resolveDrift(
        {
          predicate_tree_json: row.predicate_tree_json,
          predicate_meta_version: row.predicate_meta_version,
        },
        token,
      );
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

    // Two-phase fetch to avoid Cube's default 10k rowLimit truncating the
    // cohort size. Phase 1 asks Cube for the TRUE distinct-row count via
    // `total: true` (returned in the response annotations, separate from the
    // capped `data` array). Phase 2 paginates `limit + offset` to materialize
    // the uid list up to MAX_UID_LIST. Storing more than 100k uids inline
    // would balloon the SQLite row; downstream consumers should treat the
    // list as a sample once it exceeds the cap.
    const identityOnlyBase = {
      ...baseQuery,
      // Replace any pre-existing dimensions with just the identity dim so
      // Cube returns one row per unique user — adding extra dims would
      // inflate row count via cartesian expansion and hit the page cap
      // faster.
      dimensions: [identity],
    };

    const sizeResult = await withTimeout(
      loadWithContinueWait(
        { ...identityOnlyBase, limit: 1, total: true },
        token,
        PER_SEGMENT_TIMEOUT_MS,
      ),
      PER_SEGMENT_TIMEOUT_MS,
      `segment size ${segmentId}`,
    );
    const sizeTyped = sizeResult as {
      total?: number;
      results?: Array<{ total?: number }>;
    };
    const totalCount =
      sizeTyped.total ?? sizeTyped.results?.[0]?.total ?? 0;

    const seen = new Set<string>();
    const uids: string[] = [];
    let offset = 0;
    while (uids.length < totalCount && uids.length < MAX_UID_LIST) {
      const pageResult = await withTimeout(
        loadWithContinueWait(
          { ...identityOnlyBase, limit: UID_PAGE_SIZE, offset },
          token,
          PER_SEGMENT_TIMEOUT_MS,
        ),
        PER_SEGMENT_TIMEOUT_MS,
        `segment page ${segmentId}@${offset}`,
      );
      const pageTyped = pageResult as {
        data?: Array<Record<string, unknown>>;
        results?: Array<{ data?: Array<Record<string, unknown>> }>;
      };
      const rows = pageTyped.data ?? pageTyped.results?.[0]?.data ?? [];
      if (rows.length === 0) break;
      for (const r of rows) {
        const v = r[identity];
        if (v == null) continue;
        const key = String(v);
        if (seen.has(key)) continue;
        seen.add(key);
        uids.push(key);
        if (uids.length >= MAX_UID_LIST) break;
      }
      if (rows.length < UID_PAGE_SIZE) break;
      offset += UID_PAGE_SIZE;
    }

    // Observability: when the segment had pre-existing uids (warm cache from
    // a push-to-segment Live save, or a prior refresh), log the delta so we
    // can spot predicate↔warm-cache divergence after creation. Also flag when
    // the materialized list is a truncated sample (count > MAX_UID_LIST).
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
          `[refresh-segment] ${segmentId} delta: prev=${prevUids.length} next=${uids.length}/${totalCount} added=${added} removed=${removed} overlap=${overlap} (${(overlapRatio * 100).toFixed(1)}%)`,
        );
      }
      if (totalCount > MAX_UID_LIST) {
        console.warn(
          `[refresh-segment] ${segmentId} cohort size ${totalCount} exceeds MAX_UID_LIST=${MAX_UID_LIST}; uid_list stores a sample of ${uids.length}.`,
        );
      }
    } catch {
      // Best-effort logging only — never block the refresh.
    }

    setSegmentSizeAndUids(segmentId, totalCount, uids, 'fresh');

    // Persist refresh-log row so Library sparkline + Detail Monitor history
    // can render from a single source of truth. Retention is handled by the
    // standalone pruner in `refresh-log-retention.ts` on a coarse cron tick.
    try {
      db.prepare(
        'INSERT INTO segment_refresh_log (segment_id, uid_count, status) VALUES (?, ?, ?)',
      ).run(segmentId, totalCount, 'fresh');
    } catch (err) {
      console.warn(
        `[refresh-segment] failed to write refresh-log for ${segmentId}:`,
        (err as Error).message,
      );
    }

    // Pre-render preset cards so the FE can hydrate synchronously.
    // Failures here don't roll back the segment refresh — cards just fall
    // back to live fetch when their entry is missing from the cache.
    // On prefix workspaces the stored cube is physical (`ballistar_mf_users`);
    // match the preset by its logical name so the same preset serves all games.
    const prefix = resolveGamePrefix(row.game_id);
    const preset = pickPresetForCube(logicalCube(row.cube, prefix));
    if (preset) {
      try {
        // baseQuery.filters IS the segment's predicate translated to Cube
        // filters — pass it as the slice scope so card measures (revenue, LTV)
        // reflect the cohort's defining slice, not each user's full history.
        // The preset's logical members are physicalized inside runPresetCards.
        const sliceFilters = Array.isArray(baseQuery.filters) ? baseQuery.filters : [];
        const entries = await runPresetCards(preset, uids, token, sliceFilters, prefix);
        upsertCardCache(segmentId, entries);
      } catch (err) {
        console.warn(`[refresh-segment] card-runner failed for ${segmentId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    // Cube/Trino unreachable etc. — restore prior state instead of writing a
    // fresh "broken" row. Prevents minute-by-minute churn during an outage.
    if (isTransientNetworkError(err)) {
      const fallback = priorStatus === 'refreshing' ? 'stale' : priorStatus;
      setSegmentStatus(segmentId, fallback, priorReason);
      return;
    }
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
