/**
 * Cube aliases (display alias + lucide icon) — scoped per `(owner, workspace)`.
 *
 * Replaces the localStorage key `gds-cube:cube-aliases` (data, not view-ephemeral).
 *
 *   GET    /api/cube-aliases
 *     → [{ cube_name, alias, icon }] for the active owner + workspace.
 *   PUT    /api/cube-aliases/:cube_name  body: { alias?, icon? }
 *     → upsert; null/empty alias + icon → delete row.
 *   DELETE /api/cube-aliases/:cube_name
 *     → 204.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db/sqlite.js';

const PUT_BODY = z.object({
  alias: z.string().min(0).max(120).optional().nullable(),
  icon: z.string().min(0).max(120).optional().nullable(),
});

export default async function cubeAliasesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cube-aliases', async (req) => {
    const rows = getDb()
      .prepare(
        `SELECT cube_name, alias, icon FROM cube_aliases
         WHERE owner = ? AND workspace = ?
         ORDER BY cube_name ASC`,
      )
      .all(req.owner, req.workspace.id) as Array<{
      cube_name: string;
      alias: string | null;
      icon: string | null;
    }>;
    return rows;
  });

  app.put<{
    Params: { cube_name: string };
    Body: unknown;
  }>('/api/cube-aliases/:cube_name', async (req, reply) => {
    const parsed = PUT_BODY.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: parsed.error.message },
      });
    }
    const alias = parsed.data.alias?.trim() || null;
    const icon = parsed.data.icon?.trim() || null;
    const now = new Date().toISOString();
    const db = getDb();
    // Both empty → delete (the FE represents "reset to default" as a clear).
    if (alias === null && icon === null) {
      db.prepare(
        `DELETE FROM cube_aliases WHERE owner = ? AND workspace = ? AND cube_name = ?`,
      ).run(req.owner, req.workspace.id, req.params.cube_name);
      return reply.status(204).send();
    }
    db.prepare(
      `INSERT INTO cube_aliases (owner, workspace, cube_name, alias, icon, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner, workspace, cube_name) DO UPDATE SET
         alias = excluded.alias, icon = excluded.icon, updated_at = excluded.updated_at`,
    ).run(req.owner, req.workspace.id, req.params.cube_name, alias, icon, now);
    return reply.status(200).send({ cube_name: req.params.cube_name, alias, icon });
  });

  app.delete<{ Params: { cube_name: string } }>(
    '/api/cube-aliases/:cube_name',
    async (req, reply) => {
      getDb()
        .prepare(
          `DELETE FROM cube_aliases WHERE owner = ? AND workspace = ? AND cube_name = ?`,
        )
        .run(req.owner, req.workspace.id, req.params.cube_name);
      return reply.status(204).send();
    },
  );
}
