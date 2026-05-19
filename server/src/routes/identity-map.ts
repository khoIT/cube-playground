/**
 * Cube identity field mapping routes.
 * GET returns all saved mappings.
 * PUT upserts a manual override for a specific cube.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/sqlite.js';

const identityPutSchema = z.object({
  identity_field: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export default async function identityMapRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/identity-map
  app.get('/api/identity-map', async (_req, _reply) => {
    const db = getDb();
    return db.prepare('SELECT * FROM cube_identity_map ORDER BY cube').all();
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
}
