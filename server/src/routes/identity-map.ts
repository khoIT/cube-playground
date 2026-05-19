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

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';
import { suggestIdentities, type IdentitySuggestion } from '../services/identity-suggester.js';

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

export function mergeIdentityRows(
  persisted: PersistedRow[],
  suggestions: IdentitySuggestion[],
): MergedIdentityRow[] {
  const byCube = new Map<string, PersistedRow>();
  for (const row of persisted) byCube.set(row.cube, row);

  const out: MergedIdentityRow[] = [];
  const persistedCubes = new Set<string>();

  for (const s of suggestions) {
    const override = byCube.get(s.cube);
    if (override) {
      persistedCubes.add(s.cube);
      out.push({
        cube: s.cube,
        identity_field: override.identity_field,
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
  // the user can see/remove them.
  for (const row of persisted) {
    if (persistedCubes.has(row.cube)) continue;
    out.push({
      cube: row.cube,
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

export default async function identityMapRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/identity-map — merged view
  app.get('/api/identity-map', async (_req, _reply) => {
    const db = getDb();
    const persisted = db
      .prepare('SELECT cube, identity_field, source, confidence, updated_at FROM cube_identity_map')
      .all() as PersistedRow[];

    let suggestions: IdentitySuggestion[] = [];
    try {
      suggestions = await suggestIdentities();
    } catch (err) {
      // If Cube is unreachable we still want to surface persisted overrides.
      app.log.warn({ err }, 'identity-suggester failed — falling back to persisted overrides only');
    }

    return mergeIdentityRows(persisted, suggestions);
  });

  // GET /api/settings/identity-map — alias matching plan path
  app.get('/api/settings/identity-map', async (req, reply) => {
    return app.inject({ method: 'GET', url: '/api/identity-map', headers: req.headers })
      .then((res) => reply.code(res.statusCode).send(res.json()));
  });

  // PUT /api/identity-map/:cube
  app.put('/api/identity-map/:cube', async (req, reply) => {
    const { cube } = req.params as { cube: string };

    const parsed = identityPutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }

    const { identity_field, confidence } = parsed.data;
    const now = new Date().toISOString();
    const db = getDb();

    db.prepare(`
      INSERT INTO cube_identity_map (cube, identity_field, source, confidence, updated_at)
      VALUES (?, ?, 'manual', ?, ?)
      ON CONFLICT(cube) DO UPDATE SET
        identity_field = excluded.identity_field,
        source = 'manual',
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(cube, identity_field, confidence ?? 1, now);

    return db.prepare('SELECT * FROM cube_identity_map WHERE cube = ?').get(cube);
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
    const db = getDb();
    db.prepare('DELETE FROM cube_identity_map WHERE cube = ?').run(cube);
    return reply.status(204).send();
  });
}
