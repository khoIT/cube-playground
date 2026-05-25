/**
 * Settings → Chat "Remembered defaults" backend.
 *
 *   GET    /api/chat/user-prefs?gameId=...      → list rows with resolved labels
 *   DELETE /api/chat/user-prefs/:slot?gameId=…  → drop one slot
 *   DELETE /api/chat/user-prefs?gameId=...      → drop everything for owner+game
 *
 * Auth derives `ownerId` from the X-Owner-Id header (same pattern as the
 * other chat routes). `X-Cube-Token` is required so we can resolve cube
 * member shortTitles into readable labels server-side.
 */

import type { FastifyPluginAsync } from 'fastify';
import type Database from 'better-sqlite3';
import {
  getUserPrefs,
  deleteUserPref,
  deleteAllUserPrefs,
  type PrefSlot,
} from '../cache/user-prefs-adapter.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { buildMemberIndex, resolveLabel, type ResolvedRow } from './chat-user-prefs-labels.js';

interface ChatUserPrefsRouteOptions {
  db: Database.Database;
}

function readOwner(req: { headers: Record<string, unknown> }): string | null {
  const v = req.headers['x-owner-id'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readCubeToken(req: { headers: Record<string, unknown> }): string | null {
  const v = req.headers['x-cube-token'];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const chatUserPrefsRoutes: FastifyPluginAsync<ChatUserPrefsRouteOptions> = async (fastify, opts) => {
  fastify.get<{ Querystring: { gameId?: string } }>(
    '/api/chat/user-prefs',
    async (req, reply) => {
      const ownerId = readOwner(req);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      const gameId = req.query.gameId;
      if (!gameId) return reply.status(400).send({ error: 'Missing gameId query param' });

      const rows = getUserPrefs(opts.db, ownerId, gameId);
      if (rows.length === 0) return reply.send({ items: [] });

      const cubeToken = readCubeToken(req);
      let memberIndex: Map<string, { name: string; shortTitle?: string; title?: string }>;
      try {
        const meta = cubeToken ? await cubeMetaCache.getMeta(gameId, cubeToken) : null;
        memberIndex = meta ? buildMemberIndex(meta) : new Map();
      } catch {
        memberIndex = new Map();
      }

      const items: ResolvedRow[] = rows.map((r) => ({
        slot: r.slot,
        value: r.value,
        phrase: r.phrase,
        label: resolveLabel(r.slot, r.value, r.phrase, memberIndex),
        lastUsedAt: r.lastUsedAt,
        hitCount: r.hitCount,
      }));
      return reply.send({ items });
    },
  );

  fastify.delete<{ Params: { slot: string }; Querystring: { gameId?: string } }>(
    '/api/chat/user-prefs/:slot',
    async (req, reply) => {
      const ownerId = readOwner(req);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      const gameId = req.query.gameId;
      if (!gameId) return reply.status(400).send({ error: 'Missing gameId query param' });

      const slot = decodeURIComponent(req.params.slot) as PrefSlot;
      const ok = deleteUserPref(opts.db, ownerId, gameId, slot);
      if (!ok) return reply.status(404).send({ error: 'No such pref' });
      return reply.status(204).send();
    },
  );

  fastify.delete<{ Querystring: { gameId?: string } }>(
    '/api/chat/user-prefs',
    async (req, reply) => {
      const ownerId = readOwner(req);
      if (!ownerId) return reply.status(401).send({ error: 'Missing X-Owner-Id header' });
      const gameId = req.query.gameId;
      if (!gameId) return reply.status(400).send({ error: 'Missing gameId query param' });

      deleteAllUserPrefs(opts.db, ownerId, gameId);
      return reply.status(204).send();
    },
  );
};

export default chatUserPrefsRoutes;
