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
  markDashboardViewed,
  setDashboardTileTtl,
  TileCapError,
} from '../services/dashboard-store.js';
import {
  readTileCache,
  invalidateTile,
} from '../services/dashboard-tile-cache-store.js';
import { refreshTileById } from '../jobs/refresh-dashboard-tiles.js';
import { seedStarterPack } from '../services/dashboard-starter-pack-seeder.js';
import { getMeta } from '../services/cube-client.js';
import { resolveCubeTokenForGame } from '../services/resolve-cube-token.js';

// ── Schemas ──────────────────────────────────────────────────────────────────

const createDashboardSchema = z.object({
  game: z.string().min(1).max(64),
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(256),
});

const patchDashboardSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  tile_ttl_seconds: z.number().int().positive().max(86_400).optional(),
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

interface MetaCube { name: string }
interface MetaShape { cubes?: MetaCube[]; cubesMap?: Record<string, MetaCube> }

async function resolveAvailableCubes(game: string): Promise<Set<string>> {
  try {
    const token = resolveCubeTokenForGame(game) ?? undefined;
    const meta = (await getMeta(token)) as MetaShape;
    const cubes = Array.isArray(meta.cubes)
      ? meta.cubes
      : Object.values(meta.cubesMap ?? {});
    return new Set(cubes.map((c) => c.name));
  } catch {
    return new Set();
  }
}

async function seedStarterPackForGame(owner: string, game: string, workspace: string) {
  const availableCubes = await resolveAvailableCubes(game);
  return seedStarterPack({ owner, workspace, game, availableCubes });
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export default async function dashboardsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/dashboards?game=<id>
  // Phase 5: if the list is empty, fire-and-forget a starter-pack seed so the
  // next FE poll sees the curated dashboards. Initial response is the empty
  // list (FE shows a "Setting up…" skeleton and re-polls 1s later).
  app.get('/api/dashboards', async (req, reply) => {
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const dashboards = listDashboards(req.owner, game, req.workspace.id);
    if (dashboards.length === 0) {
      void seedStarterPackForGame(req.owner, game, req.workspace.id).catch(() => {});
    }
    return dashboards;
  });

  // POST /api/dashboards/reset-starter-pack?game=<id>
  app.post('/api/dashboards/reset-starter-pack', async (req, reply) => {
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const result = await seedStarterPackForGame(req.owner, game, req.workspace.id);
    return reply.status(200).send(result);
  });

  // POST /api/dashboards
  app.post('/api/dashboards', async (req, reply) => {
    const parsed = createDashboardSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game, slug, title } = parsed.data;
    try {
      const dashboard = createDashboard({
        owner: req.owner,
        workspace: req.workspace.id,
        game,
        slug,
        title,
      });
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
  // Extended: each tile now includes a `cache` field with cached rows + status,
  // so the FE can render without firing a per-tile Cube query.
  app.get('/api/dashboards/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const dashboard = getDashboard(req.owner, game, slug, req.workspace.id);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    const tilesWithCache = dashboard.tiles.map((tile) => {
      const cache = readTileCache(tile.id);
      return {
        ...tile,
        cache: cache
          ? {
              rows: cache.rows,
              fetched_at: cache.fetched_at,
              expires_at: cache.expires_at,
              status: cache.status,
              error_msg: cache.error_msg,
            }
          : null,
      };
    });
    return { ...dashboard, tiles: tilesWithCache };
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
    const updated = updateDashboard(req.owner, game, slug, req.workspace.id, parsed.data);
    if (!updated) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    if (parsed.data.tile_ttl_seconds != null) {
      setDashboardTileTtl(req.owner, game, slug, req.workspace.id, parsed.data.tile_ttl_seconds);
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
    const deleted = deleteDashboard(req.owner, game, slug, req.workspace.id);
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
    const dashboard = getDashboard(req.owner, game, slug, req.workspace.id);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    try {
      const tile = addTile(dashboard.id, parsed.data);
      // Fire-and-forget inline refresh so the new tile renders with data on
      // the next FE poll (cron tick may be up to 90s away).
      void refreshTileById(tile.id).catch(() => {});
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
    // If the underlying query changed, the cache becomes wrong-shaped — bust
    // the cache row and inline-refresh so the FE sees data quickly.
    if (parsed.data.query_json) {
      invalidateTile(tileId);
      void refreshTileById(tileId).catch(() => {});
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

  // POST /api/dashboards/:slug/view-ping?game=<id>
  // Best-effort: marks the dashboard as recently-viewed so cron refreshes its
  // tiles. Fire-and-forget from the FE; we always return 204.
  app.post('/api/dashboards/:slug/view-ping', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { game } = req.query as Record<string, string | undefined>;
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    markDashboardViewed(req.owner, game, slug, req.workspace.id);
    return reply.status(204).send();
  });

  // POST /api/dashboards/:slug/tiles/:id/refresh?game=<id>
  // Force refresh now for the tile. Returns updated cache view.
  app.post('/api/dashboards/:slug/tiles/:id/refresh', async (req, reply) => {
    const { id } = req.params as { slug: string; id: string };
    const tileId = parseInt(id, 10);
    if (isNaN(tileId)) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid tile id' } });
    }
    await refreshTileById(tileId);
    const cache = readTileCache(tileId);
    if (!cache) {
      return reply.status(202).send({ status: 'warming' });
    }
    return reply.status(200).send({
      rows: cache.rows,
      fetched_at: cache.fetched_at,
      expires_at: cache.expires_at,
      status: cache.status,
      error_msg: cache.error_msg,
    });
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
    const dashboard = getDashboard(req.owner, game, slug, req.workspace.id);
    if (!dashboard) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Dashboard not found' } });
    }
    setLayout(dashboard.id, parsed.data);
    return reply.status(204).send();
  });
}
