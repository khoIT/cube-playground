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
import { buildSegmentMembershipSql } from '../lakehouse/segment-snapshot-writer.js';
import {
  lakehouseConnectorFromEnv,
  lakehouseSchemaForGame,
  LAKEHOUSE_CATALOG,
  LAKEHOUSE_SCHEMA,
} from '../lakehouse/lakehouse-trino-connector.js';
import { signAppJwt } from '../services/app-jwt.js';
import { schemaForGame } from '../services/trino-profiler-config.js';
import { predicateToSql } from '../services/predicate-to-sql.js';
import {
  cubeQueryToPredicate,
  type CubeQueryFilters,
  type CubeInputFilter,
} from '../services/cube-query-to-predicate.js';
import {
  resolveSegmentCutoffs,
  resolveCutoffPreview,
  collectPercentileLeaves,
  PopulationScopeRequiredError,
  CutoffConnectorUnavailableError,
} from '../services/segment-cutoff-resolver.js';
import {
  getSegmentableMeasures,
  percentileOverFor,
  isCatalogTarget,
} from '../services/segmentable-measures-catalog.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import { computeSegmentSize, SegmentSizeError } from '../services/compute-segment-size.js';
import type { MemberProfiles } from '../types/segment.js';
import { ensureManualMemberProfiles } from '../services/member-profile-on-demand.js';
import { parseUidCsv, MAX_ROWS } from '../services/csv-importer.js';
import { loadWithContinueWait } from '../services/load-with-continue-wait.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { enqueueRefresh } from '../jobs/refresh-queue.js';
import { getCardCache } from '../services/card-cache-store.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { glossaryTermsReferencingArtifact } from '../services/concept-ref-integrity.js';
import { invalidateReverseIndex } from '../services/concept-reverse-index.js';
import { SEGMENT_DEFAULT_VISIBILITY, VISIBILITY_VALUES } from '../services/trust-mapping.js';
import {
  SNAPSHOT_CADENCES,
  TRACK_CADENCES,
  coerceTrackCadence,
  trackToRefreshMinutes,
  trackToSnapshotCadence,
} from '../services/snapshot-cadence.js';
import { canAccessSegment, canMutateSegment, canAdministerSegment } from '../auth/can-access-segment.js';
import { emailForSub } from '../auth/principal.js';
import { corePanelsForGame } from '../services/member360-panel-registry.js';
import { triggerMember360Precompute } from '../services/member360-precompute-scheduler.js';
import { recordActivity } from '../services/activity-store.js';
import { LIFECYCLE_TRACKING_OWNER } from '../services/lifecycle-tracking-segment.js';
import { buildServing, buildServingBatch, entitledKeysForSegment } from '../services/segment-serving-store.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Member columns sourced from these cross-cutting cubes carry monetization
// breakdown, CS, or VIP detail. The members pull is deliberately tokenless, so
// these columns must never reach an unauthenticated caller (that would be a
// token-free payer / CS dossier). They are stripped from the response unless
// the request carries an authenticated user; the served row still keeps uid +
// non-sensitive columns so the existing CS-tooling contract is unbroken. The
// pre-existing ltv rank-measure exposure on mf_users is intentionally NOT gated
// here — gating a shipped behaviour is a separate, explicit decision.
const SENSITIVE_MEMBER_FIELD =
  /^(billing_detail|billing_lifetime|cs_ticket_detail|user_billing_detail_panel|user_billing_lifetime_panel|user_cs_tickets_panel)\.|(^|[._])(vip|csat|sentiment|charged|delivered|promotion|resolution_time|ticket_rating|lifetime_vnd|lifetime_usd|arppu)([._]|$)/i;

export function redactSensitiveMembers<
  T extends { columns?: unknown; members?: unknown[] },
>(payload: T, authenticated: boolean): T {
  if (authenticated) return payload;
  const cols = Array.isArray(payload.columns)
    ? (payload.columns as Array<Record<string, unknown>>)
    : [];
  const sensitive = cols.filter(
    (c) => typeof c?.field === 'string' && SENSITIVE_MEMBER_FIELD.test(c.field as string),
  );
  if (sensitive.length === 0) return payload;
  const sensitiveKeys = new Set(sensitive.map((c) => String(c.key)));
  const members = Array.isArray(payload.members)
    ? payload.members.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
          if (!sensitiveKeys.has(k)) out[k] = v;
        }
        return out;
      })
    : payload.members;
  return {
    ...payload,
    columns: cols.filter((c) => !sensitiveKeys.has(String(c.key))),
    members,
    redacted_columns: sensitive.map((c) => String(c.field)),
    redaction_reason: 'authentication required for monetization/CS/VIP member columns',
  } as T;
}

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
  /**
   * Lineage — where this cohort came from. Set when a segment is crystallized
   * from an explored chat query (the "Build segment from this" bridge) so the
   * cohort can answer "why does this exist?" later. Stored as a JSON blob.
   */
  born_from: z
    .object({
      artifact_id: z.string().optional(),
      question: z.string().optional(),
      cube_query: z.unknown().optional(),
    })
    .nullable()
    .optional(),
});

