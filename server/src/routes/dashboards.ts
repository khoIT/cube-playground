/**
 * Dashboard CRUD routes.
 * Owner enforcement: all writes use req.owner from X-Owner middleware.
 * Tile cap: 409 with { error: 'tile_cap_exceeded' } when dashboard already has 8 tiles.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  addTile,
  updateTile,
  deleteTile,
  setLayout,
  TileCapError,
} from '../services/dashboard-store.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const createDashboardSchema = z.object({
  game: z.string().min(1).max(64),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(256),
});

const patchDashboardSchema = z.object({
  title: z.string().min(1).max(256).optional(),
});

const addTileSchema = z.object({
  title: z.string().min(1).max(256),
  query_json: z.string().min(1),
  viz_type: z.enum(['kpi', 'line', 'bar', 'table']),
  position_json: z.string().min(1),
});

const patchTileSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  query_json: z.string().min(1).optional(),
  viz_type: z.enum(['kpi', 'line', 'bar', 'table']).optional(),
  position_json: z.string().min(1).optional(),
});

const layoutSchema = z.array(
  z.object({
    tileId: z.number().int().positive(),
    position: z.object({
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
    }),
  }),
);

// ── Route plugin ─────────────────────────────────────────────────────────────

export default async function dashboardsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/dashboards?game=<id>
  app.get('/api/dashboards', async (req, reply) => {
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    return listDashboards(req.owner, game);
  });

  // POST /api/dashboards
  app.post('/api/dashboards', async (req, reply) => {
    const parsed = createDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game, slug, title } = parsed.data;
    try {
      const dashboard = createDashboard({ owner: req.owner, game, slug, title });
      return reply.status(201).send(dashboard);
    } catch (err: unknown) {
      // UNIQUE constraint violation — slug already exists for this owner+game
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: { code: 'SLUG_CONFLICT', message: 'Slug already exists for this game' } });
      }
      throw err;
    }
  });

  // GET /api/dashboards/:slug?game=<id>
  app.get('/api/dashboards/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const dashboard = getDashboard(req.owner, game, slug);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    return dashboard;
  });

  // PATCH /api/dashboards/:slug?game=<id>
  app.patch('/api/dashboards/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const parsed = patchDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const updated = updateDashboard(req.owner, game, slug, parsed.data);
    if (!updated) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    return updated;
  });

  // DELETE /api/dashboards/:slug?game=<id>
  app.delete('/api/dashboards/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const deleted = deleteDashboard(req.owner, game, slug);
    if (!deleted) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    return reply.status(204).send();
  });

  // POST /api/dashboards/:slug/tiles?game=<id>
  app.post('/api/dashboards/:slug/tiles', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const parsed = addTileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const dashboard = getDashboard(req.owner, game, slug);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    try {
      const tile = addTile(dashboard.id, parsed.data);
      return reply.status(201).send(tile);
    } catch (err: unknown) {
      if (err instanceof TileCapError) {
        return reply.status(409).send({ error: 'tile_cap_exceeded' });
      }
      throw err;
    }
  });

  // PATCH /api/dashboards/:slug/tiles/:id?game=<id>
  app.patch('/api/dashboards/:slug/tiles/:id', async (req, reply) => {
    const { id } = req.params as { slug: string; id: string };
    const tileId = parseInt(id, 10);
    if (isNaN(tileId)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid tile id' } });
    }
    const parsed = patchTileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const updated = updateTile(tileId, parsed.data);
    if (!updated) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Tile not found' } });
    }
    return updated;
  });

  // DELETE /api/dashboards/:slug/tiles/:id?game=<id>
  app.delete('/api/dashboards/:slug/tiles/:id', async (req, reply) => {
    const { id } = req.params as { slug: string; id: string };
    const tileId = parseInt(id, 10);
    if (isNaN(tileId)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid tile id' } });
    }
    const deleted = deleteTile(tileId);
    if (!deleted) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Tile not found' } });
    }
    return reply.status(204).send();
  });

  // PUT /api/dashboards/:slug/layout?game=<id>
  app.put('/api/dashboards/:slug/layout', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const parsed = layoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const dashboard = getDashboard(req.owner, game, slug);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    setLayout(dashboard.id, parsed.data);
    return reply.status(204).send();
  });
}
