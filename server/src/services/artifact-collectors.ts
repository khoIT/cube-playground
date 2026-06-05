/**
 * Artifact collectors for the validation sweep.
 *
 * Each collector queries the server SQLite (or chat DB) for saved artifacts
 * and normalises them into a uniform shape. Bad JSON is captured as a sentinel
 * (malformed:true) so the caller can emit runtime-error without throwing.
 */

import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Shared shape
// ---------------------------------------------------------------------------

/** A Cube query in the subset we need to validate. */
export interface CubeQueryLike {
  measures?: string[];
  dimensions?: string[];
  timeDimensions?: Array<{ dimension?: string; dateRange?: unknown; granularity?: string }>;
  segments?: string[];
  filters?: Array<{ member?: string; dimension?: string }>;
  limit?: number;
  [key: string]: unknown;
}

/** Normalized artifact ready for classification. */
export interface CollectedArtifact {
  kind: 'dashboard' | 'segment' | 'chat';
  id: string;
  /** game_id for game_id workspaces; null when unavailable. */
  game: string | null;
  title: string;
  /** Parsed query — or null when JSON was malformed. */
  query: CubeQueryLike | null;
  /** Present when query could not be parsed — triggers runtime-error classification. */
  malformed?: true;
  malformedDetail?: string;
  // Persisted execution state — populated for dashboard tiles and segments only.
  persistedStatus?: 'fresh' | 'refreshing' | 'broken' | 'stale' | null;
  persistedErrorMsg?: string | null;
  /** tile_id (dashboards only) — needed for cache lookup. */
  tileId?: number;
}

// ---------------------------------------------------------------------------
// Dashboard tiles + tile-cache status
// ---------------------------------------------------------------------------

interface TileRow {
  tile_id: number;
  dashboard_title: string;
  tile_title: string;
  game: string;
  query_json: string;
  cache_status: string | null;
  cache_error_msg: string | null;
}

/**
 * Collect dashboard tiles (with their tile-cache status) for the given owner
 * in the given workspace. NO /load calls.
 */
export function collectDashboardArtifacts(
  db: BetterSqlite3.Database,
  owner: string,
  workspaceId: string,
): CollectedArtifact[] {
  let rows: TileRow[];
  try {
    rows = db
      .prepare(
        `SELECT
           t.id            AS tile_id,
           d.title         AS dashboard_title,
           t.title         AS tile_title,
           d.game          AS game,
           t.query_json    AS query_json,
           c.status        AS cache_status,
           c.error_msg     AS cache_error_msg
         FROM dashboard_tiles t
         JOIN dashboards d ON d.id = t.dashboard_id
    LEFT JOIN dashboard_tile_cache c ON c.tile_id = t.id
        WHERE d.owner = ? AND d.workspace = ?`,
      )
      .all(owner, workspaceId) as TileRow[];
  } catch {
    // Table absent in early test DBs — return empty rather than throw.
    return [];
  }

  return rows.map((row): CollectedArtifact => {
    let query: CubeQueryLike | null = null;
    let malformed: true | undefined;
    let malformedDetail: string | undefined;
    try {
      query = JSON.parse(row.query_json) as CubeQueryLike;
    } catch (err) {
      malformed = true;
      malformedDetail = err instanceof Error ? err.message : String(err);
    }
    return {
      kind: 'dashboard',
      id: String(row.tile_id),
      game: row.game ?? null,
      title: `${row.dashboard_title} / ${row.tile_title}`,
      query,
      malformed,
      malformedDetail,
      tileId: row.tile_id,
      persistedStatus: (row.cache_status as CollectedArtifact['persistedStatus']) ?? null,
      persistedErrorMsg: row.cache_error_msg ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

interface SegmentRow {
  id: string;
  name: string;
  game_id: string | null;
  cube_query_json: string | null;
  status: string;
  broken_reason: string | null;
}

/**
 * Collect predicate segments with a cube_query_json for the given owner +
 * workspace. Segments carry a game_id column (migration 004-game-scoping).
 */
export function collectSegmentArtifacts(
  db: BetterSqlite3.Database,
  owner: string,
  workspaceId: string,
): CollectedArtifact[] {
  let rows: SegmentRow[];
  try {
    rows = db
      .prepare(
        `SELECT id, name, game_id, cube_query_json, status, broken_reason
           FROM segments
          WHERE owner = ? AND workspace = ?
            AND cube_query_json IS NOT NULL`,
      )
      .all(owner, workspaceId) as SegmentRow[];
  } catch {
    return [];
  }

  return rows.map((row): CollectedArtifact => {
    let query: CubeQueryLike | null = null;
    let malformed: true | undefined;
    let malformedDetail: string | undefined;
    try {
      query = JSON.parse(row.cube_query_json!) as CubeQueryLike;
    } catch (err) {
      malformed = true;
      malformedDetail = err instanceof Error ? err.message : String(err);
    }
    return {
      kind: 'segment',
      id: row.id,
      game: row.game_id ?? null,
      title: row.name,
      query,
      malformed,
      malformedDetail,
      persistedStatus: (row.status as CollectedArtifact['persistedStatus']) ?? null,
      persistedErrorMsg: row.broken_reason ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Chat artifacts (read-only from chat-service SQLite)
// ---------------------------------------------------------------------------

interface ChatTurnRow {
  session_id: string;
  artifacts_json: string | null;
}

interface RawQueryArtifact {
  id?: string;
  title?: string;
  game?: string;
  query?: CubeQueryLike;
}

/**
 * Open the chat DB read-only and collect all QueryArtifacts for the owner.
 * Returns an empty array (fail-open) if the DB is unreachable or unreadable.
 */
export function collectChatArtifacts(
  chatDb: BetterSqlite3.Database,
  owner: string,
): CollectedArtifact[] {
  let rows: ChatTurnRow[];
  try {
    rows = chatDb
      .prepare(
        `SELECT ct.session_id, ct.artifacts_json
           FROM chat_turns ct
           JOIN chat_sessions cs ON cs.id = ct.session_id
          WHERE cs.owner_id = ?
            AND ct.artifacts_json IS NOT NULL`,
      )
      .all(owner) as ChatTurnRow[];
  } catch {
    return [];
  }

  const out: CollectedArtifact[] = [];
  for (const row of rows) {
    let artifacts: RawQueryArtifact[] = [];
    try {
      artifacts = JSON.parse(row.artifacts_json!) as RawQueryArtifact[];
    } catch {
      continue; // malformed artifacts_json — skip turn
    }
    if (!Array.isArray(artifacts)) continue;
    for (const art of artifacts) {
      if (!art || typeof art !== 'object') continue;
      const hasQuery = art.query && typeof art.query === 'object';
      out.push({
        kind: 'chat',
        id: art.id ?? `${row.session_id}/${out.length}`,
        game: art.game ?? null,
        title: art.title ?? '(untitled)',
        query: hasQuery ? (art.query as CubeQueryLike) : null,
        malformed: hasQuery ? undefined : true,
        malformedDetail: hasQuery ? undefined : 'missing or invalid query field',
      });
    }
  }
  return out;
}
