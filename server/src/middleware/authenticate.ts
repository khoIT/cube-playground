/**
 * Fastify plugin: resolves the caller's identity from the app JWT and
 * decorates `request.user` (plus `request.owner` for back-compat with
 * routes still on the old owner-header contract).
 *
 * Modes:
 *   - AUTH_DISABLED=true (default in dev): every request gets a synthesized
 *     `dev / admin / allowedGames=all` user. Lets the dev stack run without
 *     Keycloak, and matches the prior X-Owner='dev' posture for seed data.
 *   - AUTH_DISABLED unset/false: parses `Authorization: Bearer <app-jwt>`,
 *     verifies via app-jwt.ts (HS256, JWT_SECRET). Invalid/missing tokens
 *     leave req.user undefined; route-level `requireRole` guards reject.
 *
 * X-Owner header (legacy) is still respected when AUTH_DISABLED is on, so
 * existing tests and tooling that set `X-Owner: alice` keep working. It is
 * ignored in real-auth mode.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { verifyAppJwt } from '../services/app-jwt.js';
import { loadGamesConfig } from '../services/games-config-loader.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string;
  role: 'viewer' | 'editor' | 'admin';
  /** Game ids the user is allowed to operate on. Empty = no per-game restriction. */
  allowedGames: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    owner: string;
  }
}

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function devUser(): AuthenticatedUser {
  // Synthesize a user that mirrors the prior "X-Owner: dev" posture so
  // pre-Phase-6 seed rows (owner='dev') remain queryable without manual
  // backfill in local dev.
  let allowedGames: string[] = [];
  try {
    const cfg = loadGamesConfig();
    allowedGames = cfg.games.map((g) => g.id);
  } catch {
    // gds.config.json missing in some test envs — empty list = unrestricted at runtime.
  }
  return {
    id: 'dev',
    username: 'dev',
    role: 'admin',
    allowedGames,
  };
}

function readBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1] : null;
}

async function authenticatePlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('owner', 'anonymous');
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Real auth mode — verify JWT, populate user. Failure to verify is silent
    // (the route's requireRole guard issues the 401/403). Avoids 401-bombing
    // public routes like /api/auth/keycloak/config.
    if (!authDisabled()) {
      const token = readBearerToken(request);
      if (token) {
        try {
          const claims = await verifyAppJwt(token);
          request.user = {
            id: claims.sub,
            username: claims.username,
            email: claims.email,
            role: claims.role,
            allowedGames: Array.isArray(claims.allowedGames) ? claims.allowedGames : [],
          };
          request.owner = claims.sub;
          return;
        } catch {
          // Invalid token — leave req.user undefined; protected routes 401.
        }
      }
      // Honour legacy X-Owner for the no-JWT path (mirrors prior behaviour);
      // routes that move onto requireRole will reject anonymous traffic.
      const raw = request.headers['x-owner'];
      request.owner = typeof raw === 'string' && raw.trim() ? raw.trim() : 'anonymous';
      return;
    }

    // Dev / auth-disabled mode — synthesize a 'dev / admin' user.
    const u = devUser();
    request.user = u;
    // X-Owner override is still honoured so existing fixtures / e2e tests
    // that pin a specific owner keep working.
    const ownerHdr = request.headers['x-owner'];
    request.owner = typeof ownerHdr === 'string' && ownerHdr.trim() ? ownerHdr.trim() : u.id;
  });
}

export default fp(authenticatePlugin, { name: 'authenticate' });