const segmentPatchSchema = z.object({
  name: z.string().min(1).optional(),
  /** Manual ↔ predicate conversion ("Convert to Live"). Owner/admin only. */
  type: z.enum(['manual', 'predicate']).optional(),
  cube: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  predicate_tree: z.unknown().optional().nullable(),
  uid_list: z.array(z.string()).optional(),
  refresh_cadence_min: z.number().int().positive().nullable().optional(),
  /** Lakehouse snapshot capture cadence (how often the snapshot job materializes
   *  this segment's membership/state/KPIs). Distinct from refresh_cadence_min,
   *  which governs cohort recompute. Defaults daily; only opted-in segments go
   *  sub-daily. */
  snapshot_cadence: z.enum(SNAPSHOT_CADENCES).optional(),
  /** Unified "Track every" cadence — the single operator knob. When set it
   *  dual-writes the two legacy columns (refresh_cadence_min + snapshot_cadence)
   *  so both schedulers follow one value. Supersedes setting them directly. */
  track_cadence: z.enum(TRACK_CADENCES).optional(),
  /** Visibility setter. Owner may set personal/shared; 'org' is admin-only. */
  visibility: z.enum(VISIBILITY_VALUES).optional(),
  /**
   * Cube-level named segments (SQL snippets from the data model) to attach as
   * scope sidecar in cube_query_json. Owner/admin-gated — same gate as
   * predicate_tree. Omitting preserves the current sidecar (carry-forward).
   */
  cube_segments: z.array(z.string().min(1)).nullable().optional(),
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

/**
 * Derive the logical cube (member prefix, e.g. "mf_users") from a Cube query.
 * Prefers a dimension, then the first filter leaf member, then a measure — the
 * cube is whatever sits before the first dot. Returns null when no member is
 * present (a query with nothing to scope can't become a segment).
 */
function deriveCubeFromQuery(query: CubeQueryFilters): string | null {
  const prefixOf = (member: string | undefined): string | null => {
    if (!member) return null;
    const dot = member.indexOf('.');
    return dot > 0 ? member.slice(0, dot) : null;
  };
  const fromFilters = (filters: CubeInputFilter[] | undefined): string | null => {
    for (const f of filters ?? []) {
      const nested = fromFilters(f.and ?? f.or);
      if (nested) return nested;
      const p = prefixOf(f.member ?? f.dimension);
      if (p) return p;
    }
    return null;
  };
  return (
    prefixOf(query.dimensions?.[0]) ??
    fromFilters(query.filters) ??
    prefixOf(query.measures?.[0])
  );
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

    // Hide system "all-users" lifecycle-tracking segments from every viewer
    // (incl. admin): they exist only to feed the transition-matrix snapshots and
    // would clutter the user-facing list. They remain visible to the snapshot job
    // and the Admin "Segment Refreshes" ops surface, which use separate queries.
    sql += ' AND owner != ?';
    params.push(LIFECYCLE_TRACKING_OWNER);

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
    // Serving contracts for the library lane split. Computed only for non-draft
    // rows (drafts → null), so the big exploration lane costs no extra snapshot/
    // key scan — no N+1 across the list.
    const servingById = buildServingBatch(db, rows, Date.now());
    // Skip uid_list hydration on the list — see hydrateSegment's includeUidList.
    return rows.map((r) => ({
      ...hydrateSegment(r, db, tagsBySegment.get(r.id as string) ?? [], false, { sub: req.principal.sub, role: req.principal.role }),
      serving: servingById.get(r.id as string) ?? null,
    }));
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
        const tree = data.predicate_tree as PredicateNode;
        // Allowlist guard: a percentile cutoff may only target a catalogued
        // (table, column) for this game — the same gate as /resolve-cutoff,
        // enforced here so a hand-crafted body can't point approx_percentile at
        // an arbitrary table or bypass the catalog's payer scoping.
        const game = data.game_id ?? loadGamesConfig().defaultGameId;
        for (const leaf of collectPercentileLeaves(tree)) {
          const over = (leaf.values[0] as { over?: { table?: string; column?: string } } | undefined)?.over;
          if (!over?.table || !over?.column || !isCatalogTarget(game, over.table, over.column)) {
            return reply.status(400).send({
              error: {
                code: 'NOT_SEGMENTABLE',
                message: `percentile target ${over?.table ?? '?'}.${over?.column ?? '?'} is not a segmentable measure for ${game}`,
              },
            });
          }
        }
        // Resolve any percentile leaves to absolute cutoffs first (no-op + no
        // Trino call when the tree has none). Cube REST can't subquery, so the
        // cutoff must be a scalar before translation. Refresh re-resolves every
        // run (rolling), so this stored query is just the initial materialization.
        const resolvedPercentiles = await resolveSegmentCutoffs(tree);
        const filters = treeToCubeFilters(tree, { resolvedPercentiles });
        cubeQueryJson = JSON.stringify(withCubeSegments({ filters }, data.cube_segments));
      } catch (err) {
        const code =
          err instanceof PopulationScopeRequiredError
            ? 'POPULATION_SCOPE_REQUIRED'
            : err instanceof CutoffConnectorUnavailableError
              ? 'CUTOFF_CONNECTOR_UNAVAILABLE'
              : 'TRANSLATOR_ERROR';
        return reply.status(400).send({
          error: { code, message: (err as Error).message },
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
         uid_count, uid_list_json, refresh_cadence_min, created_at, updated_at, game_id, funnel_json, workspace, visibility, born_from)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      data.born_from ? JSON.stringify(data.born_from) : null,
    );

    if (data.tags?.length) {
      const insertTag = db.prepare('INSERT OR IGNORE INTO segment_tags (segment_id, tag) VALUES (?,?)');
      for (const tag of data.tags) insertTag.run(id, tag);
    }

    // Kick off the first refresh immediately so the displayed uid_count
    // converges to the true total instead of waiting up to one cadence
    // interval for the cron tick.
    if (isPredicateWithQuery) {
      void enqueueRefresh(id, 'manual');
    }

    const row = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    emitSegmentOp(req, 'create', id);
    return reply.status(201).send(hydrateSegment(row, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }));
  });

  // GET /api/segments/segmentable-measures?game=<id>
  // The catalog of measure concepts (spend / spend_usd / active days) a game can
  // segment on by threshold / top-N / percentile, each with a ready-to-use `over`
  // spec (physical table+column, payer population, identity merge). The chat
  // propose flow reads this so it never fabricates physical member names.
  app.get('/api/segments/segmentable-measures', async (req) => {
    const game = (req.query as { game?: string }).game ?? '';
    const measures = getSegmentableMeasures(game).map((m) => ({
      concept: m.concept,
      label: m.label,
      dimension: m.dimension,
      window: m.window,
      currency: m.currency,
      over: percentileOverFor(m),
    }));
    return { measures };
  });

  // POST /api/segments/resolve-cutoff
  // Propose-time preview: resolve a percentile/top-N cutoff over a scoped
  // population and estimate the cohort it selects, WITHOUT creating a segment.
  // The chat propose card calls this to show the cutoff + est. size before the
  // user confirms. Identifiers (table/column) and the population filter are
  // validated/escaped downstream (escapeIdent + predicateToSql), so no raw SQL
  // reaches Trino; callers should pass catalog-validated members.
  const resolveCutoffSchema = z.object({
    game_id: z.string().min(1),
    p: z.number().gt(0).lt(100),
    gte: z.boolean().default(true),
    over: z.object({
      table: z.string().min(1),
      column: z.string().min(1),
      // Structured population scope (e.g. payers `recharge > 0`). Optional here,
      // but spend-like distributions degenerate to a 0 cutoff without it.
      filter: z.unknown().optional(),
      // Per-user collapse for multi-row identity marts (jus). Server-owned enum.
      identityMerge: z
        .object({
          idColumn: z.string().min(1),
          transform: z.literal('split_part_at'),
          agg: z.enum(['max', 'sum']).optional(),
        })
        .optional(),
    }),
  });

  app.post('/api/segments/resolve-cutoff', async (req, reply) => {
    const parsed = resolveCutoffSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game_id, p, gte, over } = parsed.data;
    // Allowlist guard: the percentile may only target a catalogued (table,
    // column) for this game — defense-in-depth over the identifier validation.
    if (!isCatalogTarget(game_id, over.table, over.column)) {
      return reply.status(400).send({
        error: {
          code: 'NOT_SEGMENTABLE',
          message: `${over.table}.${over.column} is not a segmentable measure for ${game_id}`,
        },
      });
    }
    try {
      const preview = await resolveCutoffPreview({
        table: over.table,
        column: over.column,
        p,
        gte,
        filter: over.filter as PredicateNode | undefined,
        identityMerge: over.identityMerge,
      });
      return preview;
    } catch (err) {
      const code =
        err instanceof CutoffConnectorUnavailableError ? 'CUTOFF_CONNECTOR_UNAVAILABLE' : 'CUTOFF_FAILED';
      return reply.status(400).send({ error: { code, message: (err as Error).message } });
    }
  });

  // POST /api/segments/preview-count
  // Dry-run cohort size for a candidate predicate tree, BEFORE the segment is
  // saved. The chat propose card calls this so the user sees ~how many users
  // match and can iterate before committing. Uses the same Cube `/load
  // total:true` mechanism as refresh, so the previewed number matches the
  // post-save size. Best-effort by contract: any transient Cube/Trino trouble
  // returns ok:false (HTTP 200) so the caller still emits its proposal.
  const previewCountSchema = z.object({
    game_id: z.string().min(1).max(64),
    cube: z.string().min(1).max(128),
    predicate_tree: z.unknown(),
    cube_segments: z.array(z.string()).optional(),
    // Propose-time callers bound the wait so a cold cohort scan never stalls the
    // chat turn; capped server-side so it can't exceed the per-segment budget.
    timeout_ms: z.number().int().positive().max(60_000).optional(),
  });
  app.post('/api/segments/preview-count', async (req, reply) => {
    const parsed = previewCountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game_id, cube, predicate_tree, cube_segments, timeout_ms } = parsed.data;
    const startedAt = Date.now();
    try {
      const { count } = await computeSegmentSize({
        cube,
        gameId: game_id,
        workspace: req.workspace.id,
        predicateTree: predicate_tree as PredicateNode,
        ...(cube_segments ? { cubeSegments: cube_segments } : {}),
        ...(timeout_ms ? { timeoutMs: timeout_ms } : {}),
      });
      return { ok: true, estCount: count, tookMs: Date.now() - startedAt };
    } catch (err) {
      // Uncohortable cube = structural (4xx). Everything else (Cube introspection
      // blip, /load timeout, predicate translation error) is non-fatal for the
      // caller, which degrades to "size on refresh" — return ok:false (200) so
      // the propose flow never breaks on a count hiccup.
      if (err instanceof SegmentSizeError && err.kind === 'uncohortable') {
        return reply.status(400).send({ error: { code: 'UNCOHORTABLE', message: err.message } });
      }
      return {
        ok: false,
        error: 'unavailable',
        detail: (err as Error).message,
        tookMs: Date.now() - startedAt,
      };
    }
  });

  // POST /api/segments/translate-query
  // Segmentability probe for the chat "Build segment from this" bridge. Runs the
  // shared CubeQuery→predicate translator + gate (mirrors chat-service) so the FE
  // can (a) decide whether to show the bridge button and (b) seed an inline
  // proposal with a predicate_tree — without a chat turn. Pure: no Trino call.
  const translateQuerySchema = z.object({
    query: z
      .object({
        measures: z.array(z.string()).optional(),
        dimensions: z.array(z.string()).optional(),
        filters: z.array(z.unknown()).optional(),
        order: z.unknown().optional(),
        limit: z.number().optional(),
      })
      .passthrough(),
  });
  app.post('/api/segments/translate-query', async (req, reply) => {
    const parsed = translateQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const query = parsed.data.query as CubeQueryFilters;
    // A filter on a member the query itself selects as a measure is not
    // segmentable — the cheap, no-meta signal for the measure-filter gate.
    const measureNames = new Set(query.measures ?? []);
    const result = cubeQueryToPredicate(query, measureNames);
    if (!result.ok) {
      // `breakdown_unfiltered` carries the grouping dimension(s) so the FE can
      // offer a value picker (the seed path). Derive the cube too — the seeded
      // proposal needs it just like the direct path. Other rejections stay bare
      // (the bridge button hides).
      const seedCube = deriveCubeFromQuery(query);
      return {
        segmentable: false,
        reason: result.reason,
        hint: result.hint,
        ...(result.seedDimensions ? { seed_dimensions: result.seedDimensions } : {}),
        ...(seedCube ? { cube: seedCube } : {}),
      };
    }
    const cube = deriveCubeFromQuery(query);
    if (!cube) {
      return {
        segmentable: false,
        reason: 'no_cube',
        hint: 'Could not determine the logical cube from the query members.',
      };
    }
    return { segmentable: true, predicate_tree: result.predicate, cube };
  });

  // POST /api/segments/dimension-values
  // Distinct values of one grouping dimension, for the "Build segment from this"
  // seed picker (the breakdown_unfiltered case). Runs the explored breakdown
  // query as-is — it already groups by the dimension, so each row is one value —
  // and projects the chosen dimension column. Best-effort: any failure returns
  // an empty list with a reason, never a 500 (the picker degrades to free text).
  const dimensionValuesSchema = z.object({
    game_id: z.string().min(1),
    dimension: z.string().min(1),
    query: z
      .object({
        measures: z.array(z.string()).optional(),
        dimensions: z.array(z.string()).optional(),
        order: z.unknown().optional(),
        limit: z.number().optional(),
      })
      .passthrough(),
  });
  app.post('/api/segments/dimension-values', async (req, reply) => {
    const start = Date.now();
    const parsed = dimensionValuesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game_id, dimension, query } = parsed.data;
    try {
      const token = resolveCubeTokenForGame(game_id) ?? undefined;
      // Cap the pull: a breakdown's distinct values are few (tiers, channels);
      // anything past 100 is not a sane equals/in cohort seed anyway.
      const cubeQuery = {
        dimensions: [dimension],
        measures: (query.measures ?? []).slice(0, 1),
        ...(query.order ? { order: query.order } : {}),
        limit: Math.min(query.limit ?? 100, 100),
      };
      const res = (await loadWithContinueWait(cubeQuery, token, 20_000)) as {
        data?: Array<Record<string, unknown>>;
      };
      const seen = new Set<string>();
      const values: string[] = [];
      for (const row of res.data ?? []) {
        const raw = row[dimension];
        if (raw == null) continue;
        const v = String(raw);
        if (seen.has(v)) continue;
        seen.add(v);
        values.push(v);
      }
      return { values, approx: false, took_ms: Date.now() - start };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { values: [], reason: `query_error: ${msg}`, took_ms: Date.now() - start };
    }
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
      // Serving contract (cadence, next-ready, entitled keys) for the activation
      // tab. Computed for every detail view; draft segments still carry their
      // (draft) lifecycle so the FE can offer the publish ramp.
      serving: buildServing(db, row, Date.now()),
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

    // Manual segments never refresh, so their snapshot is computed lazily on
    // the first pull (small cohorts only; identity-IN scope). Also recomputes
    // when the uid list changed after the stored snapshot.
    if (row.type === 'manual' && row.cube) {
      profiles =
        (await ensureManualMemberProfiles(
          row as unknown as Parameters<typeof ensureManualMemberProfiles>[0],
        )) ?? profiles;
    }

    if (profiles) {
      // Offset cursor into the static ranked snapshot (stable until the next
      // refresh rewrites it atomically).
      const parsedCursor = Number.parseInt(cursor ?? '', 10);
      const start = Number.isFinite(parsedCursor) ? Math.max(parsedCursor, 0) : 0;
      const page = profiles.rows.slice(start, start + limit);
      // Strip monetization/CS/VIP member columns for unauthenticated callers —
      // the pull is tokenless by design, but those columns are not for it.
      return redactSensitiveMembers(
        {
          ...base,
          computed_at: profiles.computed_at,
          rank_measure: profiles.rank_measure,
          columns: profiles.columns,
          returned_count: page.length,
          truncated: trueCount > profiles.rows.length,
          members: page,
          next_cursor: start + limit < profiles.rows.length ? String(start + limit) : null,
        },
        // Strip monetization/CS/VIP columns for unauthenticated callers. NOTE: under
        // AUTH_DISABLED (local + the VPN-gated playground) every request resolves to
        // the bootstrap admin, so this gate is open there by design — those
        // deployments are trusted admin contexts where the operator sees full data.
        Boolean(req.user),
      );
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
    const typeChanged = patch.type !== undefined && patch.type !== row.type;
    const touchesAdministerField =
      patch.visibility !== undefined ||
      patch.predicate_tree !== undefined ||
      patch.uid_list !== undefined ||
      patch.cube_segments !== undefined ||
      typeChanged;
    if (touchesAdministerField && !canAdministerSegment(req.principal, row)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Only the owner or an admin may change visibility or redefine the cohort' },
      });
    }
    if (rejectNonAdminOrg(req, reply, patch.visibility, row.visibility)) return;
    const now = new Date().toISOString();

    // Rebuild cube_query_json according to the precedence spec:
    //
    // (a) both predicate_tree + cube_segments present
    //     → filters from tree, segments from patch (no carry-forward from stored)
    // (b) only cube_segments present (no tree in patch)
    //     → filters from STORED tree, segments from patch
    //     → 400 if no stored tree (nothing to scope)
    // (c) only predicate_tree present (no cube_segments in patch)
    //     → carry stored cube-segment sidecar forward (existing behavior)
    // (d) neither → cube_query_json unchanged
    //
    // Segments are canonical-sorted before persistence; equality-checked against
    // the stored value to avoid triggering a no-op refresh.
    const hasPatchTree = patch.predicate_tree !== undefined;
    const hasPatchSegments = patch.cube_segments !== undefined;

    let cubeQueryJson = row.cube_query_json as string | null;

    if (hasPatchTree && hasPatchSegments) {
      // Case (a): both provided — use tree for filters, patch for segments.
      if (patch.predicate_tree) {
        try {
          const filters = treeToCubeFilters(patch.predicate_tree as PredicateNode);
          const sortedSegs = patch.cube_segments
            ? [...patch.cube_segments].sort()
            : null;
          cubeQueryJson = JSON.stringify(withCubeSegments({ filters }, sortedSegs));
        } catch (err) {
          return reply.status(400).send({
            error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
          });
        }
      } else {
        cubeQueryJson = null;
      }
    } else if (hasPatchSegments && !hasPatchTree) {
      // Case (b): only cube_segments — rebuild from stored tree + new segments.
      if (!row.predicate_tree_json) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION',
            message: 'cube_segments requires a stored predicate_tree to rebuild the query',
          },
        });
      }
      try {
        const storedTree = JSON.parse(row.predicate_tree_json as string) as PredicateNode;
        const filters = treeToCubeFilters(storedTree);
        const sortedSegs = patch.cube_segments ? [...patch.cube_segments].sort() : null;
        cubeQueryJson = JSON.stringify(withCubeSegments({ filters }, sortedSegs));
      } catch (err) {
        return reply.status(400).send({
          error: { code: 'TRANSLATOR_ERROR', message: (err as Error).message },
        });
      }
    } else if (hasPatchTree && !hasPatchSegments) {
      // Case (c): only predicate_tree — carry stored sidecar forward.
      if (patch.predicate_tree) {
        try {
          const filters = treeToCubeFilters(patch.predicate_tree as PredicateNode);
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
      // Case (d): neither hasPatchTree nor hasPatchSegments → cubeQueryJson unchanged.
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

    // Type conversion ("Convert to Live" sends type='predicate' along with the
    // new tree). A predicate segment without a predicate can never refresh, so
    // reject the conversion unless a tree is present in this patch or already
    // stored on the row.
    const nextType = patch.type !== undefined ? patch.type : (row.type as string);
    const hasTree =
      patch.predicate_tree !== undefined
        ? patch.predicate_tree !== null
        : row.predicate_tree_json != null;
    if (nextType === 'predicate' && !hasTree) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'A predicate segment requires a predicate_tree' },
      });
    }

    // Auto-refresh when the cohort definition changed on a predicate segment.
    // "Changed" means: a non-null tree was supplied, OR the cube_segments sidecar
    // was explicitly updated to a different sorted set than what is stored.
    // Both cases regenerate cube_query_json, making the stored uid_count stale.
    // Flip status to 'refreshing' immediately so the UI shows in-flight state.
    const storedSegs = parseCubeSegments(row.cube_query_json as string | null) ?? [];
    const patchedSegs = patch.cube_segments ? [...patch.cube_segments].sort() : null;
    const cubeSegmentsChanged =
      hasPatchSegments &&
      nextType === 'predicate' &&
      JSON.stringify(patchedSegs) !== JSON.stringify([...storedSegs].sort());

    const predicateChanged =
      (patch.predicate_tree !== undefined &&
        patch.predicate_tree !== null &&
        nextType === 'predicate') ||
      cubeSegmentsChanged;
    const nextStatus = predicateChanged ? 'refreshing' : (row.status as string);

    // Cadence resolution. `track_cadence` is the single source of truth: when
    // the operator sets it, derive + dual-write the two legacy columns so both
    // schedulers follow one value. `Off` stops the auto recompute (null minutes)
    // and leaves the stored capture cadence untouched (capture is gated globally
    // by SEGMENT_SNAPSHOT_ENABLED — there is no per-segment capture-disable yet).
    // When `track_cadence` is absent, fall back to the legacy direct setters.
    const prevRefreshMin = (row.refresh_cadence_min as number | null | undefined) ?? null;
    const prevSnapshotCadence = (row.snapshot_cadence as string | undefined) ?? 'daily';
    let nextTrack: string = (row.track_cadence as string | undefined) ?? 'daily';
    let nextRefreshMin: number | null = patch.refresh_cadence_min !== undefined ? patch.refresh_cadence_min : prevRefreshMin;
    let nextSnapshotCadence: string = patch.snapshot_cadence !== undefined ? patch.snapshot_cadence : prevSnapshotCadence;
    if (patch.track_cadence !== undefined) {
      nextTrack = patch.track_cadence;
      nextRefreshMin = trackToRefreshMinutes(patch.track_cadence);
      const derivedSnap = trackToSnapshotCadence(patch.track_cadence);
      if (derivedSnap !== null) nextSnapshotCadence = derivedSnap;
    }

    db.prepare(`
      UPDATE segments SET
        name = ?, type = ?, cube = ?, predicate_tree_json = ?, cube_query_json = ?,
        uid_count = ?, uid_list_json = ?, refresh_cadence_min = ?, snapshot_cadence = ?, track_cadence = ?, status = ?, visibility = ?, updated_at = ?
      WHERE id = ?
    `).run(
      patch.name ?? row.name,
      nextType,
      patch.cube !== undefined ? patch.cube : row.cube,
      patch.predicate_tree !== undefined ? (patch.predicate_tree ? JSON.stringify(patch.predicate_tree) : null) : row.predicate_tree_json,
      cubeQueryJson,
      nextUidCount,
      nextUidListJson,
      nextRefreshMin,
      nextSnapshotCadence,
      nextTrack,
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
      void enqueueRefresh(id, 'manual');
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

  // POST /api/segments/:id/serve — publish a segment as a downstream contract
  // (owner/admin only). Makes "served" an explicit, owned state: the public pull
  // path serves only 'served' segments (see public-export.ts), so this is what
  // turns a scratch segment into a pullable contract.
  app.post('/api/segments/:id/serve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'administer');
    if (!row) return reply;

    // A served contract must be snapshottable — refuse if capture can't run, else
    // we'd advertise a contract that never produces data to pull.
    if ((process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() !== 'true') {
      return reply.status(409).send({
        error: { code: 'SNAPSHOT_DISABLED', message: 'Snapshotting is disabled on this instance; cannot publish a served contract.' },
      });
    }

    const now = new Date().toISOString();
    // A served contract must have a schedule. If tracking is Off, auto-promote to
    // daily as part of publish (one rule — no contradictory 409-then-default), and
    // dual-write the legacy cadence columns the same way the PATCH route does.
    const currentTrack = (row.track_cadence as string | undefined) ?? 'daily';
    const nextTrack = currentTrack === 'Off' ? 'daily' : currentTrack;
    if (nextTrack !== currentTrack) {
      db.prepare(
        `UPDATE segments SET lifecycle = 'served', served_at = ?, served_by = ?,
           track_cadence = ?, refresh_cadence_min = ?, snapshot_cadence = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        now,
        req.principal.sub,
        nextTrack,
        trackToRefreshMinutes(coerceTrackCadence(nextTrack)),
        trackToSnapshotCadence(coerceTrackCadence(nextTrack)) ?? (row.snapshot_cadence as string | null),
        now,
        id,
      );
    } else {
      db.prepare(
        `UPDATE segments SET lifecycle = 'served', served_at = ?, served_by = ?, updated_at = ? WHERE id = ?`,
      ).run(now, req.principal.sub, now, id);
    }

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    emitSegmentOp(req, 'update', id);
    return {
      ...hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }),
      serving: buildServing(db, updated, Date.now()),
    };
  });

  // DELETE /api/segments/:id/serve — demote/unpublish (owner/admin only).
  // Transactional: re-reads entitled consumers and flips lifecycle atomically so a
  // concurrent key grant can't slip a consumer in between the check and the write.
  // Blocked (409) when consumers exist unless ?force=true, which deprecates instead
  // of fully demoting. Either way the public pull path then returns 403 — a real
  // kill-switch, not advisory.
  app.delete('/api/segments/:id/serve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = guardSegment(req, reply, id, 'administer');
    if (!row) return reply;

    const force = (req.query as { force?: string }).force === 'true';
    const now = new Date().toISOString();
    const outcome = db.transaction(() => {
      const fresh = db
        .prepare('SELECT id, workspace, game_id FROM segments WHERE id = ?')
        .get(id) as { id: string; workspace: string | null; game_id: string | null };
      const consumers = entitledKeysForSegment(fresh);
      if (consumers.length > 0 && !force) {
        return { blocked: true as const, consumers };
      }
      // Force-demote with consumers → 'deprecated' (kept distinct + readable in the
      // library, history retained); clean demote → 'draft' (cleared).
      if (consumers.length > 0) {
        db.prepare(`UPDATE segments SET lifecycle = 'deprecated', updated_at = ? WHERE id = ?`).run(now, id);
        return { blocked: false as const, target: 'deprecated' };
      }
      db.prepare(
        `UPDATE segments SET lifecycle = 'draft', served_at = NULL, served_by = NULL, updated_at = ? WHERE id = ?`,
      ).run(now, id);
      return { blocked: false as const, target: 'draft' };
    })();

    if (outcome.blocked) {
      return reply.status(409).send({
        error: {
          code: 'HAS_CONSUMERS',
          message: 'Segment has entitled consumers; demote with ?force=true to deprecate it.',
          consumers: outcome.consumers,
        },
      });
    }

    const updated = db.prepare('SELECT * FROM segments WHERE id = ?').get(id) as Record<string, unknown>;
    emitSegmentOp(req, 'update', id);
    return {
      ...hydrateSegment(updated, db, undefined, true, { sub: req.principal.sub, role: req.principal.role }),
      serving: buildServing(db, updated, Date.now()),
    };
  });

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

  // GET /api/segments/:id/membership-sql — runnable Trino SELECT reproducing the
  // segment's membership (identity projection of its predicate), surfaced in the
  // Pull API tab so a downstream team can run the cohort directly in Trino. This
  // is the exact SELECT the lakehouse snapshot writer lands. Live (predicate)
  // segments only — manual segments are a frozen uid list with no generating query.
  app.get('/api/segments/:id/membership-sql', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    if (row.type !== 'predicate' || !row.cube || !row.cube_query_json || !row.game_id) {
      return reply.status(400).send({
        error: {
          code: 'NOT_LIVE',
          message: 'Trino SQL is available for live (predicate) segments only.',
        },
      });
    }
    try {
      const built = await buildSegmentMembershipSql({
        cube: row.cube as string,
        gameId: row.game_id as string,
        workspace: row.workspace as string,
        cubeQueryJson: row.cube_query_json as string,
      });
      if (!built) {
        return reply.status(422).send({
          error: { code: 'NO_IDENTITY', message: `No identity-field mapping for ${row.cube}` },
        });
      }
      return {
        sql: built.sql,
        identity: built.identity,
        catalog: process.env.CUBEJS_DB_PRESTO_CATALOG ?? 'game_integration',
        schema: schemaForGame(row.game_id as string),
      };
    } catch (err) {
      return reply.status(502).send({
        error: { code: 'SQL_COMPILE_ERROR', message: (err as Error).message },
      });
    }
  });

  // GET /api/segments/:id/pull-credentials — admin-only. Hands a downstream
  // operator the two things they need to pull the FULL cohort themselves:
  //   1. A freshly-minted app JWT for the calling admin (same HS256/JWT_SECRET
  //      token the browser already holds) so they can curl the guarded
  //      membership-sql endpoint from a service/script.
  //   2. The Trino coordinates (host/port/user/catalog/schema) + the lakehouse
  //      snapshot-table identity, so they can run the cohort directly in Trino.
  // The Trino PASSWORD is deliberately NOT returned — it never lands in the
  // browser. The runnable block references it as $TRINO_PASS from the operator's
  // own environment. Admin-only because it both mints a token and reveals the
  // warehouse connection surface.
  app.get('/api/segments/:id/pull-credentials', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = guardSegment(req, reply, id, 'read');
    if (!row) return reply;
    if (req.principal.role !== 'admin') {
      return reply
        .status(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Admin only — pull credentials reveal the warehouse connection.' } });
    }

    // Mint a token for the caller's own identity (not a shared service account).
    // Authorization is still resolved server-side per request from the access
    // store, so this token grants exactly what the caller already has.
    const user = req.user;
    const appJwt = await signAppJwt({
      sub: req.principal.sub,
      username: user?.username ?? req.principal.email ?? req.principal.sub,
      email: req.principal.email ?? undefined,
      role: req.principal.role,
    });
    const expiresInMinutes = Number(process.env.JWT_EXPIRES_MINUTES ?? 720);

    // Non-secret Trino coordinates from the same env the lakehouse writer uses.
    // Password intentionally omitted (see route comment).
    let trino: { host: string; port: number; user: string; catalog: string; ssl: boolean } | null = null;
    try {
      const c = lakehouseConnectorFromEnv();
      trino = { host: c.host, port: c.port, user: c.user, catalog: c.catalog, ssl: c.ssl };
    } catch {
      trino = null; // CUBEJS_DB_* not configured on this instance
    }

    return {
      appJwt,
      expiresInMinutes,
      workspace: (row.workspace as string) ?? null,
      user: { email: req.principal.email, role: req.principal.role },
      // Session catalog/schema for running the membership-sql SELECT (bare table
      // refs resolve against these). Schema is per-game.
      trino: trino
        ? { ...trino, schema: schemaForGame(row.game_id as string) }
        : null,
      // The pre-materialized daily snapshot table — the gentlest full-cohort
      // path in prod. `snapshotEnabled` tells the UI whether this instance is
      // actually landing partitions (false locally by default).
      lakehouse: {
        catalog: LAKEHOUSE_CATALOG,
        schema: LAKEHOUSE_SCHEMA,
        table: 'segment_membership_daily',
        snapshotEnabled: (process.env.SEGMENT_SNAPSHOT_ENABLED ?? 'false').toLowerCase() === 'true',
      },
    };
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
    void enqueueRefresh(id, 'manual');

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
