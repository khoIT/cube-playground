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
import { loadWorkspacesConfig } from '../services/workspaces-config-loader.js';
import { getAccess } from '../auth/access-store.js';
import { FEATURE_KEYS } from '../auth/feature-keys.js';
import { resolvePrincipal, type Principal } from '../auth/principal.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email?: string;
  role: 'viewer' | 'editor' | 'admin';
  /** Game grants scoped per workspace id. A workspace with no entry (or an empty
   *  list) grants no games there — enforcement is fail-closed per workspace. */
  gamesByWorkspace: Record<string, string[]>;
  /** Workspace ids granted to the user. Empty = fall back to role gate. */
  workspaces: string[];
  /** Resolved feature map (key → enabled), DB-authoritative. */
  features: Record<string, boolean>;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    owner: string;
    /** Lazily-resolved identity (sub + email + grants). See auth/principal.ts. */
    readonly principal: Principal;
  }
}

function authDisabled(): boolean {
  const raw = (process.env.AUTH_DISABLED ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Boot-time fail-closed: the dev auth bypass must NEVER run in production. A
 * truthy AUTH_DISABLED under NODE_ENV=production would synthesize an admin for
 * every request — refuse to start instead.
 */
export function assertAuthConfigSafe(): void {
  if (authDisabled() && process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_DISABLED is enabled under NODE_ENV=production — refusing to start. ' +
        'The dev auth bypass must never run in production.',
    );
  }
}

function devUser(): AuthenticatedUser {
  // Synthesize a user that mirrors the prior "X-Owner: dev" posture so
  // pre-Phase-6 seed rows (owner='dev') remain queryable without manual
  // backfill in local dev.
  // Dev admin sees every game in every workspace. Build an explicit all-games
  // map per registry workspace so the per-workspace fail-closed game check
  // (userCanAccessGame) always allows — the dev loop never strands behind RBAC,
  // and the decision fn stays pure (no AUTH_DISABLED read inside it).
  let allGames: string[] = [];
  try {
    allGames = loadGamesConfig().games.map((g) => g.id);
  } catch {
    // gds.config.json missing in some test envs — empty list = unrestricted at runtime.
  }
  const gamesByWorkspace: Record<string, string[]> = {};
  try {
    for (const w of loadWorkspacesConfig().workspaces) gamesByWorkspace[w.id] = allGames;
  } catch {
    // workspace registry missing in some test envs — empty map; the no-grants
    // fallback still allows under AUTH_DISABLED.
  }
  return {
    id: 'dev',
    username: 'dev',
    role: 'admin',
    gamesByWorkspace,
    // Dev admin sees every workspace + feature. Empty workspaces fall through
    // to the role gate (admin → all); features are all-on so the FE shows every
    // section (incl. the default-off admin page) in local dev.
    workspaces: [],
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])),
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
  // Computed decorator: resolves sub↔email + grants on demand from the already
  // -populated owner/user. Lazy so unused routes pay nothing.
  app.decorateRequest('principal', {
    getter(this: FastifyRequest) {
      return resolvePrincipal(this);
    },
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Real auth mode — verify JWT, populate user. Failure to verify is silent
    // (the route's requireRole guard issues the 401/403). Avoids 401-bombing
    // public routes like /api/auth/keycloak/config.
    if (!authDisabled()) {
      const token = readBearerToken(request);
      if (token) {
        try {
          const claims = await verifyAppJwt(token);
          // DB-authoritative authz: resolve role + grants from the access store
          // per request (not from the client-held JWT). This makes revocation
          // and grant edits take effect within the cache TTL, and default-denies
          // a user whose row was removed or set pending/disabled mid-session.
          const access = claims.email ? getAccess(claims.email) : null;
          if (access && access.status === 'active') {
            request.user = {
              id: claims.sub,
              username: claims.username,
              email: claims.email,
              role: access.role,
              gamesByWorkspace: access.gamesByWorkspace,
              workspaces: access.workspaces,
              features: access.features,
            };
            request.owner = claims.sub;
            return;
          }
          // Authenticated but unauthorized (no/inactive grant). Leave req.user
          // undefined → protected routes 401/403. owner still set for audit.
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
