/**
 * Artifact validation sweep — three-tier classification (cheapest first):
 *
 *  1. Static member check against /meta snapshot (free — no /load).
 *     Catches renamed/removed measures, dimensions, time dimensions.
 *
 *  2. Persisted-execution read for dashboards + segments:
 *     tile-cache status='broken' and segment.broken_reason are read directly
 *     from SQLite — the existing refresh jobs already execute these. No new
 *     /load is ever issued for dashboards or segments.
 *
 *  3. Live probe for CHAT artifacts only (opt-in live:true, bounded ≤2).
 *     Emits a limit:1 query and classifies via the partition-error predicate.
 *
 * Fail-open per artifact: malformed query_json → runtime-error, sweep continues.
 * Non-game_id workspaces → empty result + note.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getMetaWithCtx,
  loadWithCtx,
  type WorkspaceCtx,
} from './cube-client.js';
import { resolveCubeTokenForWorkspace } from './resolve-cube-token.js';
import { loadGamesConfig } from './games-config-loader.js';
import { mapWithConcurrency } from './bounded-concurrency.js';
import {
  snapshotFromMeta,
  parseFqn,
  type MetaResponse,
  type MetaSnapshot,
} from './metric-ref-validator.js';
import { isPartitionNotBuiltError } from './preagg-readiness.js';
import type { WorkspaceDef } from './workspaces-config-loader.js';
import {
  collectDashboardArtifacts,
  collectSegmentArtifacts,
  collectChatArtifacts,
  type CollectedArtifact,
  type CubeQueryLike,
} from './artifact-collectors.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ArtifactStatus =
  | 'ok'
  | 'unverified'
  | 'missing-member'
  | 'missing-preagg'
  | 'runtime-error';

export interface ArtifactResult {
  kind: 'dashboard' | 'segment' | 'chat';
  id: string;
  game: string | null;
  title: string;
  status: ArtifactStatus;
  detail?: string;
  /** Unresolved member refs when status='missing-member'. */
  refs?: string[];
}

export interface SweepSummary {
  total: number;
  ok: number;
  unverified: number;
  missingMember: number;
  missingPreagg: number;
  runtimeError: number;
}

