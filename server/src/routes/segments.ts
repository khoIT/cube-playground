/**
 * Segment CRUD routes + append + refresh stub.
 * Authorization: segments are shared within a workspace (the read model lists
 * every segment in the active workspace regardless of owner). Writes mirror
 * that — any caller in the same workspace may edit/delete. `owner` records
 * provenance, not a private boundary. Cross-workspace rows are treated as
 * not-found so the API never reveals segments outside the active workspace.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/sqlite.js';
import { treeToCubeFilters } from '../services/translator.js';
import { parseCubeSegments, withCubeSegments } from '../services/cube-query-segments.js';
import { predicateToSql } from '../services/predicate-to-sql.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import type { MemberProfiles } from '../types/segment.js';
import { parseUidCsv, MAX_ROWS } from '../services/csv-importer.js';
import { enqueueRefresh } from '../jobs/refresh-queue.js';
import { getCardCache } from '../services/card-cache-store.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { glossaryTermsReferencingArtifact } from '../services/concept-ref-integrity.js';
import { invalidateReverseIndex } from '../services/concept-reverse-index.js';
import { SEGMENT_DEFAULT_VISIBILITY, VISIBILITY_VALUES } from '../services/trust-mapping.js';
import { canAccessSegment, canMutateSegment, canAdministerSegment } from '../auth/can-access-segment.js';
import { emailForSub } from '../auth/principal.js';
import { corePanelsForGame } from '../services/member360-panel-registry.js';
import { triggerMember360Precompute } from '../services/member360-precompute-scheduler.js';
import { recordActivity } from '../services/activity-store.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fire-and-forget telemetry for a segment mutation. One `segment_op` event with
 * the action in detail (create/update/delete/refresh/append) keeps the spine
 * vocabulary small. Never carries cohort data — only the action + segment id.
 */
function emitSegmentOp(
  req: FastifyRequest,
  action: 'create' | 'update' | 'delete' | 'refresh' | 'append',
  segmentId: string,
): void {
  recordActivity(req.principal, {
    eventType: 'segment_op',
    targetType: 'segment',
    targetId: segmentId,
    workspace: req.workspace.id,
    detail: { action },
  });
}

const segmentInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['manual', 'predicate']),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
  game_id: z.string().min(1).max(64).optional(),
  /** Serialised FunnelDefinition — present when created via the funnel builder. */
  funnel_json: z.string().nullable().optional(),
  /**
   * Cube-level segments from the originating query (e.g. mf_users.whales).
   * Not representable in the predicate tree — stored as a `segments` sidecar
   * inside cube_query_json so cadence refreshes keep the same membership scope.
   */
  cube_segments: z.array(z.string().min(1)).nullable().optional(),
  /** Opt-in visibility. Defaults to 'personal'; 'org' is admin-only. */
  visibility: z.enum(VISIBILITY_VALUES).optional(),
});

const segmentPatchSchema = z.object({
  name: z.string().min(1).optional(),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
  /** Visibility setter. Owner may set personal/shared; 'org' is admin-only. */
  visibility: z.enum(VISIBILITY_VALUES).optional(),
});

function apiError(code: string, message: string, status: number) {
  return { statusCode: status, body: { error: { code, message } } };
}

/**
 * Index of the first element in a sorted array strictly greater than `key`.
 * Used by the members pull route for keyset pagination: the cursor is the last
 * uid of the previous page, and the next page starts at the first uid after it.
 */
function upperBound(sorted: string[], key: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type SegmentRow = Record<string, unknown> & { owner: string; visibility: string | null; workspace: string };

/**
 * Load a segment by id and enforce workspace + visibility access in one place.
 * Returns the row when permitted; otherwise sends the reply (404 unknown/
 * cross-workspace; 403 visibility-denied) and returns null. `mode` selects the
 * access predicate: 'read'/'mutate' are workspace-collaborative for shared/org
 * rows; 'administer' is the owner/admin-only destructive set (delete,
 * visibility change, cohort redefinition, activation removal).
 * Exported for sibling segment route modules (member-360 cache serving).
 */
export function guardSegment(
  req: FastifyRequest,
  reply: FastifyReply,
  id: string,
  mode: 'read' | 'mutate' | 'administer',
): SegmentRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as SegmentRow | undefined;
  if (!row) {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    return null;
  }
  // Cross-workspace rows are invisible — never reveal their existence.
  if (row.workspace !== req.workspace.id) {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    return null;
  }
  const allowed =
    mode === 'read'
      ? canAccessSegment(req.principal, row)
      : mode === 'administer'
        ? canAdministerSegment(req.principal, row)
        : canMutateSegment(req.principal, row);
  if (!allowed) {
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not permitted for this segment' } });
    return null;
  }
  return row;
}

