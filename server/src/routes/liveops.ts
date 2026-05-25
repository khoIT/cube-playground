/**
 * HTTP surface for the liveops result cache.
 *
 *   GET  /api/liveops/kpi-strip?game=<id>
 *   GET  /api/liveops/cohort?game=<id>&window=<days>
 *   POST /api/liveops/funnel        { game, funnelDef }
 *   POST /api/liveops/refresh       { resource, cacheKey } — force refresh now
 *
 * Cache contract:
 *   - Cache hit → 200 + payload + fetched_at + expires_at.
 *   - Cache miss / refreshing / broken with no payload → 202 + a hint to retry.
 *   - cube_meta_version mismatch → expire the row and return 202.
 */

import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { readCache, ensurePlaceholder, expireKey, upsertCache } from '../services/liveops-cache-store.js';
import { getCubeMetaVersion } from '../services/cube-meta-version.js';
import { refreshOneForTest } from '../jobs/refresh-liveops.js';
import { isKnownGame } from '../services/games-config-loader.js';
import type { LiveopsCacheResource } from '../services/liveops-cache-config.js';

const DEFAULT_COHORT_WINDOW_DAYS = 14;
const DEFAULT_FUNNEL_WINDOW_MS = 14 * 86_400_000;

const funnelDefSchema = z.object({
  cubeName: z.string().min(1).max(128),
  orderedEvents: z.array(z.string().min(1)).min(2).max(6),
  windowMs: z.number().int().positive().max(180 * 86_400_000).optional(),
  uidFilter: z.array(z.string()).optional(),
});

const funnelBodySchema = z.object({
  game: z.string().min(1).max(64),
  funnelDef: funnelDefSchema,
});

const refreshBodySchema = z.object({
  resource: z.enum(['kpi_strip', 'cohort_grid', 'funnel_result']),
  cacheKey: z.string().min(1).max(256),
});

