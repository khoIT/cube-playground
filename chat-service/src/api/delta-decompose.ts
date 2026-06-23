/**
 * Delta decomposition endpoint (LiveOps Diagnostics):
 *   POST /liveops/delta-decompose
 *
 * Body: { game, measure, dimension, timeDimension, periodA:[s,e], periodB:[s,e],
 *         filters?, topN? }. Cube workspace comes from X-Cube-Workspace (default
 *         'local'); game must match the X-Cube-Game header (proxy contract).
 *
 * Pre-flight ref guard: every measure/dimension/timeDimension is checked against
 * /meta before any Cube call, so a renamed/missing member returns a structured
 * 400 instead of a raw Cube UserError.
 */
import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { decomposeDelta, type DeltaDecomposeInput } from '../services/delta-decomposition.js';

interface DeltaDecomposeRouteOptions {
  db: Database.Database;
}

interface Body {
  game?: string;
  measure?: string;
  dimension?: string;
  timeDimension?: string;
  periodA?: [string, string];
  periodB?: [string, string];
  filters?: DeltaDecomposeInput['filters'];
  topN?: number;
}

function isRange(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string';
}

const deltaDecomposeRoutes: FastifyPluginAsync<DeltaDecomposeRouteOptions> = async (fastify, opts) => {
  fastify.post<{ Body: Body }>('/liveops/delta-decompose', async (req, reply) => {
    const body = req.body ?? {};
    const cubeGame = req.headers['x-cube-game'];
    const wsRaw = req.headers['x-cube-workspace'];
    const workspace = typeof wsRaw === 'string' && wsRaw.trim() ? wsRaw.trim() : 'local';

    const gameId =
      typeof cubeGame === 'string' && cubeGame.trim() ? cubeGame.trim() : body.game;

    if (!gameId) {
      return reply.status(400).send({ error: 'Missing game (X-Cube-Game header or body.game)' });
    }
    if (typeof cubeGame === 'string' && body.game && cubeGame !== body.game) {
      return reply.status(400).send({ error: 'X-Cube-Game header must match body.game' });
    }
    const { measure, dimension, timeDimension, periodA, periodB } = body;
    if (!measure || !dimension || !timeDimension) {
      return reply
        .status(400)
        .send({ error: 'measure, dimension and timeDimension are required' });
    }
    if (!isRange(periodA) || !isRange(periodB)) {
      return reply
        .status(400)
        .send({ error: 'periodA and periodB must be [start, end] date tuples' });
    }

    // Ref guard: refuse to query Cube when a member is unknown to /meta.
    const meta = await cubeMetaCache.getMeta(gameId, workspace).catch(() => null);
    if (meta) {
      const known = cubeMetaCache.extractMemberNames(meta);
      const missing = [measure, dimension, timeDimension].filter((r) => !known.has(r));
      if (missing.length > 0) {
        return reply.status(400).send({
          error: 'unknown_members',
          missingRefs: missing,
          hint: 'These members are not in /meta for this game/workspace — check names.',
        });
      }
    }

    try {
      const result = await decomposeDelta(
        { gameId, workspace, measure, dimension, timeDimension, periodA, periodB, filters: body.filters, topN: body.topN },
        opts.db,
      );
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err: message }, 'delta-decompose failed');
      return reply.status(502).send({ error: 'cube_query_failed', message });
    }
  });
};

export default deltaDecomposeRoutes;