/**
 * Reject an 'org' visibility change by a non-admin. `org` is governance-owned:
 * a non-admin may neither promote a segment TO 'org' (target) nor alter the
 * visibility of one that already IS 'org' (current). Returns true if it sent 403.
 */
function rejectNonAdminOrg(
  req: FastifyRequest,
  reply: FastifyReply,
  targetVisibility?: string,
  currentVisibility?: string | null,
): boolean {
  const touchesOrg = targetVisibility === 'org' || currentVisibility === 'org';
  if (touchesOrg && targetVisibility !== undefined && req.principal.role !== 'admin') {
    reply.status(403).send({ error: { code: 'FORBIDDEN', message: "Only an admin may change 'org' visibility" } });
    return true;
  }
  return false;
}

/**
 * Bulk-load tags for a set of segment ids in a single query, grouped by
 * segment id. Avoids the N+1 round-trip a per-row tag lookup would cause when
 * hydrating a list. Returns an empty map for an empty id list.
 */
function loadTagsBySegment(
  ids: string[],
  db: ReturnType<typeof getDb>,
): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  if (ids.length === 0) return byId;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT segment_id, tag FROM segment_tags WHERE segment_id IN (${placeholders})`)
    .all(...ids) as { segment_id: string; tag: string }[];
  for (const { segment_id, tag } of rows) {
    const list = byId.get(segment_id);
    if (list) list.push(tag);
    else byId.set(segment_id, [tag]);
  }
  return byId;
}

/**
 * Hydrate a raw segment row into the API shape. `preloadedTags` lets list
 * callers pass tags fetched in one bulk query (see loadTagsBySegment); when
 * omitted, single-row callers fall back to a per-row tag lookup.
 */
// SQLite `datetime('now')` — used by column defaults and the demo fixtures —
// stores naive UTC as a space-separated string with no zone marker. The
// browser's `new Date()` reads that form as LOCAL time, so the row renders off
// by the viewer's UTC offset (e.g. "created 7 hours ago" in GMT+7). App writes
// already use `new Date().toISOString()` (ISO-8601 with `Z`), so pass those
// through untouched and only stamp a `Z` onto the naive form. Null stays null.
const NAIVE_UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
function toIsoUtc(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return NAIVE_UTC_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
}

function hydrateSegment(
  row: Record<string, unknown>,
  db: ReturnType<typeof getDb>,
  preloadedTags?: string[],
  // The list view passes false: a segment's uid_list_json can be megabytes
  // (large cohorts have millions of uids), and JSON.parse is synchronous —
  // parsing every row on the single Node thread blocks the event loop and
  // starves all other requests. The list only needs uid_count; the full uid
  // array is fetched per-segment on the detail route.
  includeUidList = true,
  // Caller's principal — drives the computed `is_owner` / `can_administer`
  // flags the FE uses to gate controls. Omitted (internal callers) → both false.
  viewer?: { sub: string; role?: string },
) {
  // Never ship the raw JSON blobs: no consumer reads `uid_list_json` /
  // `member_tiers_json` / `member_profiles_json` (profiles serve the members
  // pull route only), and for large cohorts the blobs multiply the payload.
  const { uid_list_json, member_tiers_json, member_profiles_json, ...rest } = row;
  void member_profiles_json;

  // LTV tiers ship on the detail route only (same gate as uid_list) — the
  // list view doesn't render members, so parsing ~150 rows per row is waste.
  let memberTiers: unknown = null;
  if (includeUidList && typeof member_tiers_json === 'string' && member_tiers_json) {
    try {
      memberTiers = JSON.parse(member_tiers_json);
    } catch {
      memberTiers = null;
    }
  }

  const tags =
    preloadedTags ??
    (
      db.prepare('SELECT tag FROM segment_tags WHERE segment_id = ?').all(rest.id) as {
        tag: string;
      }[]
    ).map((r) => r.tag);

  let activations: unknown[] = [];
  try {
    activations = JSON.parse((rest.activations_json as string) ?? '[]');
    if (!Array.isArray(activations)) activations = [];
  } catch {
    activations = [];
  }

  // Map NULL visibility to 'personal' — the default for user-created segments.
  // This preserves existing behavior: segments created before the visibility
  // column existed are treated as owner-private until the owner opts in to share.
  const visibility = (rest.visibility as string | null) ?? SEGMENT_DEFAULT_VISIBILITY;

  return {
    ...rest,
    // Normalize stored timestamps to unambiguous ISO-8601 UTC so the FE's
    // relative-time labels ("created … ago") aren't shifted by the viewer's
    // timezone for naive-default / fixture rows.
    created_at: toIsoUtc(rest.created_at),
    updated_at: toIsoUtc(rest.updated_at),
    last_refreshed_at: toIsoUtc(rest.last_refreshed_at),
    shared_at: toIsoUtc(rest.shared_at),
    // Legacy rows predate the owner_label column (NULL) — resolve the owner
    // sub to its email via the canonical user_access.kc_sub map so prod
    // doesn't render a Keycloak UUID. Still null when the owner never logged
    // in; FE then falls back to `owner`.
    owner_label: (rest.owner_label as string | null) ?? emailForSub(rest.owner as string),
    // is_owner stays LITERAL ownership — the FE "shared with you" rail keys
    // off it; an admin override here would misfile every org segment as the
    // admin's own. Admin capability ships on the separate can_administer flag.
    is_owner: viewer != null && rest.owner === viewer.sub,
    // Mirrors canAdministerSegment (owner or admin) so the FE can enable
    // owner-only controls (edit/delete/share) the API already permits.
    can_administer:
      viewer != null && (rest.owner === viewer.sub || viewer.role === 'admin'),
    tags,
    predicate_tree: rest.predicate_tree_json
      ? JSON.parse(rest.predicate_tree_json as string)
      : null,
    uid_list: includeUidList ? JSON.parse((uid_list_json as string) ?? '[]') : [],
    member_tiers: memberTiers,
    activations,
    funnel_json: (rest.funnel_json as string | null) ?? null,
    visibility,
  };
}

const VALID_ENVS = new Set(['dev', 'stag', 'prod']);
const METRIC_NAME_RE = /^[a-z0-9_]{1,64}$/;

export default async function segmentsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/segments
  app.get('/api/segments', async (req, reply) => {
    const { owner, type, q, sort, game_id } = req.query as Record<string, string | undefined>;
    const db = getDb();

    let sql = 'SELECT * FROM segments WHERE 1=1';
    const params: unknown[] = [];

    // Always scope by the active workspace so cross-workspace bleed is
    // structurally impossible. Routes use req.workspace.id from the header
    // (defaults to the registry default).
    sql += ' AND workspace = ?';
    params.push(req.workspace.id);

    // Visibility: admin sees all; everyone else sees shared/org segments plus
    // their own (NULL → personal via COALESCE, so correctness never depends on
    // a backfill or deploy order). owner key = sub (principal.sub), not email.
    if (req.principal.role !== 'admin') {
      sql += " AND (COALESCE(visibility,'personal') IN ('shared','org') OR owner = ?)";
      params.push(req.principal.sub);
    }

    if (owner && owner !== '*') {
      sql += ' AND owner = ?';
      params.push(owner);
    }
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (q) {
      sql += ' AND name LIKE ?';
      params.push(`%${q}%`);
    }
    if (game_id) {
      sql += ' AND game_id = ?';
      params.push(game_id);
    }

    const orderCol = sort === 'name' ? 'name' : 'created_at';
    sql += ` ORDER BY ${orderCol} DESC`;

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const tagsBySegment = loadTagsBySegment(
      rows.map((r) => r.id as string),
      db,
    );
    // Skip uid_list hydration on the list — see hydrateSegment's includeUidList.
    return rows.map((r) =>
      hydrateSegment(r, db, tagsBySegment.get(r.id as string) ?? [], false, { sub: req.principal.sub, role: req.principal.role }),
    );
  });

  // POST /api/segments
  app.post('/api/segments', async (req, reply) => {
    const parsed = segmentInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const data = parsed.data;
    if (rejectNonAdminOrg(req, reply, data.visibility)) return;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    const owner = req.owner;
    // Human-readable "shared by …" label, stamped at create time (chat parity).
    // Prefers the authenticated username/email; legacy rows stay NULL and the
    // FE falls back to rendering the owner sub.
    const ownerLabel = req.user?.username ?? req.user?.email ?? owner;
    // New segments default to 'personal' (owner-private) unless explicitly shared.
    const visibility = data.visibility ?? SEGMENT_DEFAULT_VISIBILITY;

    let cubeQueryJson: string | null = null;
    if (data.predicate_tree) {
      try {
        const filters = treeToCubeFilters(data.predicate_tree as PredicateNode);
        cubeQueryJson = JSON.stringify(withCubeSegments({ filters }, data.cube_segments));
      } catch (err) {
        return reply.status(400).send({
          error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
        });
      }
    }

    const uidList = data.uid_list ?? [];

    // Predicate segments may receive a "warm" uid_list — a sample from the
    // originating playground query, capped at Cube's default rowLimit (10k).
    // Using its length as the displayed `uid_count` would lie about the true
    // cohort size (every >10k cohort would display exactly 10,000 until the
    // first refresh). Start at 0 and let the refresh job write the real
    // total via Cube's `total: true`. Manual segments keep the old behavior:
    // the uid_list IS the cohort.
    const isPredicateWithQuery = data.type === 'predicate' && cubeQueryJson != null;
    const initialUidCount = isPredicateWithQuery ? 0 : uidList.length;
    // Flip status to 'refreshing' so the UI shows in-flight immediately
    // rather than briefly displaying 'fresh' with the placeholder count.
    const initialStatus = isPredicateWithQuery ? 'refreshing' : 'fresh';

    db.prepare(`
      INSERT INTO segments
        (id, name, type, owner, owner_label, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id, funnel_json, workspace, visibility)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      data.name,
      data.type,
      owner,
      ownerLabel,
      initialStatus,
      data.cube ?? null,
      data.predicate_tree ? JSON.stringify(data.predicate_tree) : null,
      cubeQueryJson,
      initialUidCount,
      JSON.stringify(uidList),
      data.refresh_cadence_min ?? null,
      now,
      now,
      data.game_id ?? loadGamesConfig().defaultGameId,
      data.funnel_json ?? null,
      req.workspace.id,
      visibility,
    );

    if (data.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of data.tags) insertTag.run(id, tag);
    }

    // Kick off the first refresh immediately so the displayed uid_count
    // converges to the true total instead of waiting up to one cadence
    // interval for the cron tick.
    if (isPredicateWithQuery) {
      void enqueueRefresh(id);
    }

    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    emitSegmentOp(req, 'create', id);
    return reply.status(201).send(hydrateSegment(row, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }));
  });

  // GET /api/segments/:id — includes prerendered card_cache for one-shot hydration
  app.get('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    return {
      ...hydrateSegment(row, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }),
      card_cache: getCardCache(id),
    };
  });

  // GET /api/segments/:id/members — TOKENLESS member pull API.
  //
  // Serves enriched member rows to downstream consumers (CS tooling) that
  // can't mint an app JWT. Deliberately unauthenticated: the segment UUID is
  // the capability, and the deployment is VPN-only — a consumer who has the
  // URL was handed it from the Activation tab. Read-only, serves only
  // refresh-time snapshots (never triggers a Cube query), and skips the
  // workspace-header check so a plain curl works.
  //
  // Preferred source: the ranked member-profile snapshot (refresh-time, top
  // 1000 by the segment's rank measure, enriched with the preset's member
  // columns — uid / name / ltv / joined / last_active…). Rows come back
  // RANKED; the cursor is a numeric offset into the static snapshot.
  // Fallback (no snapshot yet — e.g. manual segments): uid-only rows over the
  // sorted uid list with the legacy uid keyset cursor.
  //
  // `truncated` is the honest signal that the served list is a sample of a
  // larger cohort: `total_count` holds the true size from the refresh.
  // Consumers should pull only when `status === 'fresh'`. A predicate segment
  // mid-refresh seeds `uid_count` to 0 while a warm sample is still stored, so
  // `total_count` may read 0 alongside non-empty `members` until it completes.
  app.get('/api/segments/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as
      | SegmentRow
      | undefined;
    if (!row) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Segment not found' } });
    }

    const { cursor, limit: limitRaw } = req.query as { cursor?: string; limit?: string };
    const DEFAULT_LIMIT = 1000;
    const MAX_LIMIT = 10_000;
    const parsedLimit = Number.parseInt(limitRaw ?? '', 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const trueCount = Number(row.uid_count ?? 0);
    const base = {
      segment_id: id,
      game_id: (row.game_id as string) ?? null,
      cube: (row.cube as string | null) ?? null,
      computed_at: (row.last_refreshed_at as string | null) ?? null,
      total_count: trueCount,
    };

    // Ranked enriched snapshot, when the refresh has produced one.
    let profiles: MemberProfiles | null = null;
    try {
      const rawProfiles = row.member_profiles_json as string | null | undefined;
      if (typeof rawProfiles === 'string' && rawProfiles) {
        const parsed = JSON.parse(rawProfiles) as MemberProfiles;
        if (Array.isArray(parsed?.rows) && parsed.rows.length > 0) profiles = parsed;
      }
    } catch {
      profiles = null; // unreadable snapshot — serve the uid fallback
    }

    if (profiles) {
      // Offset cursor into the static ranked snapshot (stable until the next
      // refresh rewrites it atomically).
      const parsedCursor = Number.parseInt(cursor ?? '', 10);
      const start = Number.isFinite(parsedCursor) ? Math.max(parsedCursor, 0) : 0;
      const page = profiles.rows.slice(start, start + limit);
      return {
        ...base,
        computed_at: profiles.computed_at,
        rank_measure: profiles.rank_measure,
        columns: profiles.columns,
        returned_count: page.length,
        truncated: trueCount > profiles.rows.length,
        members: page,
        next_cursor: start + limit < profiles.rows.length ? String(start + limit) : null,
      };
    }

    // Fallback — uid-only rows over the materialized list (manual segments,
    // or predicate segments not refreshed since profiles shipped).
    let allUids: string[];
    try {
      const parsed = JSON.parse((row.uid_list_json as string) ?? '[]');
      // Dedup before paginating: keyset assumes unique sorted keys, so a
      // duplicate straddling a page boundary would otherwise be skipped (the
      // cursor advances past it). The refresh path writes Cube results verbatim
      // and the identity dimension is not guaranteed unique, so dedup here keeps
      // the pull a faithful "true identity set".
      allUids = Array.isArray(parsed) ? [...new Set((parsed as string[]).map(String))] : [];
    } catch {
      allUids = [];
    }
    // Sort once so keyset ordering is deterministic and the cursor is meaningful.
    allUids.sort();

    // Keyset: take uids strictly greater than the cursor (start at 0 when absent).
    const start = cursor ? upperBound(allUids, cursor) : 0;
    const page = allUids.slice(start, start + limit);
    const nextCursor = start + limit < allUids.length ? (page[page.length - 1] ?? null) : null;

    return {
      ...base,
      total_count: trueCount > 0 ? trueCount : allUids.length,
      rank_measure: null,
      columns: [],
      returned_count: page.length,
      truncated: trueCount > allUids.length,
      members: page.map((uid) => ({ uid })),
      next_cursor: nextCursor,
    };
  });

  // PATCH /api/segments/:id
  app.patch('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'mutate');
    if (!row) return reply;

    const parsed = segmentPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const patch = parsed.data;
    // Cohort-redefining fields (predicate_tree silently replaces the cohort and
    // triggers auto-refresh; uid_list rewrites it outright) and visibility are
    // owner/admin-only. Collaborative fields (name, cadence, tags, cube) stay
    // open to workspace members on shared/org segments.
    const touchesAdministerField =
      patch.visibility !== undefined ||
      patch.predicate_tree !== undefined ||
      patch.uid_list !== undefined;
    if (touchesAdministerField && !canAdministerSegment(req.principal, row)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the owner or an admin may change visibility or redefine the cohort' },
      });
    }
    if (rejectNonAdminOrg(req, reply, patch.visibility, row.visibility)) return;
    const now = new Date().toISOString();

    let cubeQueryJson = row.cube_query_json as string | null;
    if (patch.predicate_tree !== undefined) {
      if (patch.predicate_tree) {
        try {
          const filters = treeToCubeFilters(patch.predicate_tree as PredicateNode);
          // The predicate editor only knows the tree — carry the cube-segment
          // sidecar forward from the stored query so editing a filter doesn't
          // silently widen membership past the original cube segments.
          cubeQueryJson = JSON.stringify(
            withCubeSegments({ filters }, parseCubeSegments(row.cube_query_json as string | null)),
          );
        } catch (err) {
          return reply.status(400).send({
            error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
          });
        }
      } else {
        cubeQueryJson = null;
      }
    }

    // When the caller didn't provide uid_list, preserve the existing row
    // values. Recomputing `uid_count = uid_list.length` would silently
    // overwrite the true cohort size with the cap of a previously-truncated
    // sample (MAX_UID_LIST = 100k in refresh-segment.ts), making the post-save
    // size display a lie until the next refresh.
    const uidListProvided = patch.uid_list !== undefined;
    const nextUidCount = uidListProvided
      ? (patch.uid_list as unknown[]).length
      : (row.uid_count as number);
    const nextUidListJson = uidListProvided
      ? JSON.stringify(patch.uid_list)
      : (row.uid_list_json as string);

    // Auto-refresh when the predicate changed on a predicate segment — the
    // cube_query_json was just regenerated, so the stored uid_count/uid_list
    // are stale by construction. Flip status to 'refreshing' so the UI
    // surfaces in-flight state immediately.
    const predicateChanged =
      patch.predicate_tree !== undefined &&
      patch.predicate_tree !== null &&
      row.type === 'predicate';
    const nextStatus = predicateChanged ? 'refreshing' : (row.status as string);

    db.prepare(`
      UPDATE segments SET
        name = ?, cube = ?, predicate_tree_json = ?, cube_query_json = ?,
        uid_count = ?, uid_list_json = ?, refresh_cadence_min = ?, status = ?, visibility = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.name ?? row.name,
      patch.cube !== undefined ? patch.cube : row.cube,
      patch.predicate_tree !== undefined ? (patch.predicate_tree ? JSON.stringify(patch.predicate_tree) : null) : row.predicate_tree_json,
      cubeQueryJson,
      nextUidCount,
      nextUidListJson,
      patch.refresh_cadence_min !== undefined ? patch.refresh_cadence_min : row.refresh_cadence_min,
      nextStatus,
      patch.visibility !== undefined ? patch.visibility : (row.visibility ?? null),
      now,
      id,
    );

    if (patch.tags !== undefined) {
      db.prepare('DELETE FROM segment_tags WHERE segment_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of patch.tags) insertTag.run(id, tag);
    }

    if (predicateChanged) {
      void enqueueRefresh(id);
    }

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    emitSegmentOp(req, 'update', id);
    return hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role });
  });

  // DELETE /api/segments/:id — owner/admin only (destructive).
  // Blocked when a glossary term's secondary_catalog_ids references this segment,
  // because deleting it would leave a dangling ref in the concept graph.
  app.delete('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'administer');
    if (!row) return reply;

    const segRef = `segments/${id}`;
    const blocking = glossaryTermsReferencingArtifact(segRef);
    if (blocking.length > 0) {
      return reply.status(409).send({
        error: {
          code: 'REF_INTEGRITY',
          message: 'Cannot delete: glossary term(s) reference this segment',
          referencedBy: blocking,
        },
      });
    }

    db.prepare('DELETE FROM segments WHERE id = ?').run(id);
    invalidateReverseIndex();
    emitSegmentOp(req, 'delete', id);
    return reply.status(204).send();
  });

  // POST /api/segments/:id/share | /unshare — owner/admin publish toggle
  // (chat-session parity). share → visibility='shared' + shared_at stamp;
  // unshare → back to 'personal' + shared_at cleared. 'org' rows stay
  // admin-governed: a non-admin owner may not demote one via unshare.
  for (const action of ['share', 'unshare'] as const) {
    app.post(`/api/segments/:id/${action}`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const db = getDb();
      const row = guardSegment(req, reply, id, 'administer');
      if (!row) return reply;

      const targetVisibility = action === 'share' ? 'shared' : SEGMENT_DEFAULT_VISIBILITY;
      if (rejectNonAdminOrg(req, reply, targetVisibility, row.visibility)) return;

      const now = new Date().toISOString();
      db.prepare('UPDATE segments SET visibility = ?, shared_at = ?, updated_at = ? WHERE id = ?')
        .run(targetVisibility, action === 'share' ? now : null, now, id);

      const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
      emitSegmentOp(req, 'update', id);
      return hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role });
    });
  }

  // POST /api/segments/:id/append — owner/admin only (cohort-redefining).
  app.post('/api/segments/:id/append', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'administer');
    if (!row) return reply;

    const body = req.body as { uids?: string[] };
    if (!Array.isArray(body?.uids)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'uids must be an array' } });
    }

    const existing: string[] = JSON.parse((row.uid_list_json as string) ?? '[]');
    const merged = Array.from(new Set([...existing, ...body.uids]));

    db.prepare('UPDATE segments SET uid_list_json = ?, uid_count = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), merged.length, new Date().toISOString(), id);

    emitSegmentOp(req, 'append', id);
    return { uid_count: merged.length };
  });

  // POST /api/segments/import-ids — CSV → static segment
  // Accepts JSON: { name, cube, csv, tags? } where csv is the raw CSV text.
  // (Multipart upload deferred — FE reads the file client-side and posts text.)
  app.post('/api/segments/import-ids', async (req, reply) => {
    const body = req.body as {
      name?: string;
      cube?: string;
      csv?: string;
      tags?: string[];
      game_id?: string;
    };

    if (!body?.name?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'name required' } });
    }
    if (!body.cube?.trim()) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'cube required' } });
    }
    if (typeof body.csv !== 'string' || body.csv.length === 0) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'csv required' } });
    }

    const db = getDb();
    const mapping = db
      .prepare('SELECT identity_field FROM cube_identity_map WHERE cube = ?')
      .get(body.cube) as { identity_field: string } | undefined;
    if (!mapping) {
      return reply.status(400).send({
        error: {
          code: 'IDENTITY_DIM_MISSING',
          message: `cube "${body.cube}" has no identity-dim mapping. Set it in Settings.`,
        },
      });
    }

    const parsed = parseUidCsv(body.csv);
    if (parsed.uids.length === 0) {
      return reply.status(400).send({
        error: {
          code: 'EMPTY_CSV',
          message: 'no valid uids found in csv',
          details: parsed.errors,
        },
      });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const owner = req.owner;

    db.prepare(`
      INSERT INTO segments
        (id, name, type, owner, owner_label, status, cube, predicate_tree_json, cube_query_json,
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id, funnel_json, workspace)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      body.name.trim(),
      'manual',
      owner,
      // Create-path parity with POST /api/segments: imported segments get the
      // same human-readable "shared by …" label.
      req.user?.username ?? req.user?.email ?? owner,
      'fresh',
      body.cube,
      null,
      null,
      parsed.uids.length,
      JSON.stringify(parsed.uids),
      null,
      now,
      now,
      body.game_id ?? loadGamesConfig().defaultGameId,
      null,
      req.workspace.id,
    );

    if (body.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of body.tags) insertTag.run(id, tag);
    }

    return reply.status(201).send({
      id,
      uid_count: parsed.uids.length,
      truncated: parsed.truncated,
      max_rows: MAX_ROWS,
      errors: parsed.errors,
    });
  });

  // GET /api/segments/:id/refresh-log — sparkline + history feed.
  app.get('/api/segments/:id/refresh-log', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { days, limit } = req.query as Record<string, string | undefined>;
    const db = getDb();
    if (!guardSegment(req, reply, id, 'read')) return reply;

    const dayCount = Math.max(1, Math.min(parseInt(days ?? '7', 10) || 7, 90));
    const rowLimit = Math.max(1, Math.min(parseInt(limit ?? '200', 10) || 200, 500));
    const rows = db
      .prepare(
        `SELECT id, segment_id, strftime('%Y-%m-%dT%H:%M:%SZ', ts) AS ts, uid_count, status
           FROM segment_refresh_log
          WHERE segment_id = ? AND ts >= datetime('now', ? )
          ORDER BY ts ASC
          LIMIT ?`,
      )
      .all(id, `-${dayCount} days`, rowLimit);
    return rows;
  });

  // POST /api/segments/refresh-logs — bulk fetch for library sparklines.
  // Body: { ids: string[], days: number }. Returns Record<id, LogRow[]>.
  app.post('/api/segments/refresh-logs', async (req, reply) => {
    const body = req.body as { ids?: unknown; days?: unknown };
    if (!Array.isArray(body?.ids)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'ids must be an array' } });
    }
    const ids = (body.ids as unknown[])
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .slice(0, 100); // cap to prevent DoS
    if (ids.length === 0) return {};

    const days = Math.max(1, Math.min(parseInt(String(body.days ?? '7'), 10) || 7, 90));
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, segment_id, strftime('%Y-%m-%dT%H:%M:%SZ', ts) AS ts, uid_count, status
           FROM segment_refresh_log
          WHERE segment_id IN (${placeholders}) AND ts >= datetime('now', ?)
          ORDER BY ts ASC`,
      )
      .all(...ids, `-${days} days`) as Array<Record<string, unknown>>;

    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const id of ids) grouped[id] = [];
    for (const r of rows) {
      const sid = r.segment_id as string;
      if (!grouped[sid]) grouped[sid] = [];
      grouped[sid].push(r);
    }
    return grouped;
  });

  // GET /api/segments/:id/sql-filter — Advanced preview in Activate-to-CDP modal.
  app.get('/api/segments/:id/sql-filter', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    if (!row.predicate_tree_json) return { filter: '1=1' };
    try {
      const tree = JSON.parse(row.predicate_tree_json as string) as PredicateNode;
      return { filter: predicateToSql(tree) };
    } catch (err) {
      return reply.status(400).send({
        error: { code: 'SQL_TRANSLATOR_ERROR', message: (err as Error).message },
      });
    }
  });

  // POST /api/segments/:id/refresh — enqueue manual refresh; cron worker drains.
  app.post('/api/segments/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'mutate');
    if (!row) return reply;
    if (row.type !== 'predicate') {
      return reply.status(400).send({ error: { code: 'NOT_LIVE', message: 'Only predicate (live) segments can be refreshed' } });
    }

    db.prepare("UPDATE segments SET status = 'refreshing', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);

    // Fire-and-forget — queue runs in background.
    void enqueueRefresh(id);

    emitSegmentOp(req, 'refresh', id);
    return reply.status(202).send({ status: 'refreshing' });
  });

  // POST /api/segments/:id/precompute-members — manually warm the member-360
  // cache for the segment's tiered members (the nightly job's "compute now"
  // affordance). Fire-and-forget; rate-limited to 1 accepted trigger per
  // segment per 10 minutes so it can't be used to hammer Cube.
  app.post('/api/segments/:id/precompute-members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'mutate');
    if (!row) return reply;

    const eligible =
      row.member_tiers_json != null &&
      corePanelsForGame(row.game_id as string | null).length > 0;
    if (!eligible) {
      return reply.status(400).send({
        error: {
          code: 'NOT_ELIGIBLE',
          message: 'Segment has no member tiers or its game has no member-360 panels',
        },
      });
    }

    const result = triggerMember360Precompute(id);
    if (!result.accepted) {
      reply.header('retry-after', String(Math.ceil((result.retryAfterMs ?? 0) / 1000)));
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Precompute already triggered recently' },
      });
    }
    return reply.status(202).send({ status: 'precomputing' });
  });

  // POST /api/segments/:id/activations — append a new activation (stub).
  // Real CDP wiring lands in Phase 7; this endpoint persists the registry entry.
  app.post('/api/segments/:id/activations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    // Guard the parent segment before validating the body, so a non-owner gets a
    // consistent 403 (not a 400 that would distinguish a malformed body).
    const row = guardSegment(req, reply, id, 'mutate');
    if (!row) return reply;

    const body = (req.body ?? {}) as {
      destination?: string;
      game_id?: string;
      env?: string;
      metric_name?: string;
      status?: string;
      last_error?: string;
    };
    if (body.destination !== undefined && body.destination !== 'cdp') {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'destination must be "cdp"' } });
    }
    if (!body.env || !VALID_ENVS.has(body.env)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'env must be dev|stag|prod' } });
    }
    if (!body.metric_name || !METRIC_NAME_RE.test(body.metric_name)) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'metric_name must match /^[a-z0-9_]{1,64}$/' },
      });
    }

    let list: Array<Record<string, unknown>> = [];
    try {
      list = JSON.parse((row.activations_json as string) ?? '[]');
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }

    const activation = {
      id: uuidv4(),
      destination: 'cdp' as const,
      game_id: body.game_id ?? (row.game_id as string) ?? loadGamesConfig().defaultGameId,
      env: body.env,
      metric_name: body.metric_name,
      registered_at: new Date().toISOString(),
      last_pushed_at: null,
      status: (body.status as string) || 'pending',
      ...(body.last_error ? { last_error: body.last_error } : {}),
    };
    list.push(activation);

    db.prepare('UPDATE segments SET activations_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(list),
      new Date().toISOString(),
      id,
    );

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return reply.status(201).send(hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }));
  });

  // DELETE /api/segments/:id/activations/:activationId — remove an activation.
  // Owner/admin only: deleting an activation severs a live downstream push.
  app.delete('/api/segments/:id/activations/:activationId', async (req, reply) => {
    const { id, activationId } = req.params as { id: string; activationId: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'administer');
    if (!row) return reply;

    let list: Array<Record<string, unknown>> = [];
    try {
      list = JSON.parse((row.activations_json as string) ?? '[]');
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    const next = list.filter((a) => (a as { id?: string }).id !== activationId);
    db.prepare('UPDATE segments SET activations_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      new Date().toISOString(),
      id,
    );

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    return hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role });
  });
}