function canonicalFunnelHash(def: z.infer<typeof funnelDefSchema>): string {
  const canonical = {
    cubeName: def.cubeName,
    orderedEvents: def.orderedEvents,
    windowMs: def.windowMs ?? DEFAULT_FUNNEL_WINDOW_MS,
    uidFilter: def.uidFilter ? [...def.uidFilter].sort() : undefined,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

interface CachedView {
  payload: unknown;
  fetched_at: string;
  expires_at: string;
  status: 'fresh' | 'refreshing' | 'broken';
  error_msg: string | null;
}

function toView(c: { payload: unknown; fetchedAt: string; expiresAt: string; status: 'fresh' | 'refreshing' | 'broken'; errorMsg: string | null }): CachedView {
  return {
    payload: c.payload,
    fetched_at: c.fetchedAt,
    expires_at: c.expiresAt,
    status: c.status,
    error_msg: c.errorMsg,
  };
}

async function serveCache(
  reply: import('fastify').FastifyReply,
  resource: LiveopsCacheResource,
  cacheKey: string,
  game: string,
): Promise<unknown> {
  const cached = readCache(resource, cacheKey);
  let metaVersion: string;
  try {
    metaVersion = await getCubeMetaVersion(game);
  } catch (err) {
    if (!cached) {
      return reply.status(503).send({
        error: { code: 'CUBE_UNREACHABLE', message: (err as Error).message },
      });
    }
    return reply.status(200).send(toView(cached));
  }

  if (!cached) {
    ensurePlaceholder(resource, cacheKey, game, metaVersion);
    // Kick off an inline refresh so the next poll lands warm.
    void refreshOneForTest(resource, cacheKey, game).catch(() => {});
    return reply.status(202).send({
      status: 'warming',
      message: 'Cache is warming. Retry in a few seconds.',
    });
  }

  if (cached.cubeMetaVersion && cached.cubeMetaVersion !== metaVersion) {
    expireKey(resource, cacheKey);
    void refreshOneForTest(resource, cacheKey, game).catch(() => {});
    return reply.status(202).send({
      status: 'meta_version_mismatch',
      message: 'Cube schema changed; re-warming cache.',
    });
  }

  if (cached.status === 'broken' && !cached.payload) {
    return reply.status(202).send({
      status: 'broken',
      error_msg: cached.errorMsg,
    });
  }

  // Empty-placeholder row (inserted by ensurePlaceholder on cache miss).
  // `payload_hash === ''` is the unambiguous signal a real refresh has not
  // landed yet — older clients would otherwise crash trying to read
  // resource-shaped fields off `{}`.
  if (cached.payloadHash === '') {
    void refreshOneForTest(resource, cacheKey, game).catch(() => {});
    return reply.status(202).send({
      status: 'warming',
      message: 'Cache is warming. Retry in a few seconds.',
    });
  }

  return reply.status(200).send(toView(cached));
}

export default async function liveopsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/liveops/kpi-strip', async (req, reply) => {
    const { game } = req.query as { game?: string };
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    if (!isKnownGame(game)) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_GAME', message: `unknown game ${game}` } });
    }
    return serveCache(reply, 'kpi_strip', game, game);
  });

  app.get('/api/liveops/cohort', async (req, reply) => {
    const { game, window } = req.query as { game?: string; window?: string };
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    if (!isKnownGame(game)) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_GAME', message: `unknown game ${game}` } });
    }
    const windowDays = window ? parseInt(window, 10) : DEFAULT_COHORT_WINDOW_DAYS;
    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 90) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'window must be 1..90 days' } });
    }
    return serveCache(reply, 'cohort_grid', `${game}:${windowDays}`, game);
  });

  app.post('/api/liveops/funnel', async (req, reply) => {
    const parsed = funnelBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { game, funnelDef } = parsed.data;
    if (!isKnownGame(game)) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_GAME', message: `unknown game ${game}` } });
    }
    const defHash = canonicalFunnelHash(funnelDef);
    const cacheKey = `${game}:${defHash}`;

    const cached = readCache(`funnel_result` as LiveopsCacheResource, cacheKey);
    let metaVersion: string;
    try {
      metaVersion = await getCubeMetaVersion(game);
    } catch (err) {
      if (!cached) {
        return reply.status(503).send({
          error: { code: 'CUBE_UNREACHABLE', message: (err as Error).message },
        });
      }
      return reply.status(200).send(toView(cached));
    }

    if (!cached || cached.cubeMetaVersion !== metaVersion) {
      // Seed with the funnel def so cron can refresh autonomously.
      upsertCache({
        resource: 'funnel_result',
        cacheKey,
        game,
        payload: { funnelDef: { ...funnelDef, windowMs: funnelDef.windowMs ?? DEFAULT_FUNNEL_WINDOW_MS }, funnelDefHash: defHash, steps: [], badge: 'ordered' },
        cubeMetaVersion: metaVersion,
        ttlSeconds: 0, // force-stale so cron picks it up immediately
      });
      void refreshOneForTest('funnel_result', cacheKey, game).catch(() => {});
      return reply.status(202).send({
        status: 'warming',
        funnel_def_hash: defHash,
        message: 'Funnel queued for computation. Retry shortly.',
      });
    }

    return reply.status(200).send(toView(cached));
  });

  app.post('/api/liveops/refresh', async (req, reply) => {
    const parsed = refreshBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: parsed.error.message } });
    }
    const { resource, cacheKey } = parsed.data;
    const game = cacheKey.split(':')[0];
    if (!isKnownGame(game)) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_GAME', message: `unknown game ${game}` } });
    }
    expireKey(resource, cacheKey);
    await refreshOneForTest(resource, cacheKey, game);
    const cached = readCache(resource, cacheKey);
    if (!cached) {
      return reply.status(202).send({ status: 'warming' });
    }
    return reply.status(200).send(toView(cached));
  });

  app.get('/api/liveops/cache-status', async (req, reply) => {
    const { game } = req.query as { game?: string };
    if (!game) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'game is required' } });
    }
    const kpi = readCache('kpi_strip', game);
    const cohort = readCache('cohort_grid', `${game}:${DEFAULT_COHORT_WINDOW_DAYS}`);
    return reply.status(200).send({
      kpi_strip: kpi ? { status: kpi.status, fetched_at: kpi.fetchedAt, expires_at: kpi.expiresAt } : null,
      cohort_grid: cohort ? { status: cohort.status, fetched_at: cohort.fetchedAt, expires_at: cohort.expiresAt } : null,
    });
  });
}
