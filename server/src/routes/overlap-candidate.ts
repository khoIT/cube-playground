/**
 * POST /api/overlap-candidate — novelty guard for NOT-YET-SAVED candidate cohorts.
 *
 * Flags when a candidate predicate closely overlaps the caller's existing saved
 * segments in the same game, helping surface segment-sprawl risk before saving.
 *
 * The candidate has no snapshot row, so this is APPROXIMATE:
 *   1. Fetch a bounded uid sample from Cube by projecting the identity dimension
 *      with the candidate's translated filters (same building blocks as
 *      compute-segment-size, but with LIMIT instead of total:true).
 *   2. Intersect that sample against the latest-partition snapshot membership of
 *      the caller's own same-game predicate segments in SQLite.
 *   3. Rank by pct_of_candidate, return top-K hits above the threshold.
 *
 * Non-blocking contract: ANY failure (Cube down, Trino timeout, empty snapshot,
 * empty sample) returns HTTP 200 with an empty overlaps array. Never throws 500.
 * The `approx: true` flag is unconditional — callers must not present this data
 * as exact. `took_ms` is informational only.
 *
 * Scoping decision: only the caller's own segments in the same game are checked
 * (owner = req.owner, workspace = req.workspace.id, game_id = body.game_id).
 * Workspace-shared segments are deliberately out of scope for this round — the
 * cross-caller overlap surface is a separate, explicit governance decision.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';
import { treeToCubeFilters } from '../services/translator.js';
import { resolveIdentityDetailed } from '../services/resolve-identity-field.js';
import { loadWithContinueWait } from '../services/load-with-continue-wait.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';
import { lakehouseConnectorFromEnv, LAKEHOUSE_SCHEMA } from '../lakehouse/lakehouse-trino-connector.js';
import { computeCandidateOverlap, MAX_CANDIDATE_SAMPLE } from '../lakehouse/candidate-overlap-counts.js';
import type { PredicateNode } from '../types/predicate-tree.js';

/** Timeout for the entire overlap check. Must be well under any proxy limit so
 *  the UI never blocks on this non-critical path. */
const OVERLAP_TIMEOUT_MS = 20_000;

/** Timeout for the Cube uid-sample fetch sub-step; leaves headroom for Trino. */
const SAMPLE_FETCH_TIMEOUT_MS = 10_000;

/** Max saved segments to check. Bounds the VALUES list and the Trino query cost. */
const MAX_SAVED_SEGMENTS = 50;

const bodySchema = z.object({
  game_id: z.string().min(1).max(64),
  cube: z.string().min(1),
  predicate: z.unknown(),
});

export interface OverlapHit {
  segment_id: string;
  name: string;
  candidate_size: number;
  both_count: number;
  pct_of_candidate: number;
}

export interface OverlapCandidateResponse {
  overlaps: OverlapHit[];
  approx: true;
  took_ms: number;
}

export default async function overlapCandidateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/overlap-candidate', async (req, reply) => {
    const t0 = Date.now();

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const { game_id, cube, predicate } = parsed.data;
    // Scope strictly to the authenticated caller's own segments — never a
    // body-supplied owner, which would leak another operator's private segment
    // names + approximate membership within the same workspace.
    const owner = req.owner;
    const workspaceId = req.workspace.id;

    // Wrap the entire check in a timeout + try-catch. Any internal failure
    // (Cube unavailable, Trino down, parse error) returns empty overlaps, never 500.
    try {
      const result = await Promise.race([
        runOverlapCheck({ game_id, cube, predicate: predicate as PredicateNode, owner, workspaceId }),
        timeout(OVERLAP_TIMEOUT_MS).then(() => [] as OverlapHit[]),
      ]);

      const response: OverlapCandidateResponse = {
        overlaps: result,
        approx: true,
        took_ms: Date.now() - t0,
      };
      return response;
    } catch (err) {
      // Log but do not surface — the novelty guard is advisory, not critical.
      app.log.warn({ err }, 'overlap-candidate: check failed, returning empty');
      const response: OverlapCandidateResponse = {
        overlaps: [],
        approx: true,
        took_ms: Date.now() - t0,
      };
      return response;
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`overlap-candidate: timed out after ${ms}ms`)), ms),
  );
}

