/**
 * Cube identity-field mapping routes.
 *
 * GET merges persisted overrides from cube_identity_map with auto-suggestions
 * derived from /meta. Persisted rows win; cubes without an override surface as
 * is_suggested=true so the FE can highlight them for review.
 *
 * PUT upserts a manual override for a specific cube. DELETE removes an
 * override and reverts to the auto-suggest source.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';
import { suggestIdentities, type IdentitySuggestion } from '../services/identity-suggester.js';
import { logicalCubeAcross, logicalMember, physicalMember } from '../services/cube-member-resolver.js';
import { loadGamesConfig } from '../services/games-config-loader.js';
import { listWorkspaceGameIds } from '../services/prod-game-registry.js';
import type { WorkspaceCtx } from '../services/cube-client.js';

const identityPutSchema = z.object({
  identity_field: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

interface PersistedRow {
  cube: string;
  identity_field: string;
  source: 'manual' | 'auto';
  confidence: number | null;
  updated_at: string;
}

export interface MergedIdentityRow {
  cube: string;
  identity_field: string | null;
  source: 'manual' | 'auto-suggest';
  is_suggested: boolean;
  confidence: number;
  matched_pattern: string | null;
  updated_at: string | null;
}

/**
 * Merge persisted overrides with auto-suggestions, optionally physicalizing
 * back to the active workspace's naming model.
 *
 * When `prefixes` is non-empty (prefix workspace): persisted overrides are
 * stored in logical (prefix-stripped) space. For each physical suggestion we
 * find its logical key, look up any override, then emit the row with the
 * PHYSICAL cube name so the FE (which speaks physical names) can match it.
 *
 * When `prefixes` is empty (game_id/local workspace): behavior is byte-for-byte
 * identical to before — logicalCubeAcross is a no-op, no physicalization occurs.
 */
export function mergeIdentityRows(
  persisted: PersistedRow[],
  suggestions: IdentitySuggestion[],
  prefixes: string[] = [],
): MergedIdentityRow[] {
  // Keyed by LOGICAL cube name so lookups work regardless of which game's
  // physical prefix the incoming suggestion carries.
  const byLogicalCube = new Map<string, PersistedRow>();
  for (const row of persisted) byLogicalCube.set(row.cube, row);

  const out: MergedIdentityRow[] = [];
  // Track which logical cubes were matched by a suggestion (for the orphan pass).
  const matchedLogicalCubes = new Set<string>();

  for (const s of suggestions) {
    const logicalKey = logicalCubeAcross(s.cube, prefixes);
    const override = byLogicalCube.get(logicalKey);
    if (override) {
      matchedLogicalCubes.add(logicalKey);
      // Physicalize the stored logical identity_field back to the physical cube's
      // prefix so the FE member lookup (`ballistar_mf_users.user_id`) matches.
      const matchingPrefix = prefixes.find((p) => s.cube.startsWith(`${p}_`)) ?? null;
      const physicalField = matchingPrefix
        ? physicalMember(override.identity_field, matchingPrefix)
        : override.identity_field;
      out.push({
        cube: s.cube, // physical name — FE matches this
        identity_field: physicalField,
        source: 'manual',
        is_suggested: false,
        confidence: override.confidence ?? 1,
        matched_pattern: s.matched_pattern,
        updated_at: override.updated_at,
      });
    } else {
      out.push({
        cube: s.cube,
        identity_field: s.identity_field,
        source: 'auto-suggest',
        is_suggested: true,
        confidence: s.confidence,
        matched_pattern: s.matched_pattern,
        updated_at: null,
      });
    }
  }

  // Persisted overrides for cubes no longer present in /meta still surface so
  // the user can see/remove them (orphaned rows in the Settings page).
  for (const row of persisted) {
    if (matchedLogicalCubes.has(row.cube)) continue;
    out.push({
      cube: row.cube, // stored logical name; acceptable for orphan display
      identity_field: row.identity_field,
      source: 'manual',
      is_suggested: false,
      confidence: row.confidence ?? 1,
      matched_pattern: null,
      updated_at: row.updated_at,
    });
  }

  out.sort((a, b) => a.cube.localeCompare(b.cube));
  return out;
}

/**
 * Derive the list of game (cube-name) prefixes for the active workspace. On a
 * prefix workspace this is the cube's `/cubes` registry (game id == prefix);
 * empty on game_id workspaces. Async because the prod list is fetched + cached.
 */
async function getPrefixes(req: FastifyRequest): Promise<string[]> {
  if (req.workspace.gameModel === 'prefix') {
    return listWorkspaceGameIds(req.workspace);
  }
  return [];
}