export interface SweepResult {
  dashboards: ArtifactResult[];
  segments: ArtifactResult[];
  chatArtifacts: ArtifactResult[];
  summary: SweepSummary;
  generatedAt: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Member extraction
// ---------------------------------------------------------------------------

/**
 * Pull all fully-qualified member refs from a CubeQuery that can be validated
 * against /meta. Only ref-bearing fields: measures, dimensions,
 * timeDimensions[].dimension — NOT filter values or order keys (those are
 * runtime data, not schema refs).
 */
function extractMembers(query: CubeQueryLike): string[] {
  const refs: string[] = [];
  for (const m of query.measures ?? []) {
    if (typeof m === 'string') refs.push(m);
  }
  for (const d of query.dimensions ?? []) {
    if (typeof d === 'string') refs.push(d);
  }
  for (const td of query.timeDimensions ?? []) {
    if (typeof td.dimension === 'string') refs.push(td.dimension);
  }
  // Cube segment refs are cube-qualified strings; validate them as members.
  // Segment strings that don't contain a dot are skip-safe (not fqn, not schema refs).
  for (const s of query.segments ?? []) {
    if (typeof s === 'string' && s.includes('.')) refs.push(s);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Static member check
// ---------------------------------------------------------------------------

/**
 * Returns the list of unresolved member refs, or an empty array when all
 * refs resolve in the snapshot. Uses the same parseFqn logic as the
 * business-metric validator.
 */
function staticCheck(query: CubeQueryLike, snapshot: MetaSnapshot): string[] {
  const unresolved: string[] = [];
  for (const ref of extractMembers(query)) {
    const parsed = parseFqn(ref);
    if (!parsed) {
      unresolved.push(ref); // unparseable — treat as unresolved
      continue;
    }
    if (!snapshot.members.has(parsed.fqn)) {
      unresolved.push(ref);
    }
  }
  return unresolved;
}

/**
 * When a segment has no game_id or its snapshot is unavailable, validate
 * against the union of all available snapshots. Returns unresolved refs
 * (a ref is ok if ANY game's snapshot resolves it).
 */
function staticCheckUnionMeta(
  query: CubeQueryLike,
  snapshotByGame: Map<string, MetaSnapshot>,
): string[] {
  const refs = extractMembers(query);
  if (refs.length === 0) return [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    const parsed = parseFqn(ref);
    if (!parsed) {
      unresolved.push(ref);
      continue;
    }
    let resolvedInAny = false;
    for (const snap of snapshotByGame.values()) {
      if (snap.members.has(parsed.fqn)) {
        resolvedInAny = true;
        break;
      }
    }
    if (!resolvedInAny) unresolved.push(ref);
  }
  return unresolved;
}

// ---------------------------------------------------------------------------
// Persisted-execution classifier
// ---------------------------------------------------------------------------

/**
 * Map tile-cache / segment persisted statuses to sweep classifications.
 * NO /load calls are made here — the refresh jobs already ran the queries.
 */
function classifyPersisted(
  persistedStatus: string | null | undefined,
  errorMsg: string | null | undefined,
): ArtifactStatus {
  if (persistedStatus === 'fresh') return 'ok';
  if (persistedStatus === 'broken') {
    const msg = errorMsg ?? '';
    return isPartitionNotBuiltError(msg) ? 'missing-preagg' : 'runtime-error';
  }
  // refreshing / stale / null (no cache row yet) → unverified
  return 'unverified';
}

// ---------------------------------------------------------------------------
// Live probe (chat artifacts only)
// ---------------------------------------------------------------------------

/**
 * Build a narrowed probe query: limit:1, dateRange shrunk to yesterday if a
 * timeDimension is present. Avoids large scans while still triggering the
 * partition-not-built error path when the pre-agg is absent.
 */
function buildProbeQuery(query: CubeQueryLike): CubeQueryLike {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const iso = yesterday.toISOString().slice(0, 10);

  const timeDimensions = (query.timeDimensions ?? []).map((td) => ({
    ...td,
    dateRange: [iso, iso] as [string, string],
  }));

  return {
    ...query,
    limit: 1,
    timeDimensions: timeDimensions.length > 0 ? timeDimensions : query.timeDimensions,
  };
}

/**
 * Issue a bounded live probe for a single chat artifact.
 * Always resolves — failures become 'runtime-error'.
 */
async function liveClassify(query: CubeQueryLike, ctx: WorkspaceCtx): Promise<ArtifactStatus> {
  try {
    await loadWithCtx(buildProbeQuery(query), ctx);
    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return isPartitionNotBuiltError(msg) ? 'missing-preagg' : 'runtime-error';
  }
}

// ---------------------------------------------------------------------------
// Chat DB access
// ---------------------------------------------------------------------------

const CHAT_DB_PATH_ENV = 'CHAT_DB_PATH';

/** Path to the chat-service runtime SQLite. */
function resolveChatDbPath(): string {
  // Server env may set CHAT_DB_PATH to override (same var the chat-service itself reads).
  const envPath = process.env[CHAT_DB_PATH_ENV];
  if (envPath) return envPath;
  // Default anchors to the repo checkout, not process.cwd() — a bare relative
  // path resolves against whatever directory the process was launched from and
  // silently misses the DB (same failure shape as the old cwd-relative sqlite
  // fallback). Three levels up from this file (src/services or dist/services →
  // server → repo root), then into the sibling chat-service runtime.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'chat-service', 'runtime', 'chat.db');
}

/**
 * Open the chat DB read-only. Returns null (fail-open) if the file is absent
 * or cannot be opened — the sweep will return chatArtifacts:[] + note.
 */
function openChatDb(): { db: InstanceType<typeof Database>; path: string } | null {
  const path = resolveChatDbPath();
  try {
    const db = new Database(path, { readonly: true });
    return { db, path };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ctx builder (mirrors workspace-readiness.ts)
// ---------------------------------------------------------------------------

function buildCtxFor(workspace: WorkspaceDef, gameId: string | null): WorkspaceCtx {
  const { token } = resolveCubeTokenForWorkspace(workspace, gameId);
  return { cubeApiUrl: workspace.cubeApiUrl, token };
}

// ---------------------------------------------------------------------------
// Main sweep entry point
// ---------------------------------------------------------------------------

export interface SweepOptions {
  live?: boolean;
}

/**
 * Run the three-tier validation sweep for a single workspace + owner.
 *
 * Only game_id workspaces are swept — others return empty sections + note.
 * Never throws: per-artifact failures are captured as runtime-error.
 */
export async function runSweep(
  db: InstanceType<typeof Database>,
  workspace: WorkspaceDef,
  owner: string,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const { live = false } = options;

  // Non-game_id workspaces: sweep is not applicable.
  if (workspace.gameModel !== 'game_id') {
    return {
      dashboards: [],
      segments: [],
      chatArtifacts: [],
      summary: buildSummary([]),
      generatedAt: new Date().toISOString(),
      note: 'artifact sweep only applies to game_id workspaces',
    };
  }

  // ── Step 1: fetch /meta per game (one fetch per game, reuse snapshot) ────
  const cfg = loadGamesConfig();
  const snapshotByGame = new Map<string, MetaSnapshot>();
  const ctxByGame = new Map<string, WorkspaceCtx>();

  for (const g of cfg.games) {
    const ctx = buildCtxFor(workspace, g.id);
    ctxByGame.set(g.id, ctx);
    try {
      const meta = (await getMetaWithCtx(ctx)) as MetaResponse;
      snapshotByGame.set(g.id, snapshotFromMeta(meta));
    } catch {
      // Game unavailable — artifacts for this game will classify as unverified
      // (no snapshot → static check cannot run).
    }
  }

  // ── Step 2: collect artifacts ────────────────────────────────────────────
  const dashboardArtifacts = collectDashboardArtifacts(db, owner, workspace.id);
  const segmentArtifacts = collectSegmentArtifacts(db, owner, workspace.id);

  let chatArtifacts: CollectedArtifact[] = [];
  let chatNote: string | undefined;
  const chatDbHandle = openChatDb();
  if (chatDbHandle) {
    try {
      chatArtifacts = collectChatArtifacts(chatDbHandle.db, owner);
    } catch {
      chatNote = 'chat DB query failed; chat artifacts skipped';
    } finally {
      try {
        chatDbHandle.db.close();
      } catch {
        // ignore close errors
      }
    }
  } else {
    chatNote = 'chat DB unavailable; chat artifacts skipped';
  }

  // ── Step 3: classify each group ──────────────────────────────────────────
  const dashboardResults = classifyPersistableGroup(
    dashboardArtifacts,
    snapshotByGame,
  );
  const segmentResults = classifyPersistableGroup(
    segmentArtifacts,
    snapshotByGame,
  );

  // Chat artifacts: static check then optional live probe.
  const chatResults = await classifyChatGroup(
    chatArtifacts,
    snapshotByGame,
    ctxByGame,
    live,
  );

  const allResults = [...dashboardResults, ...segmentResults, ...chatResults];
  const result: SweepResult = {
    dashboards: dashboardResults,
    segments: segmentResults,
    chatArtifacts: chatResults,
    summary: buildSummary(allResults),
    generatedAt: new Date().toISOString(),
  };
  if (chatNote) result.note = chatNote;
  return result;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/**
 * Classify dashboard or segment artifacts using static check + persisted status.
 * Never issues /load.
 */
function classifyPersistableGroup(
  artifacts: CollectedArtifact[],
  snapshotByGame: Map<string, MetaSnapshot>,
): ArtifactResult[] {
  return artifacts.map((art): ArtifactResult => {
    // Malformed JSON → runtime-error immediately.
    if (art.malformed) {
      return {
        kind: art.kind,
        id: art.id,
        game: art.game,
        title: art.title,
        status: 'runtime-error',
        detail: art.malformedDetail ?? 'malformed query_json',
      };
    }

    const query = art.query!;

    // Static member check.
    const snapshot = art.game ? snapshotByGame.get(art.game) : undefined;
    let unresolvedRefs: string[];
    if (snapshot) {
      unresolvedRefs = staticCheck(query, snapshot);
    } else {
      // No game or snapshot unavailable → union-meta check.
      unresolvedRefs =
        snapshotByGame.size > 0
          ? staticCheckUnionMeta(query, snapshotByGame)
          : [];
    }

    if (unresolvedRefs.length > 0) {
      return {
        kind: art.kind,
        id: art.id,
        game: art.game,
        title: art.title,
        status: 'missing-member',
        refs: unresolvedRefs,
      };
    }

    // Static passed → read persisted execution state.
    const status = classifyPersisted(art.persistedStatus, art.persistedErrorMsg);
    const result: ArtifactResult = {
      kind: art.kind,
      id: art.id,
      game: art.game,
      title: art.title,
      status,
    };
    if (status === 'runtime-error' && art.persistedErrorMsg) {
      result.detail = art.persistedErrorMsg;
    }
    return result;
  });
}

/**
 * Classify chat artifacts: static check, then opt-in live probe (bounded ≤2).
 * Live probes only run for artifacts that passed the static check.
 */
async function classifyChatGroup(
  artifacts: CollectedArtifact[],
  snapshotByGame: Map<string, MetaSnapshot>,
  ctxByGame: Map<string, WorkspaceCtx>,
  live: boolean,
): Promise<ArtifactResult[]> {
  // First pass: static check (synchronous).
  type PendingLive = { index: number; artifact: CollectedArtifact; ctx: WorkspaceCtx };
  const results: ArtifactResult[] = new Array(artifacts.length);
  const pendingLive: PendingLive[] = [];

  for (let i = 0; i < artifacts.length; i++) {
    const art = artifacts[i];

    if (art.malformed) {
      results[i] = {
        kind: 'chat',
        id: art.id,
        game: art.game,
        title: art.title,
        status: 'runtime-error',
        detail: art.malformedDetail ?? 'malformed query',
      };
      continue;
    }

    const query = art.query!;
    const snapshot = art.game ? snapshotByGame.get(art.game) : undefined;
    const unresolvedRefs = snapshot
      ? staticCheck(query, snapshot)
      : snapshotByGame.size > 0
        ? staticCheckUnionMeta(query, snapshotByGame)
        : [];

    if (unresolvedRefs.length > 0) {
      results[i] = {
        kind: 'chat',
        id: art.id,
        game: art.game,
        title: art.title,
        status: 'missing-member',
        refs: unresolvedRefs,
      };
      continue;
    }

    // Static passed.
    if (live && art.game && ctxByGame.has(art.game)) {
      // Queue for bounded live probe.
      pendingLive.push({ index: i, artifact: art, ctx: ctxByGame.get(art.game)! });
    } else {
      results[i] = {
        kind: 'chat',
        id: art.id,
        game: art.game,
        title: art.title,
        status: 'unverified',
      };
    }
  }

  // Live probes bounded at 2 concurrent.
  if (pendingLive.length > 0) {
    await mapWithConcurrency(pendingLive, 2, async (pending) => {
      const liveStatus = await liveClassify(pending.artifact.query!, pending.ctx);
      results[pending.index] = {
        kind: 'chat',
        id: pending.artifact.id,
        game: pending.artifact.game,
        title: pending.artifact.title,
        status: liveStatus,
      };
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(results: ArtifactResult[]): SweepSummary {
  const summary: SweepSummary = {
    total: results.length,
    ok: 0,
    unverified: 0,
    missingMember: 0,
    missingPreagg: 0,
    runtimeError: 0,
  };
  for (const r of results) {
    if (r.status === 'ok') summary.ok++;
    else if (r.status === 'unverified') summary.unverified++;
    else if (r.status === 'missing-member') summary.missingMember++;
    else if (r.status === 'missing-preagg') summary.missingPreagg++;
    else if (r.status === 'runtime-error') summary.runtimeError++;
  }
  return summary;
}