/**
 * Core logic, separated so the route handler can wrap it cleanly in
 * Promise.race + try/catch without nested indentation.
 */
async function runOverlapCheck(opts: {
  game_id: string;
  cube: string;
  predicate: PredicateNode;
  owner: string;
  workspaceId: string;
}): Promise<OverlapHit[]> {
  const { game_id, cube, predicate, owner, workspaceId } = opts;

  // Step 1 — Resolve the identity field for this cube so we know what column
  //           carries uids. Without it there's nothing to intersect.
  const identity = await resolveIdentityDetailed(cube, game_id, { workspaceId });
  if (!identity.field) return [];

  // Step 2 — Translate the predicate tree to Cube filters and fetch a bounded
  //           uid sample. This mirrors compute-segment-size's query build but
  //           uses LIMIT (not `total:true`) so Cube returns actual uid rows.
  //           The sample IS the approximation source — the denominator for pct.
  const filters = treeToCubeFilters(predicate);
  const sampleQuery = {
    dimensions: [identity.field],
    filters,
    limit: MAX_CANDIDATE_SAMPLE,
  };

  const token = resolveCubeTokenForGame(game_id) ?? undefined;

  let loadResult: unknown;
  try {
    loadResult = await loadWithContinueWait(sampleQuery, token, SAMPLE_FETCH_TIMEOUT_MS);
  } catch {
    // Cube unavailable or timeout — can't sample, nothing to compare.
    return [];
  }

  // Extract the uid column from the Cube load response.
  const candidateUids = extractUids(loadResult, identity.field);
  if (candidateUids.length === 0) return [];

  // Step 3 — Load the caller's own saved predicate segments for this game from
  //           SQLite. Bounded to the most recent MAX_SAVED_SEGMENTS to cap cost.
  const db = getDb();
  const savedRows = db
    .prepare(
      `SELECT id, name
       FROM segments
       WHERE owner = ? AND workspace = ? AND game_id = ? AND type = 'predicate'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(owner, workspaceId, game_id, MAX_SAVED_SEGMENTS) as Array<{ id: string; name: string }>;

  if (savedRows.length === 0) return [];

  // Step 4 — Intersect candidate sample against snapshot membership in Trino.
  let connector;
  try {
    connector = lakehouseConnectorFromEnv();
  } catch {
    // Lakehouse not configured (e.g. test env without CUBEJS_DB_HOST).
    return [];
  }

  const remaining = OVERLAP_TIMEOUT_MS - SAMPLE_FETCH_TIMEOUT_MS;
  return computeCandidateOverlap(
    connector,
    LAKEHOUSE_SCHEMA,
    { gameId: game_id, savedSegments: savedRows, candidateUids, timeoutMs: Math.max(1_000, remaining) },
  );
}

/**
 * Pull uid strings out of a Cube /load response. Cube returns:
 *   { data: [{ "<cube>.<dim>": "uid_value", ... }], ... }
 * or the batched shape:
 *   { results: [{ data: [...] }], ... }
 *
 * We extract the single identity dimension column by exact key match.
 */
function extractUids(loadResult: unknown, identityField: string): string[] {
  const r = loadResult as {
    data?: Array<Record<string, unknown>>;
    results?: Array<{ data?: Array<Record<string, unknown>> }>;
  };
  const rows = r.data ?? r.results?.[0]?.data ?? [];
  const uids: string[] = [];
  for (const row of rows) {
    const v = row[identityField];
    if (v != null && String(v).length > 0) {
      uids.push(String(v));
    }
  }
  return uids;
}