/**
 * Cube ctx for schema introspection. Two concerns, both handled here:
 *
 * 1. PRINCIPAL — minted under the service principal (via
 *    `buildIntrospectionCtxForGame`), NOT the request user's email. The
 *    identity map reads cube *metadata*, not user-scoped data, so gating it on
 *    the user's per-game cube grant adds no security — only a failure mode: a
 *    real-auth request mints `userId: <email>`, which the cube can't resolve,
 *    so /meta is denied and the suggester returns an EMPTY map → the
 *    expansion-mode row-selection column silently disappears. The service
 *    principal is one cube-dev's checkAuth always resolves, so introspection
 *    works whether auth is disabled OR a real user is logged in.
 *
 * 2. TENANT CLAIM — the identity map is workspace-global (on a game_id
 *    workspace every tenant shares the same logical cube names). A strict
 *    multi-tenant cube still rejects a game-less token ("Missing game claim"),
 *    so when no `x-cube-game` is pinned we introspect the default game. Prefix
 *    workspaces (prod) need no game: that cube is open and a game-less /meta
 *    returns all prefixed cubes, which the merge already handles.
 */
export function introspectionCtx(req: FastifyRequest): WorkspaceCtx {
  const rawGame = req.headers['x-cube-game'];
  let game: string | null =
    typeof rawGame === 'string' && rawGame.trim().length > 0 ? rawGame.trim() : null;
  if (!game && req.workspace.gameModel === 'game_id') {
    try {
      game = loadGamesConfig().defaultGameId || null;
    } catch {
      /* config unreadable — introspect game-less (cube may still reject) */
    }
  }
  // Decorated per-request by the workspace-header plugin; guard for direct
  // unit construction of a bare request.
  if (req.buildIntrospectionCtxForGame) return req.buildIntrospectionCtxForGame(game);
  return req.cubeCtx;
}

export default async function identityMapRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/identity-map — merged view, workspace-aware
  app.get('/api/identity-map', async (req, _reply) => {
    const prefixes = await getPrefixes(req);
    const db = getDb();
    const persisted = db
      .prepare('SELECT cube, identity_field, source, confidence, updated_at FROM cube_identity_map')
      .all() as PersistedRow[];

    let suggestions: IdentitySuggestion[] = [];
    try {
      // Pass the workspace ctx so the suggester queries the ACTIVE Cube endpoint,
      // not the local fallback — on prod the physical cube names differ from local.
      // On a game_id workspace with no pinned tenant, this resolves to the default
      // game so /meta isn't rejected for a missing game claim (empty-map bug).
      suggestions = await suggestIdentities(introspectionCtx(req));
    } catch (err) {
      // If Cube is unreachable we still want to surface persisted overrides.
      app.log.warn({ err }, 'identity-suggester failed — falling back to persisted overrides only');
    }

    return mergeIdentityRows(persisted, suggestions, prefixes);
  });

  // GET /api/settings/identity-map — alias matching plan path
  app.get('/api/settings/identity-map', async (req, reply) => {
    return app.inject({ method: 'GET', url: '/api/identity-map', headers: req.headers })
      .then((res) => reply.code(res.statusCode).send(res.json()));
  });

  // PUT /api/identity-map/:cube
  app.put('/api/identity-map/:cube', async (req, reply) => {
    const { cube } = req.params as { cube: string };
    const prefixes = await getPrefixes(req);

    const parsed = identityPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const { identity_field, confidence } = parsed.data;
    const now = new Date().toISOString();
    const db = getDb();

    // Store in LOGICAL (prefix-stripped) space so a single override covers all
    // games on prefix workspaces. On game_id workspaces logicalCubeAcross is a
    // no-op and cubeKey === cube.
    const cubeKey = logicalCubeAcross(cube, prefixes);
    // Also logicalize the identity_field — strip whichever game prefix the
    // physical field carries so the stored key is portable across games.
    const matchingPrefix = prefixes.find((p) => identity_field.startsWith(`${p}_`)) ?? null;
    const logicalField = matchingPrefix ? logicalMember(identity_field, matchingPrefix) : identity_field;

    db.prepare(`
      INSERT INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
      VALUES (?, ?, 'manual', ?, ?)
      ON CONFLICT(cube) DO UPDATE SET
        identity_field = excluded.identity_field,
        source = 'manual',
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(cubeKey, logicalField, confidence ?? 1, now);

    return db.prepare('SELECT * FROM cube_identity_map WHERE cube = ?').get(cubeKey);
  });

  // PUT /api/settings/identity-map/:cube — alias
  app.put('/api/settings/identity-map/:cube', async (req, reply) => {
    return app
      .inject({
        method: 'PUT',
        url: `/api/identity-map/${encodeURIComponent((req.params as { cube: string }).cube)}`,
        headers: req.headers,
        payload: req.body as object,
      })
      .then((res) => reply.code(res.statusCode).send(res.json()));
  });

  // DELETE /api/identity-map/:cube — revert to auto-suggest
  app.delete('/api/identity-map/:cube', async (req, reply) => {
    const { cube } = req.params as { cube: string };
    const prefixes = await getPrefixes(req);
    // Logicalize so the delete hits the same logical key the PUT wrote.
    const cubeKey = logicalCubeAcross(cube, prefixes);
    const db = getDb();
    db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run(cubeKey);
    return reply.status(204).send();
  });
}
