/**
 * Refresh a single live segment: re-run its cached Cube query, extract uids
 * from the identity-dim column, dedupe, and persist. Status transitions:
 *   fresh → refreshing → fresh   (happy path)
 *   fresh → refreshing → broken  (on Cube error or timeout)
 */

import { getDb } from '../db/sqlite.js';
import { setSegmentStatus, setSegmentSizeAndUids } from '../services/segment-status.js';
import { resolveDrift } from '../services/drift-resolver.js';
import { parseCubeSegments, withCubeSegments } from '../services/cube-query-segments.js';
import { runPresetCards } from '../services/card-runner.js';
import { upsertCardCache } from '../services/card-cache-store.js';
import { computeMemberTiers } from '../services/member-tier-runner.js';
import { computeMemberProfiles } from '../services/member-profile-runner.js';
import { getMetaMemberSets } from '../services/cube-meta-members.js';
import { pickSegmentRankMeasure, type RankFilter } from '../services/segment-rank-measure.js';
import { pruneMember360CacheToUids } from '../services/member360-cache-store.js';
import { tieredUids } from '../services/member360-runner.js';
import { pickPresetForSegment } from '../presets/registry.js';
import { resolveGamePrefixForWorkspace } from '../services/resolve-game-prefix.js';
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
  workspace: string;
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
  // Only predicate segments are precomputed. Manual segments are explicit uid
  // pushes with no predicate to re-run; their Insights cards are live-fetched on
  // demand (FE scopes by identity-IN over the uid_list). Precomputing large
  // manual cohorts would inline a multi-MB identity-IN filter that Cube rejects
  // (query text length > limit) — the same reason server card scoping is
  // predicate-only. Keep manual segments live by design.
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
    const identity = await resolveIdentityField(row.cube, row.game_id, {
      workspaceId: row.workspace,
    });
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
          // Lets the resolver flag cube segments removed from the model as
          // explicit drift ("… (cube segment)") instead of an opaque /load error.
          cube_query_json: row.cube_query_json,
        },
        token,
      );
      if (drift.drifted) {
        if (drift.rehydrated) {
          // Rehydration rebuilds the query from the predicate tree, which
          // cannot express cube-level segments — re-attach the sidecar from
          // the prior stored query or membership silently widens.
          cubeQueryJson = JSON.stringify(
            withCubeSegments(drift.newCubeQuery, parseCubeSegments(row.cube_query_json)),
          );
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
    // When the segment's cube has no curated preset, pivot to the IDENTITY
    // ANCHOR cube's preset (the cube the resolved identity field lives on —
    // e.g. `mf_users` for join-inherited etl_* identities); its card queries
    // join back through the same path that proved the inheritance.
    const prefix = resolveGamePrefixForWorkspace(row.workspace, row.game_id);
    const anchorCube = identity.includes('.') ? identity.split('.')[0] : null;
    const preset = pickPresetForSegment(
      logicalCube(row.cube, prefix),
      anchorCube ? logicalCube(anchorCube, prefix) : null,
    );
    const segmentFilters = Array.isArray(baseQuery.filters) ? baseQuery.filters : [];
    // Cube-level segments from the same stored query — every cohort-scoped
    // query below (cards, tiers) must carry them, or it reports the
    // unsegmented population while the size query (baseQuery) is scoped.
    const cohortCubeSegments = parseCubeSegments(cubeQueryJson) ?? [];

    // Rank members by the segment's DEFINING metric when its predicate filters
    // on a measure (a "30d spend" cohort ranks by that spend), else the
    // preset's generic per-user LTV. /meta tells measures from dimensions;
    // when it's unreachable the picker falls back to the LTV measure.
    const metaSets = await getMetaMemberSets(row.game_id);
    const rankMeasure = pickSegmentRankMeasure(
      segmentFilters as RankFilter[],
      metaSets,
      prefix,
      preset?.ltvMeasure ?? null,
    );

    // Tiered member sampling: rank the cohort by the rank measure and persist
    // top/middle/bottom-50 subgroups (Members tab + the member-360 precompute
    // consume them). Predicate-scoped like the cards — never an inlined
    // uid-IN list. Failure leaves the previous tiers in place (their
    // computed_at makes staleness visible); no rank measure at all clears them
    // so the FE falls back to the random sample.
    if (rankMeasure) {
      const tiers = await computeMemberTiers({
        identityDim: identity,
        ltvMeasure: rankMeasure,
        segmentFilters,
        cubeSegments: cohortCubeSegments,
        totalCount,
        tokenOverride: token,
        prefix,
      });
      if (tiers) {
        db.prepare('UPDATE segments SET member_tiers_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(tiers), new Date().toISOString(), segmentId);
        // Tier membership just changed — drop member-360 cache rows for uids
        // that left the tiers. Surviving uids keep their rows; new uids fill
        // next nightly precompute window (or via the manual trigger).
        pruneMember360CacheToUids(segmentId, tieredUids(tiers));
      }
      // tiers === null (transient compute failure): keep prior tiers AND their
      // cache — staleness is visible via computed_at, never destroyed by a blip.
    } else {
      db.prepare('UPDATE segments SET member_tiers_json = NULL WHERE id = ?').run(segmentId);
      // No rank measure → segment is no longer member-360 eligible; clear cache.
      pruneMember360CacheToUids(segmentId, []);
    }

    // Ranked member-profile snapshot for the tokenless pull API: top members
    // by the same rank measure, enriched with the preset's member columns.
    // Failure (null) keeps the previous snapshot — same posture as tiers.
    const profiles = await computeMemberProfiles({
      identityDim: identity,
      rankMeasure,
      memberColumns: (preset?.memberColumns ?? []) as Array<Record<string, unknown>>,
      metaSets,
      segmentFilters: segmentFilters as RankFilter[],
      cubeSegments: cohortCubeSegments,
      totalCount,
      tokenOverride: token,
      prefix,
    });
    if (profiles) {
      db.prepare('UPDATE segments SET member_profiles_json = ? WHERE id = ?')
        .run(JSON.stringify(profiles), segmentId);
    }

    if (preset) {
      try {
        // Scope cards by the segment's predicate filters — the same basis as
        // the size query above — rather than the materialized uid list. The uid
        // list can be millions of entries; inlining it as an identity-IN filter
        // blows past Cube's query-text length limit (HTTP 400). The preset's
        // logical members are physicalized inside runPresetCards via `prefix`.
        const entries = await runPresetCards(preset, segmentFilters, token, prefix, cohortCubeSegments);
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
